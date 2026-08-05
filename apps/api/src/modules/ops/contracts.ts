/**
 * PRC-04 — Contract management: CRUD (vendor + optional document link),
 * payments against the contract value (never exceeding it without an
 * amendment), amendments that raise the value with audit, and expiry alerts.
 */
import {
  BadRequestException, Body, Controller, Get, Injectable, NotFoundException,
  Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';
import { WorkflowService } from '../../workflow/workflow.service';
import { KoboString, tableRef } from './shared';

const CreateSchema = z.object({
  vendorId: z.string().min(1),
  title: z.string().min(3).max(200),
  valueKobo: KoboString,
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  documentId: z.string().optional().nullable(),
});
const UpdateSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  documentId: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'EXPIRED', 'TERMINATED']).optional(),
});
const PaymentSchema = z.object({ amountKobo: KoboString, note: z.string().max(1000).optional() });
const AmendSchema = z.object({ newValueKobo: KoboString, reason: z.string().min(10).max(2000) });

@Injectable()
export class ContractsService {
  constructor(private readonly audit: AuditService, private readonly workflow: WorkflowService) {}

  private async byId(id: string) {
    const c = await db.query.contracts.findFirst({ where: eq(schema.contracts.id, id) });
    if (!c) throw new NotFoundException('Contract not found');
    return c;
  }

  private out(c: typeof schema.contracts.$inferSelect, vendorName?: string | null) {
    return {
      id: c.id, ref: c.ref, vendorId: c.vendorId, vendorName: vendorName ?? undefined,
      title: c.title, valueKobo: c.valueKobo.toString(), paidKobo: c.paidKobo.toString(),
      remainingKobo: (c.valueKobo - c.paidKobo).toString(),
      startDate: c.startDate, endDate: c.endDate, documentId: c.documentId, status: c.status,
    };
  }

  async create(user: AuthedUser, dto: z.infer<typeof CreateSchema>, ip?: string) {
    const vendor = await db.query.vendors.findFirst({ where: eq(schema.vendors.id, dto.vendorId) });
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (dto.documentId) {
      const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, dto.documentId) });
      if (!doc) throw new BadRequestException('Linked document not found');
    }
    if (dto.startDate && dto.endDate && dto.endDate <= dto.startDate) {
      throw new BadRequestException('Contract end date must be after its start date');
    }
    const ref = await tableRef(this.workflow, 'CTR',
      async (r) => Boolean(await db.query.contracts.findFirst({ where: eq(schema.contracts.ref, r) })));
    const [c] = await db.insert(schema.contracts).values({
      ref, vendorId: dto.vendorId, title: dto.title, valueKobo: BigInt(dto.valueKobo),
      startDate: dto.startDate ?? null, endDate: dto.endDate ?? null, documentId: dto.documentId ?? null,
    }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'CONTRACT_CREATED',
      entityType: 'contract', entityId: ref,
      data: { title: dto.title, vendor: vendor.name, valueKobo: dto.valueKobo }, ip,
    });
    return this.out(c, vendor.name);
  }

  async list(vendorId?: string, status?: string) {
    const rows = await db.select().from(schema.contracts).orderBy(desc(schema.contracts.ref)).limit(300);
    const out = [];
    for (const c of rows) {
      if (vendorId && c.vendorId !== vendorId) continue;
      if (status && c.status !== status) continue;
      const vendor = await db.query.vendors.findFirst({ where: eq(schema.vendors.id, c.vendorId), columns: { name: true } });
      out.push(this.out(c, vendor?.name ?? null));
    }
    return out;
  }

  async detail(id: string) {
    const c = await this.byId(id);
    const vendor = await db.query.vendors.findFirst({ where: eq(schema.vendors.id, c.vendorId), columns: { name: true } });
    return this.out(c, vendor?.name ?? null);
  }

  async update(user: AuthedUser, id: string, dto: z.infer<typeof UpdateSchema>, ip?: string) {
    const c = await this.byId(id);
    if (dto.documentId) {
      const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, dto.documentId) });
      if (!doc) throw new BadRequestException('Linked document not found');
    }
    const [next] = await db.update(schema.contracts).set({
      title: dto.title ?? c.title,
      startDate: dto.startDate === undefined ? c.startDate : dto.startDate,
      endDate: dto.endDate === undefined ? c.endDate : dto.endDate,
      documentId: dto.documentId === undefined ? c.documentId : dto.documentId,
      status: dto.status ?? c.status,
    }).where(eq(schema.contracts.id, id)).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'CONTRACT_UPDATED',
      entityType: 'contract', entityId: c.ref, data: { fields: Object.keys(dto) }, ip,
    });
    return this.out(next);
  }

  /** paidKobo += amount; a payment may never take the total past valueKobo. */
  async recordPayment(user: AuthedUser, id: string, dto: z.infer<typeof PaymentSchema>, ip?: string) {
    const c = await this.byId(id);
    const amount = BigInt(dto.amountKobo);
    if (amount <= 0n) throw new BadRequestException('Payment amount must be positive');
    if (c.paidKobo + amount > c.valueKobo) {
      throw new BadRequestException(
        `Payment would exceed the contract value: paid ${c.paidKobo} + ${amount} > ${c.valueKobo} kobo. ` +
        'Raise the contract value through an amendment first.',
      );
    }
    const [next] = await db.update(schema.contracts)
      .set({ paidKobo: c.paidKobo + amount })
      .where(eq(schema.contracts.id, id)).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'CONTRACT_PAYMENT_RECORDED',
      entityType: 'contract', entityId: c.ref,
      data: { amountKobo: dto.amountKobo, note: dto.note ?? null, paidKoboAfter: next.paidKobo.toString() }, ip,
    });
    return this.out(next);
  }

  /** Amendment: the only path that raises a contract's value — always audited. */
  async amend(user: AuthedUser, id: string, dto: z.infer<typeof AmendSchema>, ip?: string) {
    const c = await this.byId(id);
    const newValue = BigInt(dto.newValueKobo);
    if (newValue <= c.valueKobo) {
      throw new BadRequestException(
        `An amendment must raise the contract value (current ${c.valueKobo} kobo, proposed ${newValue} kobo)`,
      );
    }
    const [next] = await db.update(schema.contracts)
      .set({ valueKobo: newValue })
      .where(eq(schema.contracts.id, id)).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'CONTRACT_AMENDED',
      entityType: 'contract', entityId: c.ref,
      data: { fromKobo: c.valueKobo.toString(), toKobo: dto.newValueKobo, reason: dto.reason }, ip,
    });
    return this.out(next);
  }

  /** Contracts expiring within N days (default 60), plus already-expired ACTIVE ones. */
  async expiryAlerts(days: number) {
    const now = Date.now();
    const horizon = now + days * 86400_000;
    const rows = await db.select().from(schema.contracts).where(eq(schema.contracts.status, 'ACTIVE'));
    const alerts = [];
    for (const c of rows) {
      if (!c.endDate) continue;
      const end = c.endDate.getTime();
      if (end > horizon) continue;
      const vendor = await db.query.vendors.findFirst({ where: eq(schema.vendors.id, c.vendorId), columns: { name: true } });
      alerts.push({
        ...this.out(c, vendor?.name ?? null),
        daysLeft: Math.ceil((end - now) / 86400_000),
        expired: end <= now,
      });
    }
    return { withinDays: days, alerts: alerts.sort((a, b) => a.daysLeft - b.daysLeft) };
  }
}

@Controller('v1/contracts')
@UseGuards(AuthGuard)
export class ContractsController {
  constructor(private readonly svc: ContractsService) {}

  // Static route before ':id'.
  @Get('alerts/expiry')
  expiry(@Query('days') days?: string) {
    const n = Math.min(Math.max(Number(days) || 60, 1), 730);
    return this.svc.expiryAlerts(n);
  }

  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    return this.svc.create(user, CreateSchema.parse(body), req.ip);
  }

  @Get()
  list(@Query('vendorId') vendorId?: string, @Query('status') status?: string) {
    return this.svc.list(vendorId, status);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.update(user, id, UpdateSchema.parse(body), req.ip);
  }

  @Post(':id/payments')
  @RequireRoles('FINANCE', 'SYSTEM_ADMIN')
  payment(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.recordPayment(user, id, PaymentSchema.parse(body), req.ip);
  }

  @Post(':id/amend')
  @RequireRoles('FINANCE', 'SYSTEM_ADMIN')
  amend(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.amend(user, id, AmendSchema.parse(body), req.ip);
  }
}
