/**
 * DMS-09: the digitisation pipeline — a scanning batch, then page-by-page indexing.
 *
 * Paper is captured first and understood afterwards, which is why a page exists before
 * anyone knows what it is. A page starts PENDING, becomes INDEXED once someone classifies
 * it, or FLAGGED when it cannot be read and needs rescanning. That distinction is the
 * point of the module: a batch is not finished because every page was scanned, it is
 * finished when every page has been accounted for.
 */
import {
  BadRequestException, Body, Controller, Get, Injectable, NotFoundException,
  Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';

const CreateBatchSchema = z.object({
  source: z.string().min(2).max(200),
  estimatedPages: z.number().int().min(0).max(100_000).optional(),
  defaultFolderId: z.string().optional().nullable(),
  operator: z.string().max(120).optional().nullable(),
});
const IndexPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  documentClass: z.string().min(1).max(120),
  title: z.string().max(200).optional().nullable(),
  reference: z.string().max(120).optional().nullable(),
});
const FlagPageSchema = z.object({
  pageNumber: z.number().int().positive(),
  reason: z.string().min(3).max(500),
});

@Injectable()
export class DigitisationService {
  constructor(private readonly audit: AuditService) {}

  private async nextRef(): Promise<string> {
    const year = new Date().getFullYear();
    const [row] = await db.select({ n: sql<number>`count(*)` }).from(schema.digitisationBatches);
    return `DGB-${year}-${String(Number(row?.n ?? 0) + 1).padStart(4, '0')}`;
  }

  async createBatch(user: AuthedUser, dto: z.infer<typeof CreateBatchSchema>, ip?: string) {
    if (dto.defaultFolderId) {
      const folder = await db.query.docFolders.findFirst({ where: eq(schema.docFolders.id, dto.defaultFolderId) });
      if (!folder) throw new BadRequestException('Default folder not found');
    }
    const ref = await this.nextRef();
    const [batch] = await db.insert(schema.digitisationBatches).values({
      ref, source: dto.source.trim(),
      estimatedPages: dto.estimatedPages ?? 0,
      defaultFolderId: dto.defaultFolderId ?? null,
      operator: dto.operator?.trim() ?? user.name,
      createdById: user.id,
    }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'DIGITISATION_BATCH_CREATED',
      entityType: 'digitisation_batch', entityId: ref,
      data: { source: batch.source, estimatedPages: batch.estimatedPages, operator: batch.operator }, ip,
    });
    return this.detail(batch.id);
  }

  /** Accepts the batch's id or its printed reference — an operator reads the reference. */
  private async byIdOrRef(idOrRef: string) {
    const batch = await db.query.digitisationBatches.findFirst({
      where: idOrRef.startsWith('DGB-')
        ? eq(schema.digitisationBatches.ref, idOrRef)
        : eq(schema.digitisationBatches.id, idOrRef),
    });
    if (!batch) throw new NotFoundException('Digitisation batch not found');
    return batch;
  }

  async indexPage(user: AuthedUser, idOrRef: string, dto: z.infer<typeof IndexPageSchema>, ip?: string) {
    const batch = await this.byIdOrRef(idOrRef);
    if (batch.status === 'CLOSED') throw new BadRequestException('This batch is closed — reopen it to index further pages');
    const existing = await db.query.digitisationPages.findFirst({
      where: and(eq(schema.digitisationPages.batchId, batch.id), eq(schema.digitisationPages.pageNumber, dto.pageNumber)),
    });
    const values = {
      documentClass: dto.documentClass.trim(),
      title: dto.title?.trim() ?? null,
      reference: dto.reference?.trim() ?? null,
      status: 'INDEXED' as const,
      flagReason: null,
      indexedById: user.id,
      indexedAt: new Date(),
    };
    if (existing) {
      await db.update(schema.digitisationPages).set(values).where(eq(schema.digitisationPages.id, existing.id));
    } else {
      await db.insert(schema.digitisationPages).values({ batchId: batch.id, pageNumber: dto.pageNumber, ...values });
    }
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'DIGITISATION_PAGE_INDEXED',
      entityType: 'digitisation_batch', entityId: batch.ref,
      data: { pageNumber: dto.pageNumber, documentClass: values.documentClass, title: values.title, reference: values.reference }, ip,
    });
    return this.detail(batch.id);
  }

  async flagPage(user: AuthedUser, idOrRef: string, dto: z.infer<typeof FlagPageSchema>, ip?: string) {
    const batch = await this.byIdOrRef(idOrRef);
    const existing = await db.query.digitisationPages.findFirst({
      where: and(eq(schema.digitisationPages.batchId, batch.id), eq(schema.digitisationPages.pageNumber, dto.pageNumber)),
    });
    const values = { status: 'FLAGGED' as const, flagReason: dto.reason.trim(), indexedById: user.id, indexedAt: new Date() };
    if (existing) {
      await db.update(schema.digitisationPages).set(values).where(eq(schema.digitisationPages.id, existing.id));
    } else {
      await db.insert(schema.digitisationPages).values({ batchId: batch.id, pageNumber: dto.pageNumber, ...values });
    }
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'DIGITISATION_PAGE_FLAGGED',
      entityType: 'digitisation_batch', entityId: batch.ref,
      data: { pageNumber: dto.pageNumber, reason: values.flagReason }, ip,
    });
    return this.detail(batch.id);
  }

  async detail(id: string) {
    const batch = await this.byIdOrRef(id);
    const pages = await db.select().from(schema.digitisationPages)
      .where(eq(schema.digitisationPages.batchId, batch.id))
      .orderBy(asc(schema.digitisationPages.pageNumber));
    const indexed = pages.filter((p) => p.status === 'INDEXED').length;
    const flagged = pages.filter((p) => p.status === 'FLAGGED').length;
    return {
      id: batch.id, ref: batch.ref, source: batch.source, operator: batch.operator,
      estimatedPages: batch.estimatedPages, defaultFolderId: batch.defaultFolderId,
      status: batch.status, createdAt: batch.createdAt,
      counts: {
        seen: pages.length, indexed, flagged,
        // What is left is measured against the estimate, because that is the number the
        // operator is working through — not against the pages already touched.
        outstanding: Math.max(0, batch.estimatedPages - indexed - flagged),
      },
      pages: pages.map((p) => ({
        pageNumber: p.pageNumber, status: p.status, documentClass: p.documentClass,
        title: p.title, reference: p.reference, flagReason: p.flagReason,
        indexedAt: p.indexedAt?.toISOString() ?? null,
      })),
    };
  }

  async list() {
    const rows = await db.select().from(schema.digitisationBatches)
      .orderBy(asc(schema.digitisationBatches.createdAt));
    return Promise.all(rows.map((r) => this.detail(r.id)));
  }
}

@Controller('v1/dms/digitisation')
@UseGuards(AuthGuard)
export class DigitisationController {
  constructor(private readonly svc: DigitisationService) {}

  @Get('batches')
  list() { return this.svc.list(); }

  @Get('batches/:id')
  detail(@Param('id') id: string) { return this.svc.detail(id); }

  @Post('batches')
  @RequireRoles('SYSTEM_ADMIN', 'INTERNAL_AUDIT', 'HR_OFFICER', 'FINANCE')
  create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    return this.svc.createBatch(user, CreateBatchSchema.parse(body), req.ip);
  }

  @Post('batches/:id/index')
  @RequireRoles('SYSTEM_ADMIN', 'INTERNAL_AUDIT', 'HR_OFFICER', 'FINANCE')
  index(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.indexPage(user, id, IndexPageSchema.parse(body), req.ip);
  }

  @Post('batches/:id/flag')
  @RequireRoles('SYSTEM_ADMIN', 'INTERNAL_AUDIT', 'HR_OFFICER', 'FINANCE')
  flag(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.flagPage(user, id, FlagPageSchema.parse(body), req.ip);
  }
}
