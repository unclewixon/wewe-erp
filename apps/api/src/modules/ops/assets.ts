/**
 * AST-01..04 — Asset register CRUD, two-step custody (assign/transfer/return with
 * custodian acknowledgement), verification campaigns, disposal via the
 * ASSET_DISPOSAL approval workflow, and the straight-line depreciation report.
 *
 * Verification campaigns have no dedicated table; each campaign lives as a
 * settings row under key 'assets.campaign.<id>' (jsonb value).
 */
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Injectable,
  NotFoundException, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { asc, desc, eq, like } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';
import { WorkflowService } from '../../workflow/workflow.service';
import { monthsBetween, straightLine } from './ops.logic';
import { KoboString, loadCategoryLives } from './shared';

const CAMPAIGN_KEY_PREFIX = 'assets.campaign.';
const DEFAULT_LIFE_MONTHS = 36;

const CreateSchema = z.object({
  tag: z.string().min(2).max(60),
  description: z.string().min(2).max(300),
  category: z.string().min(2).max(60),
  location: z.string().max(120).optional().nullable(),
  /** Funding source — the donor code the asset was bought under. */
  fundingCode: z.string().max(40).optional().nullable(),
  costKobo: KoboString,
  acquiredAt: z.coerce.date().optional().nullable(),
  usefulLifeMonths: z.number().int().positive().max(600).optional().nullable(),
  photos: z.array(z.string()).max(20).optional(),
});
const UpdateSchema = CreateSchema.partial().omit({ tag: true, costKobo: true });
const AssignSchema = z.object({ custodianId: z.string().min(1), note: z.string().max(500).optional() });
const TransferSchema = z.object({ toCustodianId: z.string().min(1), note: z.string().max(500).optional() });
const DisposalSchema = z.object({
  method: z.enum(['sale', 'donation', 'writeoff']),
  proceedsKobo: KoboString.optional(),
  reason: z.string().max(2000).optional(),
});
const CampaignStartSchema = z.object({ location: z.string().min(1).max(120), title: z.string().max(200).optional() });
const CampaignVerifySchema = z.object({
  assetId: z.string().min(1),
  condition: z.enum(['GOOD', 'FAIR', 'DAMAGED', 'NEEDS_REPAIR']).optional(),
  location: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
});

type Campaign = {
  id: string; title: string; location: string;
  status: 'OPEN' | 'CLOSED';
  startedById: string; startedAt: string; closedAt?: string;
  /** Asset ids expected at the location when the campaign opened. */
  expected: string[];
  /** Asset ids verified so far (may include unexpected finds). */
  verified: string[];
};

@Injectable()
export class AssetsService {
  constructor(private readonly audit: AuditService, private readonly workflow: WorkflowService) {}

  async byId(id: string) {
    const a = await db.query.assets.findFirst({ where: eq(schema.assets.id, id) });
    if (!a) throw new NotFoundException('Asset not found');
    return a;
  }

  private out(a: typeof schema.assets.$inferSelect, custodianName?: string | null) {
    return {
      id: a.id, tag: a.tag, description: a.description, category: a.category,
      custodianId: a.custodianId, custodianName: custodianName ?? undefined,
      location: a.location, fundingCode: a.fundingCode,
      costKobo: a.costKobo.toString(), acquiredAt: a.acquiredAt,
      usefulLifeMonths: a.usefulLifeMonths, status: a.status, photos: a.photos, createdAt: a.createdAt,
    };
  }

  private async addEvent(assetId: string, kind: string, actorId: string, data: Record<string, unknown>) {
    await db.insert(schema.assetEvents).values({ assetId, kind, actorId, data });
  }

  // ---------- register CRUD ----------

  async create(user: AuthedUser, dto: z.infer<typeof CreateSchema>, ip?: string) {
    const existing = await db.query.assets.findFirst({ where: eq(schema.assets.tag, dto.tag) });
    if (existing) throw new BadRequestException(`Asset tag ${dto.tag} is already registered`);
    const [a] = await db.insert(schema.assets).values({
      tag: dto.tag, description: dto.description, category: dto.category,
      location: dto.location ?? null, fundingCode: dto.fundingCode ?? null,
      costKobo: BigInt(dto.costKobo), acquiredAt: dto.acquiredAt ?? null,
      usefulLifeMonths: dto.usefulLifeMonths ?? null, photos: dto.photos ?? null,
    }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'ASSET_REGISTERED',
      entityType: 'asset', entityId: a.tag,
      data: { description: dto.description, category: dto.category, costKobo: dto.costKobo, fundingCode: dto.fundingCode ?? null }, ip,
    });
    return this.out(a);
  }

  async list(filters: { status?: string; category?: string; location?: string; custodianId?: string; q?: string }) {
    const rows = await db.select().from(schema.assets).orderBy(asc(schema.assets.tag)).limit(1000);
    const out = [];
    for (const a of rows) {
      if (filters.status && a.status !== filters.status) continue;
      if (filters.category && a.category !== filters.category) continue;
      if (filters.location && a.location !== filters.location) continue;
      if (filters.custodianId && a.custodianId !== filters.custodianId) continue;
      if (filters.q) {
        const q = filters.q.toLowerCase();
        if (!a.tag.toLowerCase().includes(q) && !a.description.toLowerCase().includes(q)) continue;
      }
      const custodian = a.custodianId
        ? await db.query.users.findFirst({ where: eq(schema.users.id, a.custodianId), columns: { name: true } })
        : null;
      out.push(this.out(a, custodian?.name ?? null));
    }
    return out;
  }

  async detail(id: string) {
    const a = await this.byId(id);
    const custodian = a.custodianId
      ? await db.query.users.findFirst({ where: eq(schema.users.id, a.custodianId), columns: { name: true } })
      : null;
    const events = await db.select().from(schema.assetEvents)
      .where(eq(schema.assetEvents.assetId, id)).orderBy(desc(schema.assetEvents.createdAt));
    const history = [];
    for (const e of events) {
      const actor = await db.query.users.findFirst({ where: eq(schema.users.id, e.actorId), columns: { name: true } });
      history.push({ id: e.id, kind: e.kind, data: e.data, actor: actor?.name ?? null, at: e.createdAt });
    }
    return { ...this.out(a, custodian?.name ?? null), events: history };
  }

  async update(user: AuthedUser, id: string, dto: z.infer<typeof UpdateSchema>, ip?: string) {
    const a = await this.byId(id);
    const [next] = await db.update(schema.assets).set({
      description: dto.description ?? a.description,
      category: dto.category ?? a.category,
      location: dto.location === undefined ? a.location : dto.location,
      fundingCode: dto.fundingCode === undefined ? a.fundingCode : dto.fundingCode,
      acquiredAt: dto.acquiredAt === undefined ? a.acquiredAt : dto.acquiredAt,
      usefulLifeMonths: dto.usefulLifeMonths === undefined ? a.usefulLifeMonths : dto.usefulLifeMonths,
      photos: dto.photos === undefined ? a.photos : dto.photos,
    }).where(eq(schema.assets.id, id)).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'ASSET_UPDATED',
      entityType: 'asset', entityId: a.tag, data: { fields: Object.keys(dto) }, ip,
    });
    return this.out(next);
  }

  // ---------- custody: two-step assign / transfer / return ----------

  async assign(user: AuthedUser, id: string, dto: z.infer<typeof AssignSchema>, ip?: string) {
    const a = await this.byId(id);
    if (a.status === 'DISPOSED') throw new BadRequestException('Disposed assets cannot be assigned');
    const custodian = await db.query.users.findFirst({ where: eq(schema.users.id, dto.custodianId) });
    if (!custodian || !custodian.active) throw new BadRequestException('Custodian not found or inactive');
    const kind = a.custodianId && a.custodianId !== dto.custodianId ? 'TRANSFER' : 'ASSIGN';
    await db.update(schema.assets)
      .set({ custodianId: dto.custodianId, status: a.status === 'IN_STORE' ? 'IN_SERVICE' : a.status })
      .where(eq(schema.assets.id, id));
    await this.addEvent(id, kind, user.id, {
      step: 'ASSIGNED', fromCustodianId: a.custodianId, toCustodianId: dto.custodianId,
      toCustodianName: custodian.name, note: dto.note ?? null, acknowledged: false,
    });
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: `ASSET_${kind}_INITIATED`,
      entityType: 'asset', entityId: a.tag, data: { custodian: custodian.name, note: dto.note ?? null }, ip,
    });
    return this.detail(id);
  }

  /** Step 2: the custodian acknowledges receipt of the assignment/transfer. */
  async acknowledge(user: AuthedUser, id: string, ip?: string) {
    const a = await this.byId(id);
    if (a.custodianId !== user.id) {
      throw new ForbiddenException('Only the assigned custodian can acknowledge this asset');
    }
    const events = await db.select().from(schema.assetEvents)
      .where(eq(schema.assetEvents.assetId, id)).orderBy(desc(schema.assetEvents.createdAt));
    const pending = events.find((e) =>
      (e.kind === 'ASSIGN' || e.kind === 'TRANSFER') &&
      (e.data as any)?.step === 'ASSIGNED' && (e.data as any)?.toCustodianId === user.id);
    const acked = events.find((e) =>
      (e.kind === 'ASSIGN' || e.kind === 'TRANSFER') &&
      (e.data as any)?.step === 'ACKNOWLEDGED' && e.actorId === user.id &&
      pending && e.createdAt > pending.createdAt);
    if (!pending) throw new BadRequestException('Nothing awaiting acknowledgement for you on this asset');
    if (acked) throw new BadRequestException('Already acknowledged');
    await this.addEvent(id, pending.kind, user.id, { step: 'ACKNOWLEDGED', of: pending.id });
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: `ASSET_${pending.kind}_ACKNOWLEDGED`,
      entityType: 'asset', entityId: a.tag, ip,
    });
    return this.detail(id);
  }

  async transfer(user: AuthedUser, id: string, dto: z.infer<typeof TransferSchema>, ip?: string) {
    const a = await this.byId(id);
    if (!a.custodianId) throw new BadRequestException('Asset has no current custodian — use assign instead');
    if (a.custodianId === dto.toCustodianId) throw new BadRequestException('Asset is already with that custodian');
    return this.assign(user, id, { custodianId: dto.toCustodianId, note: dto.note }, ip);
  }

  /** Custodian hands the asset back; store/admin acknowledges the return. */
  async initiateReturn(user: AuthedUser, id: string, note: string | undefined, ip?: string) {
    const a = await this.byId(id);
    if (!a.custodianId) throw new BadRequestException('Asset has no custodian to return from');
    if (a.custodianId !== user.id && !user.roles.some((r) => ['SYSTEM_ADMIN', 'FINANCE'].includes(r.code))) {
      throw new ForbiddenException('Only the custodian (or Finance/Admin) can initiate a return');
    }
    await this.addEvent(id, 'RETURN', user.id, { step: 'RETURNED', fromCustodianId: a.custodianId, note: note ?? null });
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'ASSET_RETURN_INITIATED',
      entityType: 'asset', entityId: a.tag, data: { note: note ?? null }, ip,
    });
    return this.detail(id);
  }

  async acknowledgeReturn(user: AuthedUser, id: string, ip?: string) {
    const a = await this.byId(id);
    const events = await db.select().from(schema.assetEvents)
      .where(eq(schema.assetEvents.assetId, id)).orderBy(desc(schema.assetEvents.createdAt));
    const pending = events.find((e) => e.kind === 'RETURN' && (e.data as any)?.step === 'RETURNED');
    if (!pending || !a.custodianId) throw new BadRequestException('No pending return on this asset');
    await db.update(schema.assets)
      .set({ custodianId: null, status: a.status === 'IN_SERVICE' ? 'IN_STORE' : a.status })
      .where(eq(schema.assets.id, id));
    await this.addEvent(id, 'RETURN', user.id, { step: 'ACKNOWLEDGED', of: pending.id, fromCustodianId: a.custodianId });
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'ASSET_RETURN_ACKNOWLEDGED',
      entityType: 'asset', entityId: a.tag, ip,
    });
    return this.detail(id);
  }

  // ---------- disposal via ASSET_DISPOSAL workflow ----------

  async requestDisposal(user: AuthedUser, id: string, dto: z.infer<typeof DisposalSchema>, ip?: string) {
    const a = await this.byId(id);
    if (a.status === 'DISPOSED') throw new BadRequestException('Asset is already disposed');
    if (dto.method === 'sale' && !dto.proceedsKobo) {
      throw new BadRequestException('Sale disposals must state expected proceeds (proceedsKobo)');
    }
    const tx = await this.workflow.createTransaction(user, {
      typeCode: 'ASSET_DISPOSAL',
      title: `Asset disposal (${dto.method}): ${a.tag} — ${a.description}`,
      amountKobo: dto.proceedsKobo ? BigInt(dto.proceedsKobo) : 0n,
      payload: {
        assetId: a.id, assetTag: a.tag, method: dto.method,
        proceedsKobo: dto.proceedsKobo ?? null, reason: dto.reason ?? null,
      },
      submit: true, ip,
    });
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'ASSET_DISPOSAL_REQUESTED',
      entityType: 'asset', entityId: a.tag,
      data: { txRef: tx.ref, method: dto.method, proceedsKobo: dto.proceedsKobo ?? null }, ip,
    });
    return { asset: this.out(a), transaction: { id: tx.id, ref: tx.ref, status: tx.status } };
  }

  /** onFinalApproval hook body — idempotent: a second run on a DISPOSED asset is a no-op. */
  static async applyDisposal(tx: { id: string; ref: string; initiatorId: string; payload: unknown }) {
    const payload = (tx.payload ?? {}) as { assetId?: string; method?: string; proceedsKobo?: string | null };
    if (!payload.assetId) return;
    const asset = await db.query.assets.findFirst({ where: eq(schema.assets.id, payload.assetId) });
    if (!asset || asset.status === 'DISPOSED') return;
    await db.update(schema.assets)
      .set({ status: 'DISPOSED', custodianId: null })
      .where(eq(schema.assets.id, payload.assetId));
    await db.insert(schema.assetEvents).values({
      assetId: payload.assetId, kind: 'DISPOSE', actorId: tx.initiatorId,
      data: { txRef: tx.ref, method: payload.method ?? null, proceedsKobo: payload.proceedsKobo ?? null },
    });
    await new AuditService().log({
      action: 'ASSET_DISPOSED', entityType: 'asset', entityId: asset.tag,
      data: { txRef: tx.ref, method: payload.method ?? null, proceedsKobo: payload.proceedsKobo ?? null },
    });
  }

  // ---------- depreciation report ----------

  /** Straight-line monthly NBV per asset plus totals (pure math in ops.logic). */
  async depreciationReport(asOf: Date) {
    const lives = await loadCategoryLives();
    const rows = await db.select().from(schema.assets).orderBy(asc(schema.assets.tag));
    const out = [];
    let totalCost = 0n, totalAccumulated = 0n, totalNbv = 0n;
    for (const a of rows) {
      if (a.status === 'DISPOSED') continue;
      const life = a.usefulLifeMonths ?? lives.get(a.category) ?? DEFAULT_LIFE_MONTHS;
      const from = a.acquiredAt ?? a.createdAt;
      const months = monthsBetween(from, asOf);
      const d = straightLine(a.costKobo, life, months);
      totalCost += a.costKobo;
      totalAccumulated += d.accumulatedKobo;
      totalNbv += d.nbvKobo;
      out.push({
        id: a.id, tag: a.tag, description: a.description, category: a.category, status: a.status,
        costKobo: a.costKobo.toString(), acquiredAt: from, usefulLifeMonths: life, monthsElapsed: months,
        monthlyKobo: d.monthlyKobo.toString(),
        accumulatedKobo: d.accumulatedKobo.toString(),
        nbvKobo: d.nbvKobo.toString(),
      });
    }
    return {
      asOf,
      assets: out,
      totals: {
        costKobo: totalCost.toString(),
        accumulatedKobo: totalAccumulated.toString(),
        nbvKobo: totalNbv.toString(),
      },
    };
  }

  // ---------- verification campaigns (settings-backed) ----------

  private async campaignRow(id: string) {
    const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, `${CAMPAIGN_KEY_PREFIX}${id}`) });
    if (!row) throw new NotFoundException('Verification campaign not found');
    return { key: row.key, campaign: row.value as Campaign };
  }

  private async saveCampaign(key: string, campaign: Campaign, userId: string) {
    await db.update(schema.settings)
      .set({ value: campaign, updatedById: userId, updatedAt: new Date() })
      .where(eq(schema.settings.key, key));
  }

  async startCampaign(user: AuthedUser, dto: z.infer<typeof CampaignStartSchema>, ip?: string) {
    const expected = (await db.select().from(schema.assets).where(eq(schema.assets.location, dto.location)))
      .filter((a) => a.status !== 'DISPOSED');
    if (!expected.length) throw new BadRequestException(`No registered assets at location "${dto.location}"`);
    const id = randomBytes(6).toString('hex');
    const campaign: Campaign = {
      id, title: dto.title ?? `Verification — ${dto.location}`, location: dto.location,
      status: 'OPEN', startedById: user.id, startedAt: new Date().toISOString(),
      expected: expected.map((a) => a.id), verified: [],
    };
    await db.insert(schema.settings).values({
      key: `${CAMPAIGN_KEY_PREFIX}${id}`, value: campaign, updatedById: user.id,
    });
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'ASSET_CAMPAIGN_STARTED',
      entityType: 'asset_campaign', entityId: id,
      data: { location: dto.location, expectedCount: expected.length }, ip,
    });
    return this.campaignSummary(id);
  }

  async listCampaigns() {
    const rows = await db.select().from(schema.settings)
      .where(like(schema.settings.key, `${CAMPAIGN_KEY_PREFIX}%`));
    return rows.map((r) => {
      const c = r.value as Campaign;
      return {
        id: c.id, title: c.title, location: c.location, status: c.status,
        startedAt: c.startedAt, closedAt: c.closedAt ?? null,
        expectedCount: c.expected.length, verifiedCount: c.verified.length,
      };
    }).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  async campaignSummary(id: string) {
    const { campaign } = await this.campaignRow(id);
    const verifiedSet = new Set(campaign.verified);
    const missingIds = campaign.expected.filter((a) => !verifiedSet.has(a));
    const describe = async (assetId: string) => {
      const a = await db.query.assets.findFirst({ where: eq(schema.assets.id, assetId) });
      return a ? { id: a.id, tag: a.tag, description: a.description, status: a.status, location: a.location } : { id: assetId };
    };
    return {
      id: campaign.id, title: campaign.title, location: campaign.location, status: campaign.status,
      startedAt: campaign.startedAt, closedAt: campaign.closedAt ?? null,
      expectedCount: campaign.expected.length, verifiedCount: campaign.verified.length,
      missingCount: missingIds.length,
      verified: await Promise.all(campaign.verified.map(describe)),
      missing: await Promise.all(missingIds.map(describe)),
    };
  }

  async verifyAsset(user: AuthedUser, campaignId: string, dto: z.infer<typeof CampaignVerifySchema>, ip?: string) {
    const { key, campaign } = await this.campaignRow(campaignId);
    if (campaign.status !== 'OPEN') throw new BadRequestException('Campaign is closed');
    const a = await this.byId(dto.assetId);
    if (campaign.verified.includes(a.id)) throw new BadRequestException(`Asset ${a.tag} is already verified in this campaign`);

    const updates: Partial<typeof schema.assets.$inferInsert> = {};
    if (dto.location) updates.location = dto.location;
    // A previously MISSING asset found during verification goes back into service.
    if (a.status === 'MISSING') updates.status = 'IN_SERVICE';
    if (Object.keys(updates).length) await db.update(schema.assets).set(updates).where(eq(schema.assets.id, a.id));

    await this.addEvent(a.id, 'VERIFY', user.id, {
      campaignId, condition: dto.condition ?? null, location: dto.location ?? a.location,
      note: dto.note ?? null, unexpected: !campaign.expected.includes(a.id),
    });
    campaign.verified.push(a.id);
    await this.saveCampaign(key, campaign, user.id);
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'ASSET_VERIFIED',
      entityType: 'asset', entityId: a.tag,
      data: { campaignId, condition: dto.condition ?? null, location: dto.location ?? null }, ip,
    });
    return this.campaignSummary(campaignId);
  }

  /** Close the campaign: every expected-but-unverified asset becomes MISSING. */
  async closeCampaign(user: AuthedUser, campaignId: string, ip?: string) {
    const { key, campaign } = await this.campaignRow(campaignId);
    if (campaign.status !== 'OPEN') throw new BadRequestException('Campaign is already closed');
    const verifiedSet = new Set(campaign.verified);
    const missingIds = campaign.expected.filter((a) => !verifiedSet.has(a));
    for (const assetId of missingIds) {
      const a = await db.query.assets.findFirst({ where: eq(schema.assets.id, assetId) });
      if (!a || a.status === 'DISPOSED') continue;
      await db.update(schema.assets).set({ status: 'MISSING' }).where(eq(schema.assets.id, assetId));
      await this.addEvent(assetId, 'VERIFY', user.id, { campaignId, result: 'MISSING' });
      await this.audit.log({
        actorId: user.id, actorEmail: user.email, action: 'ASSET_MARKED_MISSING',
        entityType: 'asset', entityId: a.tag, data: { campaignId }, ip,
      });
    }
    campaign.status = 'CLOSED';
    campaign.closedAt = new Date().toISOString();
    await this.saveCampaign(key, campaign, user.id);
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'ASSET_CAMPAIGN_CLOSED',
      entityType: 'asset_campaign', entityId: campaignId,
      data: { verified: campaign.verified.length, missing: missingIds.length }, ip,
    });
    return this.campaignSummary(campaignId);
  }
}

@Controller('v1/assets')
@UseGuards(AuthGuard)
export class AssetsController {
  constructor(private readonly svc: AssetsService) {}

  // Static routes before ':id'.
  @Get('reports/depreciation')
  depreciation(@Query('asOf') asOf?: string) {
    const date = asOf ? new Date(asOf) : new Date();
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid asOf date');
    return this.svc.depreciationReport(date);
  }

  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    return this.svc.create(user, CreateSchema.parse(body), req.ip);
  }

  @Get()
  list(
    @Query('status') status?: string, @Query('category') category?: string,
    @Query('location') location?: string, @Query('custodianId') custodianId?: string,
    @Query('q') q?: string,
  ) {
    return this.svc.list({ status, category, location, custodianId, q });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.update(user, id, UpdateSchema.parse(body), req.ip);
  }

  @Post(':id/assign')
  assign(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.assign(user, id, AssignSchema.parse(body), req.ip);
  }

  @Post(':id/acknowledge')
  acknowledge(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    return this.svc.acknowledge(user, id, req.ip);
  }

  @Post(':id/transfer')
  transfer(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.transfer(user, id, TransferSchema.parse(body), req.ip);
  }

  @Post(':id/return')
  initiateReturn(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = z.object({ note: z.string().max(500).optional() }).parse(body ?? {});
    return this.svc.initiateReturn(user, id, dto.note, req.ip);
  }

  @Post(':id/return/acknowledge')
  @RequireRoles('FINANCE', 'SYSTEM_ADMIN')
  acknowledgeReturn(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    return this.svc.acknowledgeReturn(user, id, req.ip);
  }

  @Post(':id/disposal-request')
  disposal(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.requestDisposal(user, id, DisposalSchema.parse(body), req.ip);
  }
}

@Controller('v1/asset-campaigns')
@UseGuards(AuthGuard)
export class AssetCampaignsController {
  constructor(private readonly svc: AssetsService) {}

  @Post()
  start(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    return this.svc.startCampaign(user, CampaignStartSchema.parse(body), req.ip);
  }

  @Get()
  list() {
    return this.svc.listCampaigns();
  }

  @Get(':id')
  summary(@Param('id') id: string) {
    return this.svc.campaignSummary(id);
  }

  @Post(':id/verify')
  verify(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.verifyAsset(user, id, CampaignVerifySchema.parse(body), req.ip);
  }

  @Post(':id/close')
  close(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    return this.svc.closeCampaign(user, id, req.ip);
  }
}
