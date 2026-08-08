/**
 * DMS repository, search & retention (DMS-01/02/03/04/06/07).
 * Folder tree, upload/version/download, entity links, ILIKE search,
 * archive / legal hold / disposal-by-approval.
 */
import {
  BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpException,
  Injectable, NotFoundException, Param, Patch, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';
import { WorkflowService } from '../../workflow/workflow.service';
import { DocStorageService } from './storage';
import { NullOcrService } from './ocr';
import { TesseractOcrService } from './ocr.tesseract';
import {
  base64DecodedBytes, canReadDocument, canReadFolder, canWriteFolder, escapeLike,
  hashVerdict, isConfidentialReader, makeSnippet, MAX_UPLOAD_BYTES, type DmsUserCtx,
} from './dms.logic';

export const DISPOSED_NAME = '[DISPOSED]';
export const DOC_DISPOSAL_TYPE = 'DOC_DISPOSAL';

// ---------- zod ----------

const FolderCreateSchema = z.object({
  name: z.string().min(1).max(120),
  parentId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  confidential: z.boolean().optional(),
});
const FolderUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  departmentId: z.string().nullable().optional(),
  confidential: z.boolean().optional(),
});
const UploadSchema = z.object({
  name: z.string().min(1).max(200),
  mime: z.string().min(3).max(120),
  dataBase64: z.string().min(1),
  folderId: z.string().optional().nullable(),
  docType: z.string().max(60).optional().nullable(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  textContent: z.string().max(200_000).optional().nullable(),
  confidential: z.boolean().optional(),
});
const NewVersionSchema = z.object({
  dataBase64: z.string().min(1),
  mime: z.string().min(3).max(120).optional(),
  note: z.string().max(500).optional().nullable(),
});
const LinkSchema = z.object({
  entityType: z.string().min(1).max(60),
  entityId: z.string().min(1).max(80),
});
const LegalHoldSchema = z.object({ on: z.boolean() });
const DisposalSchema = z.object({ reason: z.string().min(5).max(1000) });

// ---------- shared service ----------

type DocRow = typeof schema.documents.$inferSelect;
type FolderRow = typeof schema.docFolders.$inferSelect;

@Injectable()
export class DmsService {
  constructor(
    private readonly audit: AuditService,
    private readonly storage: DocStorageService,
    private readonly ocr: NullOcrService,
    private readonly workflow: WorkflowService,
  ) {}

  userCtx(user: AuthedUser): DmsUserCtx {
    return { id: user.id, departmentId: user.departmentId, roleCodes: user.roles.map((r) => r.code) };
  }

  async folder(id: string): Promise<FolderRow> {
    const row = await db.query.docFolders.findFirst({ where: eq(schema.docFolders.id, id) });
    if (!row) throw new NotFoundException('Folder not found');
    return row;
  }

  /** True when the folder or ANY ancestor is confidential (tree walk, cycle-safe). */
  async folderChainConfidential(folderId: string | null): Promise<boolean> {
    let cur = folderId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const row = await db.query.docFolders.findFirst({ where: eq(schema.docFolders.id, cur) });
      if (!row) return false;
      if (row.confidential) return true;
      cur = row.parentId;
    }
    return false;
  }

  async doc(id: string): Promise<DocRow> {
    const row = await db.query.documents.findFirst({ where: eq(schema.documents.id, id) });
    if (!row) throw new NotFoundException('Document not found');
    return row;
  }

  async assertReadable(user: AuthedUser, doc: DocRow): Promise<void> {
    const folderConf = await this.folderChainConfidential(doc.folderId);
    if (!canReadDocument(this.userCtx(user), doc, folderConf)) {
      throw new ForbiddenException('This document is confidential');
    }
  }

  /** Writable = uploader, SYSTEM_ADMIN, or a writer of the containing folder. */
  async assertWritable(user: AuthedUser, doc: DocRow): Promise<void> {
    await this.assertReadable(user, doc);
    const ctx = this.userCtx(user);
    if (doc.uploadedById === user.id || ctx.roleCodes.includes('SYSTEM_ADMIN')) return;
    if (doc.folderId) {
      const folder = await this.folder(doc.folderId);
      if (canWriteFolder(ctx, folder)) return;
    }
    throw new ForbiddenException('You cannot modify this document');
  }

  assertNotDisposed(doc: DocRow): void {
    if (doc.name === DISPOSED_NAME) throw new HttpException('Document has been disposed', 410);
  }

  decodeUpload(dataBase64: string): Buffer {
    if (base64DecodedBytes(dataBase64) > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('File exceeds the 10MB upload limit');
    }
    const buf = Buffer.from(dataBase64, 'base64');
    if (buf.length === 0) throw new BadRequestException('Empty or invalid base64 payload');
    if (buf.length > MAX_UPLOAD_BYTES) throw new BadRequestException('File exceeds the 10MB upload limit');
    return buf;
  }

  /** DMS-02: duplicate-content detection across all stored versions. */
  async duplicateWarning(sha256: string): Promise<string | null> {
    const dups = await db.select({ documentId: schema.docVersions.documentId })
      .from(schema.docVersions).where(eq(schema.docVersions.sha256, sha256)).limit(5);
    if (dups.length === 0) return null;
    const ids = [...new Set(dups.map((d) => d.documentId))];
    return `Identical content already exists (sha256 match) in document(s): ${ids.join(', ')}`;
  }

  docJson(doc: DocRow) {
    return {
      id: doc.id, folderId: doc.folderId, name: doc.name, mime: doc.mime,
      sizeBytes: doc.sizeBytes, sha256: doc.sha256, docType: doc.docType,
      tags: doc.tags ?? [], confidential: doc.confidential, uploadedById: doc.uploadedById,
      currentVersion: doc.currentVersion, archivedAt: doc.archivedAt, legalHold: doc.legalHold,
      createdAt: doc.createdAt,
    };
  }

  async extractText(buf: Buffer, mime: string, supplied?: string | null): Promise<string | null> {
    if (supplied && supplied.trim().length > 0) return supplied;
    return this.ocr.extract(buf, mime); // Tesseract via DI (see index.ts)
  }

  /** DMS-04 backfill: OCR every OCR-able document that has no text yet. Returns counts. */
  async ocrBackfill(limit = 25): Promise<{ scanned: number; extracted: number }> {
    const docs = await db.select().from(schema.documents)
      .where(and(isNull(schema.documents.textContent), isNull(schema.documents.archivedAt)));
    let scanned = 0, extracted = 0;
    for (const d of docs) {
      if (scanned >= limit) break;
      if (!TesseractOcrService.isOcrable(d.mime)) continue;
      scanned += 1;
      try {
        const bytes = await this.storage.read(d.storageKey);
        if (!bytes) continue;
        const text = await this.ocr.extract(bytes, d.mime);
        if (text) {
          await db.update(schema.documents).set({ textContent: text }).where(eq(schema.documents.id, d.id));
          extracted += 1;
        }
      } catch { /* keep going — one bad file must not stall the batch */ }
    }
    return { scanned, extracted };
  }

  get storageSvc() { return this.storage; }
  get auditSvc() { return this.audit; }
  get workflowSvc() { return this.workflow; }
}

// ---------- folders (DMS-01 tree, DMS-07 permissions) ----------

@Controller('v1/dms/folders')
@UseGuards(AuthGuard)
export class FoldersController {
  constructor(private readonly svc: DmsService) {}

  /** Folder tree; confidential branches trimmed for non-privileged users. */
  @Get()
  async tree(@CurrentUser() user: AuthedUser) {
    const rows = await db.select().from(schema.docFolders).orderBy(schema.docFolders.name);
    const ctx = this.svc.userCtx(user);
    const visible = new Map(rows.filter((f) => canReadFolder(ctx, f)).map((f) => [f.id, f]));
    type Node = FolderRow & { writable: boolean; children: Node[] };
    const nodes = new Map<string, Node>();
    for (const f of visible.values()) {
      nodes.set(f.id, { ...f, writable: canWriteFolder(ctx, f), children: [] });
    }
    const roots: Node[] = [];
    for (const n of nodes.values()) {
      // a child under an invisible (confidential) parent is trimmed with its branch
      if (n.parentId && !nodes.has(n.parentId)) continue;
      if (n.parentId) nodes.get(n.parentId)!.children.push(n);
      else roots.push(n);
    }
    return roots;
  }

  @Post()
  async create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    const dto = FolderCreateSchema.parse(body);
    const ctx = this.svc.userCtx(user);
    if (dto.confidential && !isConfidentialReader(ctx)) {
      throw new ForbiddenException('Only Internal Audit, HR or System Admin may create confidential folders');
    }
    if (dto.parentId) {
      const parent = await this.svc.folder(dto.parentId);
      if (!canReadFolder(ctx, parent) || !canWriteFolder(ctx, parent)) {
        throw new ForbiddenException('You cannot create folders here');
      }
    }
    if (dto.departmentId) {
      const dep = await db.query.departments.findFirst({ where: eq(schema.departments.id, dto.departmentId) });
      if (!dep) throw new BadRequestException('Unknown department');
    }
    const [row] = await db.insert(schema.docFolders).values({
      name: dto.name, parentId: dto.parentId ?? null,
      departmentId: dto.departmentId ?? null, confidential: dto.confidential ?? false,
    }).returning();
    await this.svc.auditSvc.log({
      actorId: user.id, actorEmail: user.email, action: 'FOLDER_CREATED',
      entityType: 'doc_folder', entityId: row.id,
      data: { name: row.name, parentId: row.parentId, departmentId: row.departmentId, confidential: row.confidential },
      ip: req.ip,
    });
    return row;
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = FolderUpdateSchema.parse(body);
    const folder = await this.svc.folder(id);
    const ctx = this.svc.userCtx(user);
    if (!canReadFolder(ctx, folder) || !canWriteFolder(ctx, folder)) {
      throw new ForbiddenException('You cannot modify this folder');
    }
    if (dto.confidential !== undefined && !isConfidentialReader(ctx)) {
      throw new ForbiddenException('Only Internal Audit, HR or System Admin may change confidentiality');
    }
    const [row] = await db.update(schema.docFolders).set({
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.departmentId !== undefined ? { departmentId: dto.departmentId } : {}),
      ...(dto.confidential !== undefined ? { confidential: dto.confidential } : {}),
    }).where(eq(schema.docFolders.id, id)).returning();
    await this.svc.auditSvc.log({
      actorId: user.id, actorEmail: user.email, action: 'FOLDER_UPDATED',
      entityType: 'doc_folder', entityId: id, data: dto, ip: req.ip,
    });
    return row;
  }

  /** Delete only when empty — documents keep their audit trail elsewhere. */
  @Delete(':id')
  async remove(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    const folder = await this.svc.folder(id);
    const ctx = this.svc.userCtx(user);
    if (!canReadFolder(ctx, folder) || !canWriteFolder(ctx, folder)) {
      throw new ForbiddenException('You cannot delete this folder');
    }
    const [child] = await db.select({ id: schema.docFolders.id }).from(schema.docFolders)
      .where(eq(schema.docFolders.parentId, id)).limit(1);
    const [docRow] = await db.select({ id: schema.documents.id }).from(schema.documents)
      .where(eq(schema.documents.folderId, id)).limit(1);
    if (child || docRow) throw new BadRequestException('Folder is not empty');
    await db.delete(schema.docFolders).where(eq(schema.docFolders.id, id));
    await this.svc.auditSvc.log({
      actorId: user.id, actorEmail: user.email, action: 'FOLDER_DELETED',
      entityType: 'doc_folder', entityId: id, data: { name: folder.name }, ip: req.ip,
    });
    return { ok: true };
  }

  @Get(':id/documents')
  async documents(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    const folder = await this.svc.folder(id);
    const ctx = this.svc.userCtx(user);
    if (!canReadFolder(ctx, folder)) throw new ForbiddenException('This folder is confidential');
    const chainConf = await this.svc.folderChainConfidential(id);
    const rows = await db.select().from(schema.documents)
      .where(eq(schema.documents.folderId, id)).orderBy(schema.documents.name);
    return rows.filter((d) => canReadDocument(ctx, d, chainConf)).map((d) => this.svc.docJson(d));
  }
}

// ---------- documents (DMS-01/02/03/06/07) ----------

@Controller('v1/dms/documents')
@UseGuards(AuthGuard)
export class DocumentsController {
  /** DMS-04: OCR backfill for documents uploaded before the engine existed (SYSTEM_ADMIN). */
  @Post('ocr-backfill')
  @RequireRoles('SYSTEM_ADMIN')
  async ocrBackfill(@CurrentUser() user: AuthedUser, @Req() req: any) {
    const result = await this.svc.ocrBackfill();
    await this.svc.auditSvc.log({
      actorId: user.id, actorEmail: user.email, action: 'DOC_OCR_BACKFILL',
      entityType: 'document', entityId: 'batch', data: result, ip: req.ip,
    });
    return result;
  }

  constructor(private readonly svc: DmsService) {}

  /** DMS-01: JSON upload — {name, mime, dataBase64 ≤10MB decoded, folderId?, docType?, tags?, textContent?}. */
  @Post()
  async upload(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    const dto = UploadSchema.parse(body);
    const ctx = this.svc.userCtx(user);
    if (dto.folderId) {
      const folder = await this.svc.folder(dto.folderId);
      if (!canReadFolder(ctx, folder) || !canWriteFolder(ctx, folder)) {
        throw new ForbiddenException('You cannot upload into this folder');
      }
    }
    const buf = this.svc.decodeUpload(dto.dataBase64);
    const { key, sha256 } = await this.svc.storageSvc.save(buf);
    const warning = await this.svc.duplicateWarning(sha256);
    const textContent = await this.svc.extractText(buf, dto.mime, dto.textContent);
    const [doc] = await db.insert(schema.documents).values({
      folderId: dto.folderId ?? null, name: dto.name, mime: dto.mime, sizeBytes: buf.length,
      storageKey: key, sha256, docType: dto.docType ?? null, tags: dto.tags ?? [],
      textContent, confidential: dto.confidential ?? false, uploadedById: user.id, currentVersion: 1,
    }).returning();
    await db.insert(schema.docVersions).values({
      documentId: doc.id, versionNo: 1, storageKey: key, sha256, sizeBytes: buf.length,
      note: 'Initial upload', uploadedById: user.id,
    });
    await this.svc.auditSvc.log({
      actorId: user.id, actorEmail: user.email, action: 'DOC_UPLOADED',
      entityType: 'document', entityId: doc.id,
      data: { name: doc.name, mime: doc.mime, sizeBytes: buf.length, sha256, folderId: doc.folderId, duplicate: !!warning },
      ip: req.ip,
    });
    return { document: this.svc.docJson(doc), warning };
  }

  /**
   * DMS-02: the repository listing.
   *
   * There was no route for this: documents could only be reached one folder at a time via
   * GET /v1/dms/folders/:id/documents, so anything with folderId null — every upload whose
   * folder could not be resolved — existed in the database and appeared in NO screen. A
   * document you cannot see is a document you cannot put a legal hold on, add to an
   * evidence pack, or produce for an auditor, which is most of what the repository is for.
   *
   * Readability is filtered per document exactly as search does it; a confidential folder
   * anywhere up the chain hides its contents. Disposed documents are excluded — the row
   * survives for the audit trail, it is not a document any more.
   */
  @Get()
  async list(
    @CurrentUser() user: AuthedUser,
    @Query('folderId') folderId?: string,
    @Query('limit') limit?: string,
  ) {
    const max = Math.min(Number(limit) || 500, 1000);
    const rows = await db.select().from(schema.documents)
      .where(folderId ? eq(schema.documents.folderId, folderId) : undefined)
      .orderBy(desc(schema.documents.createdAt))
      .limit(max);
    const ctx = this.svc.userCtx(user);
    const out = [];
    for (const d of rows) {
      if (d.name === '[DISPOSED]') continue;
      const folderConf = await this.svc.folderChainConfidential(d.folderId);
      if (!canReadDocument(ctx, d, folderConf)) continue;
      out.push(this.svc.docJson(d));
    }
    return out;
  }

  /**
   * DMS-10: recompute the stored file's SHA-256 and compare it with the hash recorded at
   * upload. This is the only honest answer to "has this document been altered since it was
   * signed" — the certificate screen previously toggled a local boolean and displayed a
   * tamper warning computed from nothing, which is worse than no check at all.
   *
   * A missing file is reported as its own state, not as a match and not as tampering: the
   * bytes being gone is a real and different problem from the bytes being changed, and
   * collapsing the two would send someone looking for the wrong thing.
   *
   * The check is audit-logged either way. A verification that found tampering and left no
   * trace would be the single most valuable event in this system to lose.
   */
  @Get(':id/verify-hash')
  async verifyHash(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    const doc = await this.svc.doc(id);
    await this.svc.assertReadable(user, doc);
    const buf = await this.svc.storageSvc.read(doc.storageKey);
    const checkedAt = new Date().toISOString();
    const actual = buf ? this.svc.storageSvc.sha256(buf) : null;
    // The comparison lives in dms.logic (hashVerdict) and is unit-tested against real
    // digests of real buffers — flipped byte, appended byte, truncation, same-length
    // substitution, missing file, and nothing-recorded. Keeping the decision there rather
    // than inline here is what makes those tests statements about this endpoint.
    const verdict = hashVerdict(doc.sha256, actual);

    if (verdict === 'missing') {
      await this.svc.auditSvc.log({
        actorId: user.id, actorEmail: user.email, action: 'DOC_HASH_VERIFY_FAILED',
        entityType: 'document', entityId: doc.id,
        data: { reason: 'file missing from storage', storageKey: doc.storageKey }, ip: req.ip,
      });
      throw new NotFoundException('The stored file is missing, so its hash cannot be checked. This document is unverified.');
    }
    if (verdict === 'unverifiable') {
      await this.svc.auditSvc.log({
        actorId: user.id, actorEmail: user.email, action: 'DOC_HASH_VERIFY_FAILED',
        entityType: 'document', entityId: doc.id,
        data: { reason: 'no hash was recorded for this document' }, ip: req.ip,
      });
      throw new NotFoundException('No hash was recorded for this document, so there is nothing to check it against. It is unverified.');
    }

    const matches = verdict === 'verified';
    await this.svc.auditSvc.log({
      actorId: user.id, actorEmail: user.email,
      action: matches ? 'DOC_HASH_VERIFIED' : 'DOC_HASH_MISMATCH',
      entityType: 'document', entityId: doc.id,
      data: { name: doc.name, recorded: doc.sha256, actual, matches }, ip: req.ip,
    });
    return { documentId: doc.id, name: doc.name, matches, verdict, recorded: doc.sha256, actual, checkedAt };
  }

  /** DMS-07: every open is audit-logged as DOC_VIEWED. */
  @Get(':id')
  async view(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    const doc = await this.svc.doc(id);
    await this.svc.assertReadable(user, doc);
    const versions = await db.select().from(schema.docVersions)
      .where(eq(schema.docVersions.documentId, id)).orderBy(desc(schema.docVersions.versionNo));
    const links = await db.select().from(schema.docLinks).where(eq(schema.docLinks.documentId, id));
    const uploader = await db.query.users.findFirst({
      where: eq(schema.users.id, doc.uploadedById), columns: { name: true },
    });
    await this.svc.auditSvc.log({
      actorId: user.id, actorEmail: user.email, action: 'DOC_VIEWED',
      entityType: 'document', entityId: id, ip: req.ip,
    });
    return {
      ...this.svc.docJson(doc),
      uploadedBy: uploader?.name ?? null,
      versions: versions.map((v) => ({
        versionNo: v.versionNo, sha256: v.sha256, sizeBytes: v.sizeBytes,
        note: v.note, uploadedById: v.uploadedById, createdAt: v.createdAt,
      })),
      links,
    };
  }

  /** DMS-01: stream bytes with the stored mime; DOC_DOWNLOADED audit event. */
  @Get(':id/download')
  async download(
    @CurrentUser() user: AuthedUser, @Param('id') id: string,
    @Query('version') version: string | undefined, @Req() req: any, @Res() res: any,
  ) {
    const doc = await this.svc.doc(id);
    await this.svc.assertReadable(user, doc);
    this.svc.assertNotDisposed(doc);
    let storageKey = doc.storageKey;
    let versionNo = doc.currentVersion;
    if (version !== undefined) {
      versionNo = Number(version);
      if (!Number.isInteger(versionNo) || versionNo < 1) throw new BadRequestException('Bad version number');
      const v = await db.query.docVersions.findFirst({
        where: and(eq(schema.docVersions.documentId, id), eq(schema.docVersions.versionNo, versionNo)),
      });
      if (!v) throw new NotFoundException('Version not found');
      storageKey = v.storageKey;
    }
    const bytes = await this.svc.storageSvc.read(storageKey);
    if (!bytes) throw new HttpException('Stored file is no longer available', 410);
    await this.svc.auditSvc.log({
      actorId: user.id, actorEmail: user.email, action: 'DOC_DOWNLOADED',
      entityType: 'document', entityId: id, data: { versionNo }, ip: req.ip,
    });
    res.setHeader('Content-Type', doc.mime);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.name)}"`);
    res.send(bytes);
  }

  @Get(':id/versions')
  async versions(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    const doc = await this.svc.doc(id);
    await this.svc.assertReadable(user, doc);
    const rows = await db.select().from(schema.docVersions)
      .where(eq(schema.docVersions.documentId, id)).orderBy(desc(schema.docVersions.versionNo));
    return rows.map((v) => ({
      versionNo: v.versionNo, sha256: v.sha256, sizeBytes: v.sizeBytes,
      note: v.note, uploadedById: v.uploadedById, createdAt: v.createdAt,
      isCurrent: v.versionNo === doc.currentVersion,
    }));
  }

  /** DMS-03: new version — versionNo+1, currentVersion bump, note. */
  @Post(':id/versions')
  async newVersion(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = NewVersionSchema.parse(body);
    const doc = await this.svc.doc(id);
    this.svc.assertNotDisposed(doc);
    await this.svc.assertWritable(user, doc);
    const buf = this.svc.decodeUpload(dto.dataBase64);
    const { key, sha256 } = await this.svc.storageSvc.save(buf);
    const warning = await this.svc.duplicateWarning(sha256);
    const [m] = await db.select({ max: sql<number>`coalesce(max(${schema.docVersions.versionNo}), 0)` })
      .from(schema.docVersions).where(eq(schema.docVersions.documentId, id));
    const versionNo = Number(m?.max ?? 0) + 1;
    await db.insert(schema.docVersions).values({
      documentId: id, versionNo, storageKey: key, sha256, sizeBytes: buf.length,
      note: dto.note ?? null, uploadedById: user.id,
    });
    const [updated] = await db.update(schema.documents).set({
      currentVersion: versionNo, storageKey: key, sha256, sizeBytes: buf.length,
      ...(dto.mime ? { mime: dto.mime } : {}),
    }).where(eq(schema.documents.id, id)).returning();
    await this.svc.auditSvc.log({
      actorId: user.id, actorEmail: user.email, action: 'DOC_VERSION_ADDED',
      entityType: 'document', entityId: id,
      data: { versionNo, sha256, sizeBytes: buf.length, note: dto.note ?? null }, ip: req.ip,
    });
    return { document: this.svc.docJson(updated), versionNo, warning };
  }

  /** DMS-03: restore = a NEW version equal to the old one (history is never rewritten). */
  @Post(':id/versions/:versionNo/restore')
  async restore(
    @CurrentUser() user: AuthedUser, @Param('id') id: string,
    @Param('versionNo') versionNoParam: string, @Req() req: any,
  ) {
    const doc = await this.svc.doc(id);
    this.svc.assertNotDisposed(doc);
    await this.svc.assertWritable(user, doc);
    const fromNo = Number(versionNoParam);
    if (!Number.isInteger(fromNo) || fromNo < 1) throw new BadRequestException('Bad version number');
    const from = await db.query.docVersions.findFirst({
      where: and(eq(schema.docVersions.documentId, id), eq(schema.docVersions.versionNo, fromNo)),
    });
    if (!from) throw new NotFoundException('Version not found');
    const [m] = await db.select({ max: sql<number>`coalesce(max(${schema.docVersions.versionNo}), 0)` })
      .from(schema.docVersions).where(eq(schema.docVersions.documentId, id));
    const versionNo = Number(m?.max ?? 0) + 1;
    await db.insert(schema.docVersions).values({
      documentId: id, versionNo, storageKey: from.storageKey, sha256: from.sha256,
      sizeBytes: from.sizeBytes, note: `Restored from v${fromNo}`, uploadedById: user.id,
    });
    const [updated] = await db.update(schema.documents).set({
      currentVersion: versionNo, storageKey: from.storageKey, sha256: from.sha256, sizeBytes: from.sizeBytes,
    }).where(eq(schema.documents.id, id)).returning();
    await this.svc.auditSvc.log({
      actorId: user.id, actorEmail: user.email, action: 'DOC_RESTORED',
      entityType: 'document', entityId: id, data: { fromVersion: fromNo, asVersion: versionNo }, ip: req.ip,
    });
    return { document: this.svc.docJson(updated), versionNo };
  }

  /** DMS-01: attach the document to any entity (transaction, vendor, asset…). */
  @Post(':id/links')
  async link(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = LinkSchema.parse(body);
    const doc = await this.svc.doc(id);
    await this.svc.assertReadable(user, doc);
    const existing = await db.select().from(schema.docLinks).where(and(
      eq(schema.docLinks.documentId, id),
      eq(schema.docLinks.entityType, dto.entityType),
      eq(schema.docLinks.entityId, dto.entityId),
    ));
    if (existing.length > 0) return existing[0];
    const [row] = await db.insert(schema.docLinks).values({
      documentId: id, entityType: dto.entityType, entityId: dto.entityId,
    }).returning();
    await this.svc.auditSvc.log({
      actorId: user.id, actorEmail: user.email, action: 'DOC_LINKED',
      entityType: 'document', entityId: id,
      data: { entityType: dto.entityType, entityId: dto.entityId }, ip: req.ip,
    });
    return row;
  }

  // ----- retention (DMS-06) -----

  @Post(':id/archive')
  async archive(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    const doc = await this.svc.doc(id);
    this.svc.assertNotDisposed(doc);
    await this.svc.assertWritable(user, doc);
    if (doc.archivedAt) return { document: this.svc.docJson(doc) }; // idempotent
    const [updated] = await db.update(schema.documents).set({ archivedAt: new Date() })
      .where(eq(schema.documents.id, id)).returning();
    await this.svc.auditSvc.log({
      actorId: user.id, actorEmail: user.email, action: 'DOC_ARCHIVED',
      entityType: 'document', entityId: id, ip: req.ip,
    });
    return { document: this.svc.docJson(updated) };
  }

  /** Legal hold — Internal Audit or System Admin only; blocks disposal. */
  @Post(':id/legal-hold')
  @RequireRoles('INTERNAL_AUDIT', 'SYSTEM_ADMIN')
  async legalHold(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = LegalHoldSchema.parse(body);
    const doc = await this.svc.doc(id);
    this.svc.assertNotDisposed(doc);
    const [updated] = await db.update(schema.documents).set({ legalHold: dto.on })
      .where(eq(schema.documents.id, id)).returning();
    await this.svc.auditSvc.log({
      actorId: user.id, actorEmail: user.email,
      action: dto.on ? 'DOC_LEGAL_HOLD_ON' : 'DOC_LEGAL_HOLD_OFF',
      entityType: 'document', entityId: id, ip: req.ip,
    });
    return { document: this.svc.docJson(updated) };
  }

  /**
   * DMS-06: disposal goes through the approval workflow (DOC_DISPOSAL:
   * INTERNAL_AUDIT → SYSTEM_ADMIN). The final-approval hook deletes the bytes;
   * the row and its audit trail are never deleted.
   */
  @Post(':id/disposal-request')
  async disposalRequest(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = DisposalSchema.parse(body);
    const doc = await this.svc.doc(id);
    this.svc.assertNotDisposed(doc);
    await this.svc.assertWritable(user, doc);
    if (doc.legalHold) throw new BadRequestException('Document is under legal hold — disposal is blocked');
    const tx = await this.svc.workflowSvc.createTransaction(user, {
      typeCode: DOC_DISPOSAL_TYPE,
      title: `Dispose document: ${doc.name}`,
      payload: { documentId: id, reason: dto.reason },
      submit: true,
      ip: req.ip,
    });
    await this.svc.auditSvc.log({
      actorId: user.id, actorEmail: user.email, action: 'DOC_DISPOSAL_REQUESTED',
      entityType: 'document', entityId: id, data: { txRef: tx.ref, reason: dto.reason }, ip: req.ip,
    });
    return { transaction: { id: tx.id, ref: tx.ref, status: tx.status } };
  }
}

// ---------- entity links listing ----------

@Controller('v1/dms/links')
@UseGuards(AuthGuard)
export class LinksController {
  constructor(private readonly svc: DmsService) {}

  /** Documents attached to an entity, permission-trimmed. */
  @Get(':entityType/:entityId')
  async forEntity(
    @CurrentUser() user: AuthedUser,
    @Param('entityType') entityType: string, @Param('entityId') entityId: string,
  ) {
    const links = await db.select().from(schema.docLinks).where(and(
      eq(schema.docLinks.entityType, entityType), eq(schema.docLinks.entityId, entityId),
    ));
    if (links.length === 0) return [];
    const docs = await db.select().from(schema.documents)
      .where(inArray(schema.documents.id, links.map((l) => l.documentId)));
    const ctx = this.svc.userCtx(user);
    const out = [];
    for (const d of docs) {
      const folderConf = await this.svc.folderChainConfidential(d.folderId);
      if (canReadDocument(ctx, d, folderConf)) out.push(this.svc.docJson(d));
    }
    return out;
  }
}

// ---------- search (DMS-04) ----------

@Controller('v1/dms/search')
@UseGuards(AuthGuard)
export class SearchController {
  constructor(private readonly svc: DmsService) {}

  /** ILIKE over name/docType/tags/textContent; permission-trimmed; snippets with offsets. */
  @Get()
  async search(
    @CurrentUser() user: AuthedUser,
    @Query('q') q?: string, @Query('docType') docType?: string, @Query('limit') limit?: string,
  ) {
    const query = (q ?? '').trim();
    if (query.length < 2) throw new BadRequestException('Query must be at least 2 characters');
    const pattern = `%${escapeLike(query)}%`;
    const max = Math.min(Number(limit) || 50, 100);
    const conds = or(
      ilike(schema.documents.name, pattern),
      ilike(schema.documents.docType, pattern),
      sql`${schema.documents.tags}::text ILIKE ${pattern}`,
      ilike(schema.documents.textContent, pattern),
    );
    const where = docType ? and(conds, eq(schema.documents.docType, docType)) : conds;
    const rows = await db.select().from(schema.documents).where(where)
      .orderBy(desc(schema.documents.createdAt)).limit(max * 3);
    const ctx = this.svc.userCtx(user);
    const results = [];
    for (const d of rows) {
      if (results.length >= max) break;
      const folderConf = await this.svc.folderChainConfidential(d.folderId);
      if (!canReadDocument(ctx, d, folderConf)) continue;
      const tagText = Array.isArray(d.tags) ? (d.tags as string[]).join(', ') : null;
      const snippet =
        makeSnippet(d.textContent, query) ??
        makeSnippet(d.name, query) ??
        makeSnippet(d.docType, query) ??
        makeSnippet(tagText, query);
      results.push({ ...this.svc.docJson(d), snippet });
    }
    return { query, count: results.length, results };
  }
}

// ---------- DOC_DISPOSAL final-approval hook (DMS-06) ----------

/**
 * Registered via index.ts register(). Idempotent-safe: a second run finds the
 * document already marked DISPOSED and does nothing. Legal hold applied after
 * the request was submitted still blocks deletion. Rows are NEVER deleted —
 * only file bytes; the metadata + audit trail survive.
 */
export async function disposalHook(tx: { ref: string; payload: unknown }): Promise<void> {
  const audit = new AuditService();
  const storage = new DocStorageService();
  const payload = (tx.payload ?? {}) as { documentId?: string; reason?: string };
  if (!payload.documentId) return;
  const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, payload.documentId) });
  if (!doc || doc.name === DISPOSED_NAME) return;
  if (doc.legalHold) {
    await audit.log({
      action: 'DOC_DISPOSAL_BLOCKED', entityType: 'document', entityId: doc.id,
      data: { txRef: tx.ref, reason: 'legal hold active at disposal time' },
    });
    return;
  }
  const versions = await db.select().from(schema.docVersions)
    .where(eq(schema.docVersions.documentId, doc.id));
  const keys = new Set<string>([doc.storageKey, ...versions.map((v) => v.storageKey)]);
  for (const key of keys) await storage.remove(key);
  await db.update(schema.documents).set({
    name: DISPOSED_NAME, textContent: null,
    archivedAt: doc.archivedAt ?? new Date(),
  }).where(eq(schema.documents.id, doc.id));
  await audit.log({
    action: 'DOC_DISPOSED', entityType: 'document', entityId: doc.id,
    data: { txRef: tx.ref, originalName: doc.name, reason: payload.reason ?? null, versionsWiped: versions.length },
  });
}

// ---------- seed helpers (called from index.ts seedDefaults) ----------

export async function seedRepositoryDefaults(): Promise<void> {
  // DOC_DISPOSAL transaction type — Internal Audit then System Admin
  await db.insert(schema.transactionTypes).values({
    code: DOC_DISPOSAL_TYPE, name: 'Document Disposal', refPrefix: 'DSP',
    stages: [{ role: 'INTERNAL_AUDIT' }, { role: 'SYSTEM_ADMIN' }],
  }).onConflictDoNothing({ target: schema.transactionTypes.code });

  // Root folder tree: Departments / Projects / Policies (idempotent by name at root)
  for (const name of ['Departments', 'Projects', 'Policies']) {
    const existing = await db.select({ id: schema.docFolders.id }).from(schema.docFolders)
      .where(and(eq(schema.docFolders.name, name), isNull(schema.docFolders.parentId))).limit(1);
    if (existing.length === 0) {
      await db.insert(schema.docFolders).values({ name, parentId: null, departmentId: null, confidential: false });
    }
  }
}
