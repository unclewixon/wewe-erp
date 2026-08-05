/**
 * E-signature ceremonies (DMS-08a–d).
 * - Ordered signers, internal (session-authed) or external (single-use token + email OTP).
 * - Status flow OPEN → COMPLETED | DECLINED | VOIDED.
 * - Completion builds a tamper-evident certificate over the document version hash.
 * Every ceremony step writes an audit event.
 */
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpException,
  Injectable, NotFoundException, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { randomBytes, randomInt } from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, type AuthedUser } from '../../auth/auth';
import { DocStorageService } from './storage';
import { DmsService } from './repository';
import {
  allSigned, buildCertificate, canSignerAct, certificateHashMatches,
  nextRequiredSigner, type Certificate, type SignerStatus,
} from './dms.logic';

// ---------- zod ----------

const SignerInput = z.object({
  userId: z.string().min(1).optional(),
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
}).refine(
  (s) => (s.userId ? !s.name && !s.email : !!s.name && !!s.email),
  { message: 'Each signer is either internal {userId} or external {name, email}' },
);
const CreateRequestSchema = z.object({
  documentId: z.string().min(1),
  versionNo: z.number().int().positive().optional(),
  message: z.string().max(2000).optional().nullable(),
  deadline: z.coerce.date().optional().nullable(),
  signers: z.array(SignerInput).min(1).max(20),
});
const SignSchema = z.object({ method: z.enum(['drawn', 'typed', 'saved']) });
const DeclineSchema = z.object({ reason: z.string().min(3).max(1000) });
const OtpSchema = z.object({ otp: z.string().regex(/^\d{6}$/, 'OTP is 6 digits') });

type RequestRow = typeof schema.signatureRequests.$inferSelect;
type SignerRow = typeof schema.signatureSigners.$inferSelect;

@Injectable()
export class EsignService {
  constructor(
    private readonly audit: AuditService,
    private readonly storage: DocStorageService,
    private readonly dms: DmsService,
  ) {}

  /**
   * OTP-verified external tokens for this process (DMS-08d ceremony step:
   * verify → view → sign). In-memory by design: a restart simply requires
   * re-verifying the OTP, which stays valid until the request closes.
   */
  private readonly verifiedTokens = new Map<string, number>();
  markVerified(token: string): void { this.verifiedTokens.set(token, Date.now()); }
  isVerified(token: string): boolean { return this.verifiedTokens.has(token); }
  clearVerified(token: string): void { this.verifiedTokens.delete(token); }

  get auditSvc() { return this.audit; }
  get dmsSvc() { return this.dms; }
  get storageSvc() { return this.storage; }

  async request(id: string): Promise<RequestRow> {
    const row = await db.query.signatureRequests.findFirst({ where: eq(schema.signatureRequests.id, id) });
    if (!row) throw new NotFoundException('Signature request not found');
    return row;
  }

  async signers(requestId: string): Promise<SignerRow[]> {
    return db.select().from(schema.signatureSigners)
      .where(eq(schema.signatureSigners.requestId, requestId))
      .orderBy(schema.signatureSigners.orderNo);
  }

  /** OPEN + not past deadline, else throw. Token links expire with the request deadline. */
  assertOpen(request: RequestRow): void {
    if (request.status !== 'OPEN') {
      throw new BadRequestException(`Signature request is ${request.status}`);
    }
    if (request.deadline && request.deadline.getTime() < Date.now()) {
      throw new HttpException('Signature request has expired', 410);
    }
  }

  async signerName(s: SignerRow): Promise<string> {
    if (s.userId) {
      const u = await db.query.users.findFirst({ where: eq(schema.users.id, s.userId), columns: { name: true } });
      return u?.name ?? 'Unknown user';
    }
    return s.externalName ?? 'External signer';
  }

  /** sha256 of the document's CURRENT version at sign time (detects mid-ceremony edits). */
  async currentDocSha(documentId: string): Promise<string> {
    const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, documentId) });
    if (!doc) throw new NotFoundException('Document not found');
    return doc.sha256;
  }

  /** Record a signature on a signer row; complete the request when it was the last one. */
  async applySignature(
    request: RequestRow, signer: SignerRow, method: string, ip: string | null,
    actor: { actorId?: string | null; actorEmail?: string | null },
  ): Promise<{ completed: boolean }> {
    const docSha = await this.currentDocSha(request.documentId);
    const signedAt = new Date();
    await db.update(schema.signatureSigners).set({
      status: 'SIGNED', method, docSha256AtSign: docSha, ip, signedAt,
      // single-use external credentials burn on signature
      ...(signer.externalToken ? { externalToken: null, otpCode: null } : {}),
    }).where(eq(schema.signatureSigners.id, signer.id));
    await this.audit.log({
      ...actor, action: 'ESIGN_SIGNED', entityType: 'signature_request', entityId: request.id,
      data: { signerId: signer.id, orderNo: signer.orderNo, method, docSha256AtSign: docSha }, ip,
    });
    const after = await this.signers(request.id);
    const states = after.map((s) => ({ id: s.id, orderNo: s.orderNo, status: s.status as SignerStatus }));
    if (!allSigned(states)) return { completed: false };
    await this.complete(request, after);
    return { completed: true };
  }

  private async complete(request: RequestRow, signers: SignerRow[]): Promise<void> {
    const version = await db.query.docVersions.findFirst({
      where: and(
        eq(schema.docVersions.documentId, request.documentId),
        eq(schema.docVersions.versionNo, request.versionNo),
      ),
    });
    const certSigners = [];
    for (const s of signers) {
      certSigners.push({
        orderNo: s.orderNo, name: await this.signerName(s), method: s.method ?? 'typed',
        signedAt: s.signedAt ?? new Date(), ip: s.ip, external: !s.userId,
      });
    }
    const certificate = buildCertificate({
      documentId: request.documentId, versionNo: request.versionNo,
      sha256: version?.sha256 ?? '', completedAt: new Date(), signers: certSigners,
    });
    await db.update(schema.signatureRequests)
      .set({ status: 'COMPLETED', certificate })
      .where(eq(schema.signatureRequests.id, request.id));
    await this.audit.log({
      action: 'ESIGN_COMPLETED', entityType: 'signature_request', entityId: request.id,
      data: { documentId: request.documentId, versionNo: request.versionNo, sha256: certificate.sha256 },
    });
  }

  async decline(
    request: RequestRow, signer: SignerRow, reason: string, ip: string | null,
    actor: { actorId?: string | null; actorEmail?: string | null },
  ): Promise<void> {
    await db.update(schema.signatureSigners).set({
      status: 'DECLINED', declineReason: reason, ip,
      ...(signer.externalToken ? { externalToken: null, otpCode: null } : {}),
    }).where(eq(schema.signatureSigners.id, signer.id));
    await db.update(schema.signatureRequests).set({ status: 'DECLINED' })
      .where(eq(schema.signatureRequests.id, request.id));
    await this.audit.log({
      ...actor, action: 'ESIGN_DECLINED', entityType: 'signature_request', entityId: request.id,
      data: { signerId: signer.id, orderNo: signer.orderNo, reason }, ip,
    });
  }

  signerJson(s: SignerRow, name: string) {
    // never leak token/otp
    return {
      id: s.id, orderNo: s.orderNo, name,
      internal: !!s.userId, externalEmail: s.externalEmail,
      status: s.status, method: s.method, declineReason: s.declineReason,
      signedAt: s.signedAt, docSha256AtSign: s.docSha256AtSign,
    };
  }

  async requestJson(request: RequestRow) {
    const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, request.documentId) });
    const signers = await this.signers(request.id);
    const out = [];
    for (const s of signers) out.push(this.signerJson(s, await this.signerName(s)));
    const next = nextRequiredSigner(signers.map((s) => ({ id: s.id, orderNo: s.orderNo, status: s.status as SignerStatus })));
    return {
      id: request.id, documentId: request.documentId,
      documentName: doc?.name ?? null, versionNo: request.versionNo,
      requestedById: request.requestedById, message: request.message,
      deadline: request.deadline, status: request.status,
      certificate: (request.certificate as Certificate | null) ?? null,
      nextSignerId: request.status === 'OPEN' ? next?.id ?? null : null,
      createdAt: request.createdAt, signers: out,
    };
  }
}

// ---------- internal (session-authed) endpoints ----------

@Controller('v1/esign')
@UseGuards(AuthGuard)
export class EsignController {
  constructor(private readonly svc: EsignService) {}

  /** DMS-08a: create a request on a document version with ordered signers. */
  @Post('requests')
  async create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    const dto = CreateRequestSchema.parse(body);
    const doc = await this.svc.dmsSvc.doc(dto.documentId);
    this.svc.dmsSvc.assertNotDisposed(doc);
    await this.svc.dmsSvc.assertReadable(user, doc);
    const versionNo = dto.versionNo ?? doc.currentVersion;
    const version = await db.query.docVersions.findFirst({
      where: and(eq(schema.docVersions.documentId, doc.id), eq(schema.docVersions.versionNo, versionNo)),
    });
    if (!version) throw new BadRequestException(`Document has no version ${versionNo}`);
    if (dto.deadline && dto.deadline.getTime() <= Date.now()) {
      throw new BadRequestException('Deadline must be in the future');
    }

    const [request] = await db.insert(schema.signatureRequests).values({
      documentId: doc.id, versionNo, requestedById: user.id,
      message: dto.message ?? null, deadline: dto.deadline ?? null, status: 'OPEN',
    }).returning();

    const externalInvites: { email: string; token: string }[] = [];
    let orderNo = 1;
    for (const s of dto.signers) {
      if (s.userId) {
        const u = await db.query.users.findFirst({ where: eq(schema.users.id, s.userId) });
        if (!u || !u.active) throw new BadRequestException(`Signer user ${s.userId} not found or inactive`);
        await db.insert(schema.signatureSigners).values({
          requestId: request.id, orderNo, userId: u.id, status: 'PENDING',
        });
      } else {
        const token = randomBytes(24).toString('hex'); // single-use link token (DMS-08d)
        const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
        await db.insert(schema.signatureSigners).values({
          requestId: request.id, orderNo, externalName: s.name!, externalEmail: s.email!,
          externalToken: token, otpCode: otp, status: 'PENDING',
        });
        externalInvites.push({ email: s.email!, token });
        // OTP goes out by email only — never in an API response
        await db.insert(schema.emailOutbox).values({
          toEmail: s.email!,
          subject: `Signature requested: ${doc.name}`,
          body: `${user.name} requests your signature on "${doc.name}" (v${versionNo}).\n`
            + `Open: /esign/external/${token}\nYour one-time code: ${otp}\n`
            + (request.deadline ? `Sign before ${request.deadline.toISOString()}.` : ''),
        });
      }
      orderNo += 1;
    }
    await this.svc.auditSvc.log({
      actorId: user.id, actorEmail: user.email, action: 'ESIGN_REQUEST_CREATED',
      entityType: 'signature_request', entityId: request.id,
      data: { documentId: doc.id, versionNo, signers: dto.signers.length, external: externalInvites.length },
      ip: req.ip,
    });
    return {
      ...(await this.svc.requestJson(request)),
      // tokens returned so the requester can hand out links; OTPs travel by email
      externalInvites,
    };
  }

  @Get('requests')
  async list(@CurrentUser() user: AuthedUser, @Query('scope') scope?: string) {
    if (scope === 'to-sign') {
      const mine = await db.select().from(schema.signatureSigners).where(and(
        eq(schema.signatureSigners.userId, user.id), eq(schema.signatureSigners.status, 'PENDING'),
      ));
      if (mine.length === 0) return [];
      const reqs = await db.select().from(schema.signatureRequests).where(and(
        inArray(schema.signatureRequests.id, mine.map((s) => s.requestId)),
        eq(schema.signatureRequests.status, 'OPEN'),
      )).orderBy(desc(schema.signatureRequests.createdAt));
      const out = [];
      for (const r of reqs) out.push(await this.svc.requestJson(r));
      return out;
    }
    const reqs = await db.select().from(schema.signatureRequests)
      .where(eq(schema.signatureRequests.requestedById, user.id))
      .orderBy(desc(schema.signatureRequests.createdAt)).limit(100);
    const out = [];
    for (const r of reqs) out.push(await this.svc.requestJson(r));
    return out;
  }

  @Get('requests/:id')
  async get(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    const request = await this.svc.request(id);
    const signers = await this.svc.signers(id);
    const privileged = user.roles.some((r) => ['SYSTEM_ADMIN', 'INTERNAL_AUDIT'].includes(r.code));
    const involved = request.requestedById === user.id || signers.some((s) => s.userId === user.id);
    if (!involved && !privileged) throw new ForbiddenException('Not your signature request');
    return this.svc.requestJson(request);
  }

  /** Void — requester only, while OPEN. */
  @Post('requests/:id/void')
  async void(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    const request = await this.svc.request(id);
    if (request.requestedById !== user.id) throw new ForbiddenException('Only the requester can void');
    if (request.status !== 'OPEN') throw new BadRequestException(`Request is already ${request.status}`);
    await db.update(schema.signatureRequests).set({ status: 'VOIDED' })
      .where(eq(schema.signatureRequests.id, id));
    await this.svc.auditSvc.log({
      actorId: user.id, actorEmail: user.email, action: 'ESIGN_VOIDED',
      entityType: 'signature_request', entityId: id, ip: req.ip,
    });
    return this.svc.requestJson(await this.svc.request(id));
  }

  /** DMS-08b: internal signing — order-enforced, hash + ip + time recorded. */
  @Post('requests/:id/sign')
  async sign(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = SignSchema.parse(body);
    const request = await this.svc.request(id);
    this.svc.assertOpen(request);
    const signers = await this.svc.signers(id);
    const me = signers.find((s) => s.userId === user.id && s.status === 'PENDING')
      ?? signers.find((s) => s.userId === user.id);
    if (!me) throw new ForbiddenException('You are not a signer on this request');
    const d = canSignerAct(
      signers.map((s) => ({ id: s.id, orderNo: s.orderNo, status: s.status as SignerStatus })), me.id);
    if (!d.ok) throw new ForbiddenException(d.reason);
    await this.svc.applySignature(request, me, dto.method, req.ip ?? null,
      { actorId: user.id, actorEmail: user.email });
    return this.svc.requestJson(await this.svc.request(id));
  }

  /** Decline (mandatory reason) halts the whole request. */
  @Post('requests/:id/decline')
  async decline(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = DeclineSchema.parse(body);
    const request = await this.svc.request(id);
    this.svc.assertOpen(request);
    const signers = await this.svc.signers(id);
    const me = signers.find((s) => s.userId === user.id && s.status === 'PENDING');
    if (!me) throw new ForbiddenException('You are not a pending signer on this request');
    await this.svc.decline(request, me, dto.reason, req.ip ?? null,
      { actorId: user.id, actorEmail: user.email });
    return this.svc.requestJson(await this.svc.request(id));
  }

  /** DMS-08c: certificate + whether the stored bytes still hash to the signed value. */
  @Get('verify/:requestId')
  async verify(@Param('requestId') requestId: string) {
    const request = await this.svc.request(requestId);
    const certificate = (request.certificate as Certificate | null) ?? null;
    if (!certificate) return { requestId, status: request.status, certificate: null };
    const version = await db.query.docVersions.findFirst({
      where: and(
        eq(schema.docVersions.documentId, request.documentId),
        eq(schema.docVersions.versionNo, request.versionNo),
      ),
    });
    let currentFileSha256: string | null = null;
    if (version) {
      const bytes = await this.svc.storageSvc.read(version.storageKey);
      currentFileSha256 = bytes ? this.svc.storageSvc.sha256(bytes) : null;
    }
    return {
      requestId, status: request.status, certificate,
      storedSha256: version?.sha256 ?? null,
      currentFileSha256,
      fileFound: currentFileSha256 !== null,
      hashMatches: certificateHashMatches(certificate, currentFileSha256),
    };
  }
}

// ---------- external (token-gated, NO AuthGuard — DMS-08d) ----------

@Controller('v1/esign/external')
export class EsignExternalController {
  constructor(private readonly svc: EsignService) {}

  private async signerByToken(token: string): Promise<SignerRow> {
    if (!/^[0-9a-f]{16,128}$/.test(token)) throw new NotFoundException('Invalid link');
    const signer = await db.query.signatureSigners.findFirst({
      where: eq(schema.signatureSigners.externalToken, token),
    });
    if (!signer) throw new NotFoundException('This signing link is no longer valid');
    return signer;
  }

  /** Step 1: prove control of the invited mailbox with the emailed 6-digit OTP. */
  @Post(':token/verify')
  async verifyOtp(@Param('token') token: string, @Body() body: unknown, @Req() req: any) {
    const dto = OtpSchema.parse(body);
    const signer = await this.signerByToken(token);
    const request = await this.svc.request(signer.requestId);
    this.svc.assertOpen(request);
    if (!signer.otpCode || signer.otpCode !== dto.otp) {
      await this.svc.auditSvc.log({
        actorEmail: signer.externalEmail, action: 'ESIGN_OTP_FAILED',
        entityType: 'signature_request', entityId: request.id,
        data: { signerId: signer.id }, ip: req.ip,
      });
      throw new ForbiddenException('Incorrect code');
    }
    this.svc.markVerified(token);
    await this.svc.auditSvc.log({
      actorEmail: signer.externalEmail, action: 'ESIGN_OTP_VERIFIED',
      entityType: 'signature_request', entityId: request.id,
      data: { signerId: signer.id }, ip: req.ip,
    });
    return { ok: true };
  }

  /** Step 2 (after OTP verify): request + document metadata for the ceremony screen. */
  @Get(':token')
  async view(@Param('token') token: string, @Req() req: any) {
    const signer = await this.signerByToken(token);
    const request = await this.svc.request(signer.requestId);
    this.svc.assertOpen(request);
    if (!this.svc.isVerified(token)) {
      return { needsOtp: true, email: maskEmail(signer.externalEmail) };
    }
    const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, request.documentId) });
    const signers = await this.svc.signers(request.id);
    const yourTurn = canSignerAct(
      signers.map((s) => ({ id: s.id, orderNo: s.orderNo, status: s.status as SignerStatus })), signer.id).ok;
    await this.svc.auditSvc.log({
      actorEmail: signer.externalEmail, action: 'ESIGN_EXTERNAL_VIEWED',
      entityType: 'signature_request', entityId: request.id,
      data: { signerId: signer.id }, ip: req.ip,
    });
    return {
      needsOtp: false,
      request: {
        id: request.id, message: request.message, deadline: request.deadline, status: request.status,
        document: doc ? { name: doc.name, mime: doc.mime, sizeBytes: doc.sizeBytes, versionNo: request.versionNo, sha256: doc.sha256 } : null,
        yourOrderNo: signer.orderNo, yourStatus: signer.status, yourTurn,
        signers: signers.map((s) => ({ orderNo: s.orderNo, status: s.status, internal: !!s.userId })),
      },
    };
  }

  /** Step 3: sign — single use; order-enforced; expires with the request deadline. */
  @Post(':token/sign')
  async sign(@Param('token') token: string, @Body() body: unknown, @Req() req: any) {
    const dto = SignSchema.parse(body);
    const signer = await this.signerByToken(token);
    const request = await this.svc.request(signer.requestId);
    this.svc.assertOpen(request);
    if (!this.svc.isVerified(token)) throw new ForbiddenException('Verify the emailed code first');
    const signers = await this.svc.signers(request.id);
    const d = canSignerAct(
      signers.map((s) => ({ id: s.id, orderNo: s.orderNo, status: s.status as SignerStatus })), signer.id);
    if (!d.ok) throw new ForbiddenException(d.reason);
    const { completed } = await this.svc.applySignature(request, signer, dto.method, req.ip ?? null,
      { actorEmail: signer.externalEmail });
    this.svc.clearVerified(token); // token burned — single use
    return { ok: true, completed };
  }

  @Post(':token/decline')
  async decline(@Param('token') token: string, @Body() body: unknown, @Req() req: any) {
    const dto = DeclineSchema.parse(body);
    const signer = await this.signerByToken(token);
    const request = await this.svc.request(signer.requestId);
    this.svc.assertOpen(request);
    if (!this.svc.isVerified(token)) throw new ForbiddenException('Verify the emailed code first');
    await this.svc.decline(request, signer, dto.reason, req.ip ?? null,
      { actorEmail: signer.externalEmail });
    this.svc.clearVerified(token);
    return { ok: true };
  }
}

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}
