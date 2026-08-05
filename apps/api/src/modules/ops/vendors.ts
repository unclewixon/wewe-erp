/**
 * PRC-01 — Vendor management: CRUD, dual-confirm bank-detail changes,
 * blacklist/unblacklist with reason, computed due-diligence status,
 * vendor detail with PO + contract history.
 */
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Injectable,
  NotFoundException, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { desc, eq, ilike } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';
import { dueDiligenceStatus } from './ops.logic';

const BankDetailsSchema = z.object({
  bankName: z.string().min(1).max(120),
  accountName: z.string().min(1).max(200),
  accountNumber: z.string().min(6).max(34),
}).passthrough();

const DueDiligenceSchema = z.object({
  cacDocId: z.string().optional().nullable(),
  taxClearanceDocId: z.string().optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable(),
}).passthrough();

const CreateSchema = z.object({
  name: z.string().min(2).max(200),
  contact: z.object({
    email: z.string().email().optional(),
    phone: z.string().max(40).optional(),
    address: z.string().max(500).optional(),
  }).passthrough().optional(),
  tin: z.string().max(40).optional().nullable(),
  bankDetails: BankDetailsSchema.optional(),
  categories: z.array(z.string().min(1).max(60)).max(20).optional(),
  dueDiligence: DueDiligenceSchema.optional(),
});
// Updates: bankDetails goes through the dual-confirm pending flow, never applied directly.
const UpdateSchema = CreateSchema.partial();
const ReasonSchema = z.object({ reason: z.string().min(5).max(1000) });

type Vendor = typeof schema.vendors.$inferSelect;

function serialiseDd(dd?: z.infer<typeof DueDiligenceSchema>) {
  if (!dd) return undefined;
  return { ...dd, expiresAt: dd.expiresAt ? dd.expiresAt.toISOString() : dd.expiresAt ?? null };
}

@Injectable()
export class VendorsService {
  constructor(private readonly audit: AuditService) {}

  out(v: Vendor) {
    const contact = (v.contact ?? {}) as Record<string, unknown>;
    const { pendingBankDetails, ...restContact } = contact;
    return {
      id: v.id, name: v.name, contact: restContact, tin: v.tin,
      bankDetails: v.bankDetails, categories: v.categories,
      blacklisted: v.blacklisted, blacklistReason: v.blacklistReason,
      dueDiligence: v.dueDiligence,
      dueDiligenceStatus: dueDiligenceStatus(v.dueDiligence, new Date()),
      pendingBankDetails: pendingBankDetails ?? null,
      createdAt: v.createdAt,
    };
  }

  async byId(id: string): Promise<Vendor> {
    const v = await db.query.vendors.findFirst({ where: eq(schema.vendors.id, id) });
    if (!v) throw new NotFoundException('Vendor not found');
    return v;
  }

  /** Shared guard: blacklisted vendors are blocked from new POs and RFQ quote/selection. */
  assertNotBlacklisted(v: Vendor, activity: string) {
    if (v.blacklisted) {
      throw new BadRequestException(
        `Vendor "${v.name}" is blacklisted (${v.blacklistReason ?? 'no reason recorded'}) — ${activity} is blocked`,
      );
    }
  }

  async create(user: AuthedUser, dto: z.infer<typeof CreateSchema>, ip?: string) {
    const [v] = await db.insert(schema.vendors).values({
      name: dto.name,
      contact: (dto.contact as object | undefined) ?? null,
      tin: dto.tin ?? null,
      bankDetails: dto.bankDetails ?? null, // initial capture; subsequent changes are dual-confirm
      categories: dto.categories ?? null,
      dueDiligence: serialiseDd(dto.dueDiligence) ?? null,
    }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'VENDOR_CREATED',
      entityType: 'vendor', entityId: v.id, data: { name: v.name }, ip,
    });
    return this.out(v);
  }

  async update(user: AuthedUser, id: string, dto: z.infer<typeof UpdateSchema>, ip?: string) {
    const v = await this.byId(id);
    const contact = { ...((v.contact ?? {}) as object), ...((dto.contact as object | undefined) ?? {}) } as Record<string, unknown>;
    let bankChangePending = false;

    if (dto.bankDetails !== undefined) {
      // Dual confirmation: the change parks in contact.pendingBankDetails until a
      // DIFFERENT Finance/Admin user confirms it (fraud control on payee accounts).
      contact.pendingBankDetails = {
        details: dto.bankDetails,
        proposedById: user.id, proposedByEmail: user.email,
        proposedAt: new Date().toISOString(),
      };
      bankChangePending = true;
      await this.audit.log({
        actorId: user.id, actorEmail: user.email, action: 'VENDOR_BANK_CHANGE_PROPOSED',
        entityType: 'vendor', entityId: id,
        data: { name: v.name, bankName: dto.bankDetails.bankName, accountTail: dto.bankDetails.accountNumber.slice(-4) }, ip,
      });
    }

    const [next] = await db.update(schema.vendors).set({
      name: dto.name ?? v.name,
      contact,
      tin: dto.tin === undefined ? v.tin : dto.tin,
      categories: dto.categories === undefined ? v.categories : dto.categories,
      dueDiligence: dto.dueDiligence === undefined ? v.dueDiligence : serialiseDd(dto.dueDiligence),
      // bankDetails column intentionally untouched here
    }).where(eq(schema.vendors.id, id)).returning();

    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'VENDOR_UPDATED',
      entityType: 'vendor', entityId: id,
      data: { fields: Object.keys(dto), bankChangePending }, ip,
    });
    return { ...this.out(next), bankChangePending };
  }

  async confirmBankChange(user: AuthedUser, id: string, ip?: string) {
    const v = await this.byId(id);
    const contact = { ...((v.contact ?? {}) as Record<string, unknown>) };
    const pending = contact.pendingBankDetails as
      | { details: unknown; proposedById: string; proposedByEmail: string; proposedAt: string } | undefined;
    if (!pending) throw new BadRequestException('No pending bank-detail change on this vendor');
    if (pending.proposedById === user.id) {
      throw new ForbiddenException('Bank-detail changes need a second person: the proposer cannot confirm their own change');
    }
    delete contact.pendingBankDetails;
    const [next] = await db.update(schema.vendors)
      .set({ bankDetails: pending.details as object, contact })
      .where(eq(schema.vendors.id, id)).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'VENDOR_BANK_CHANGE_CONFIRMED',
      entityType: 'vendor', entityId: id,
      data: { name: v.name, proposedById: pending.proposedById, proposedByEmail: pending.proposedByEmail, proposedAt: pending.proposedAt }, ip,
    });
    return this.out(next);
  }

  async rejectBankChange(user: AuthedUser, id: string, reason: string, ip?: string) {
    const v = await this.byId(id);
    const contact = { ...((v.contact ?? {}) as Record<string, unknown>) };
    if (!contact.pendingBankDetails) throw new BadRequestException('No pending bank-detail change on this vendor');
    const pending = contact.pendingBankDetails;
    delete contact.pendingBankDetails;
    const [next] = await db.update(schema.vendors).set({ contact }).where(eq(schema.vendors.id, id)).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'VENDOR_BANK_CHANGE_REJECTED',
      entityType: 'vendor', entityId: id, data: { name: v.name, reason, rejected: pending }, ip,
    });
    return this.out(next);
  }

  async setBlacklist(user: AuthedUser, id: string, blacklisted: boolean, reason: string, ip?: string) {
    const v = await this.byId(id);
    const [next] = await db.update(schema.vendors)
      .set({ blacklisted, blacklistReason: blacklisted ? reason : null })
      .where(eq(schema.vendors.id, id)).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email,
      action: blacklisted ? 'VENDOR_BLACKLISTED' : 'VENDOR_UNBLACKLISTED',
      entityType: 'vendor', entityId: id, data: { name: v.name, reason }, ip,
    });
    return this.out(next);
  }

  async list(q?: string, category?: string, blacklisted?: string) {
    const rows = q
      ? await db.select().from(schema.vendors).where(ilike(schema.vendors.name, `%${q}%`)).orderBy(schema.vendors.name)
      : await db.select().from(schema.vendors).orderBy(schema.vendors.name);
    return rows
      .filter((v) => category === undefined || (Array.isArray(v.categories) && (v.categories as string[]).includes(category)))
      .filter((v) => blacklisted === undefined || v.blacklisted === (blacklisted === 'true'))
      .map((v) => this.out(v));
  }

  /** Vendor detail with PO and contract history. */
  async detail(id: string) {
    const v = await this.byId(id);
    const pos = await db.select().from(schema.purchaseOrders)
      .where(eq(schema.purchaseOrders.vendorId, id)).orderBy(desc(schema.purchaseOrders.issuedAt));
    const contracts = await db.select().from(schema.contracts)
      .where(eq(schema.contracts.vendorId, id));
    return {
      ...this.out(v),
      purchaseOrders: pos.map((p) => ({
        id: p.id, ref: p.ref, totalKobo: p.totalKobo.toString(), status: p.status, issuedAt: p.issuedAt,
      })),
      contracts: contracts.map((c) => ({
        id: c.id, ref: c.ref, title: c.title, valueKobo: c.valueKobo.toString(),
        paidKobo: c.paidKobo.toString(), status: c.status, startDate: c.startDate, endDate: c.endDate,
      })),
    };
  }
}

@Controller('v1/vendors')
@UseGuards(AuthGuard)
export class VendorsController {
  constructor(private readonly svc: VendorsService) {}

  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    return this.svc.create(user, CreateSchema.parse(body), req.ip);
  }

  @Get()
  list(@Query('q') q?: string, @Query('category') category?: string, @Query('blacklisted') blacklisted?: string) {
    return this.svc.list(q, category, blacklisted);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.update(user, id, UpdateSchema.parse(body), req.ip);
  }

  /** Second-person confirmation of a proposed bank-detail change (dual control). */
  @Post(':id/bank-details/confirm')
  @RequireRoles('FINANCE', 'SYSTEM_ADMIN')
  confirmBank(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    return this.svc.confirmBankChange(user, id, req.ip);
  }

  @Post(':id/bank-details/reject')
  @RequireRoles('FINANCE', 'SYSTEM_ADMIN')
  rejectBank(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = ReasonSchema.parse(body);
    return this.svc.rejectBankChange(user, id, dto.reason, req.ip);
  }

  @Post(':id/blacklist')
  @RequireRoles('FINANCE', 'INTERNAL_AUDIT', 'SYSTEM_ADMIN')
  blacklist(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = ReasonSchema.parse(body);
    return this.svc.setBlacklist(user, id, true, dto.reason, req.ip);
  }

  @Post(':id/unblacklist')
  @RequireRoles('FINANCE', 'INTERNAL_AUDIT', 'SYSTEM_ADMIN')
  unblacklist(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = ReasonSchema.parse(body);
    return this.svc.setBlacklist(user, id, false, dto.reason, req.ip);
  }
}
