/**
 * DGM-01/02 Grants & donor funds · DGM-03 Donor report data · DGM-04 Reporting calendar.
 * Money: BigInt kobo / grant-currency minor units, serialised as strings.
 */
import {
  BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException,
  Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { and, asc, eq, gte, inArray, lt, lte, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';
import type { RoleCode } from '../../db/schema';
import {
  computeGrantHealth, koboToGrantMinor, parseFxRateCents, toCsv, type GrantHealth,
} from './governance.logic';

const GRANT_STATUSES = ['PIPELINE', 'ACTIVE', 'CLOSING', 'CLOSED'] as const;
const ROLE_CODES = schema.roleCode.enumValues as [RoleCode, ...RoleCode[]];

const GrantCreateSchema = z.object({
  code: z.string().min(2).max(40).regex(/^[A-Z0-9][A-Z0-9-]*$/, 'code must be uppercase letters/digits/hyphens'),
  donor: z.string().min(2).max(120),
  title: z.string().min(3).max(200),
  currency: z.string().length(3).transform((s) => s.toUpperCase()),
  valueMinor: z.string().regex(/^\d+$/, 'valueMinor must be a non-negative integer string'),
  fxRateToNgn: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  endDate: z.coerce.date().optional().nullable(),
  conditions: z.string().max(4000).optional().nullable(),
  status: z.enum(GRANT_STATUSES).optional(),
});
const GrantUpdateSchema = GrantCreateSchema.partial().omit({ code: true });

const DeadlineCreateSchema = z.object({
  title: z.string().min(3).max(200),
  dueDate: z.coerce.date(),
  ownerRole: z.enum(ROLE_CODES).optional().nullable(),
});
const DeadlineUpdateSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  dueDate: z.coerce.date().optional(),
  ownerRole: z.enum(ROLE_CODES).optional().nullable(),
  status: z.enum(['OPEN', 'DONE', 'OVERDUE']).optional(),
});
const PeriodSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

type GrantRow = typeof schema.grants.$inferSelect;

function serialiseGrant(g: GrantRow) {
  return { ...g, valueMinor: g.valueMinor.toString() };
}

@Injectable()
export class GrantsService {
  constructor(private readonly audit: AuditService) {}

  async getGrant(id: string): Promise<GrantRow> {
    const g = await db.query.grants.findFirst({ where: eq(schema.grants.id, id) });
    if (!g) throw new NotFoundException('Grant not found');
    return g;
  }

  /** Convert a kobo figure into the grant's currency minor units (null when NGN/no rate). */
  private toGrantMinor(g: GrantRow, kobo: bigint): bigint | null {
    if (!g.fxRateToNgn) return null;
    return koboToGrantMinor(kobo, parseFxRateCents(g.fxRateToNgn));
  }

  /** DGM-02: budget vs actual for a grant, from transactions carrying its donorCode. */
  async detail(id: string) {
    const g = await this.getGrant(id);
    const now = new Date();

    const txs = await db.query.transactions.findMany({
      where: and(
        eq(schema.transactions.donorCode, g.code),
        inArray(schema.transactions.status, ['PENDING', 'APPROVED']),
      ),
      with: { department: true, lines: { with: { budgetLine: true } } },
    });

    let actualKobo = 0n;    // APPROVED
    let committedKobo = 0n; // PENDING
    const byDept = new Map<string, { name: string; actualKobo: bigint; committedKobo: bigint }>();
    const byLine = new Map<string, { code: string; name: string; actualKobo: bigint; committedKobo: bigint }>();
    for (const tx of txs) {
      const approved = tx.status === 'APPROVED';
      if (approved) actualKobo += tx.amountKobo; else committedKobo += tx.amountKobo;
      const d = byDept.get(tx.departmentId) ?? { name: tx.department.name, actualKobo: 0n, committedKobo: 0n };
      if (approved) d.actualKobo += tx.amountKobo; else d.committedKobo += tx.amountKobo;
      byDept.set(tx.departmentId, d);
      for (const l of tx.lines) {
        const key = l.budgetLineId ?? 'UNALLOCATED';
        const entry = byLine.get(key) ?? {
          code: l.budgetLine?.code ?? 'UNALLOCATED',
          name: l.budgetLine?.name ?? 'Not tied to a budget line',
          actualKobo: 0n, committedKobo: 0n,
        };
        const lineTotal = BigInt(l.qty) * l.unitKobo;
        if (approved) entry.actualKobo += lineTotal; else entry.committedKobo += lineTotal;
        byLine.set(key, entry);
      }
    }

    // Health is computed in the grant's own currency minor units when an FX rate is
    // set (integer math on kobo and rate*100); for NGN grants minor units ARE kobo.
    const rateCents = g.fxRateToNgn ? parseFxRateCents(g.fxRateToNgn) : null;
    const asMinor = (kobo: bigint) => (rateCents ? koboToGrantMinor(kobo, rateCents) : kobo);
    const health: GrantHealth = computeGrantHealth({
      budgetMinor: g.valueMinor,
      actualMinor: asMinor(actualKobo),
      committedMinor: asMinor(committedKobo),
      startDate: g.startDate, endDate: g.endDate, now,
    });

    const grantMinorOrNull = (kobo: bigint) => {
      const m = this.toGrantMinor(g, kobo);
      return m === null ? null : m.toString();
    };
    return {
      grant: serialiseGrant(g),
      totals: {
        budgetMinor: g.valueMinor.toString(),
        actualKobo: actualKobo.toString(),
        committedKobo: committedKobo.toString(),
        actualGrantMinor: grantMinorOrNull(actualKobo),
        committedGrantMinor: grantMinorOrNull(committedKobo),
      },
      byDepartment: [...byDept.entries()].map(([deptId, d]) => ({
        departmentId: deptId, department: d.name,
        actualKobo: d.actualKobo.toString(), committedKobo: d.committedKobo.toString(),
        actualGrantMinor: grantMinorOrNull(d.actualKobo), committedGrantMinor: grantMinorOrNull(d.committedKobo),
      })),
      byBudgetLine: [...byLine.entries()].map(([lineId, l]) => ({
        budgetLineId: lineId === 'UNALLOCATED' ? null : lineId, code: l.code, name: l.name,
        actualKobo: l.actualKobo.toString(), committedKobo: l.committedKobo.toString(),
        actualGrantMinor: grantMinorOrNull(l.actualKobo), committedGrantMinor: grantMinorOrNull(l.committedKobo),
      })),
      health,
    };
  }

  /** DGM-03: transaction-level donor-report evidence for a grant + period. */
  async reportData(id: string, from?: Date, to?: Date) {
    const g = await this.getGrant(id);
    const where = [
      eq(schema.transactions.donorCode, g.code),
      notInArray(schema.transactions.status, ['DRAFT', 'WITHDRAWN']),
    ];
    if (from) where.push(gte(schema.transactions.createdAt, from));
    if (to) where.push(lte(schema.transactions.createdAt, to));
    const txs = await db.query.transactions.findMany({
      where: and(...where),
      with: {
        department: true,
        lines: { with: { budgetLine: true } },
        stageEvents: true,
      },
      orderBy: [asc(schema.transactions.createdAt)],
    });

    const rateCents = g.fxRateToNgn ? parseFxRateCents(g.fxRateToNgn) : null;
    const toMinor = (kobo: bigint) => (rateCents ? koboToGrantMinor(kobo, rateCents).toString() : null);

    const lineTotals = new Map<string, { code: string; name: string; actualKobo: bigint; committedKobo: bigint; totalKobo: bigint }>();
    const rows = txs.map((tx) => {
      const approvedEvents = tx.stageEvents.filter((e) => e.action === 'APPROVED');
      const approvalCompletedAt = tx.status === 'APPROVED' && approvedEvents.length
        ? new Date(Math.max(...approvedEvents.map((e) => e.createdAt.getTime())))
        : null;
      for (const l of tx.lines) {
        const key = l.budgetLineId ?? 'UNALLOCATED';
        const entry = lineTotals.get(key) ?? {
          code: l.budgetLine?.code ?? 'UNALLOCATED',
          name: l.budgetLine?.name ?? 'Not tied to a budget line',
          actualKobo: 0n, committedKobo: 0n, totalKobo: 0n,
        };
        const t = BigInt(l.qty) * l.unitKobo;
        entry.totalKobo += t;
        if (tx.status === 'APPROVED') entry.actualKobo += t;
        else if (tx.status === 'PENDING') entry.committedKobo += t;
        lineTotals.set(key, entry);
      }
      return {
        ref: tx.ref, title: tx.title, department: tx.department.name,
        status: tx.status,
        amountKobo: tx.amountKobo.toString(),
        amountGrantMinor: toMinor(tx.amountKobo),
        approvalCompletedAt,
        createdAt: tx.createdAt,
      };
    });

    const totalKobo = txs.reduce((s, t) => s + t.amountKobo, 0n);
    const actualKobo = txs.filter((t) => t.status === 'APPROVED').reduce((s, t) => s + t.amountKobo, 0n);
    return {
      grant: serialiseGrant(g),
      period: { from: from ?? null, to: to ?? null },
      transactions: rows,
      budgetLineTotals: [...lineTotals.entries()].map(([lineId, l]) => ({
        budgetLineId: lineId === 'UNALLOCATED' ? null : lineId, code: l.code, name: l.name,
        totalKobo: l.totalKobo.toString(),
        actualKobo: l.actualKobo.toString(),
        committedKobo: l.committedKobo.toString(),
        totalGrantMinor: toMinor(l.totalKobo),
      })),
      totals: {
        transactionCount: rows.length,
        totalKobo: totalKobo.toString(),
        actualKobo: actualKobo.toString(),
        totalGrantMinor: toMinor(totalKobo),
        actualGrantMinor: toMinor(actualKobo),
      },
    };
  }
}

@Controller('v1/grants')
@UseGuards(AuthGuard)
export class GrantsController {
  constructor(private readonly svc: GrantsService, private readonly audit: AuditService) {}

  @Get()
  async list(@Query('status') status?: string) {
    const where = status && (GRANT_STATUSES as readonly string[]).includes(status)
      ? eq(schema.grants.status, status) : undefined;
    const rows = await db.query.grants.findMany({ where, orderBy: [asc(schema.grants.code)] });
    return rows.map(serialiseGrant);
  }

  @Post()
  @RequireRoles('FINANCE', 'SYSTEM_ADMIN')
  async create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    const dto = GrantCreateSchema.parse(body);
    if (dto.startDate && dto.endDate && dto.endDate <= dto.startDate)
      throw new BadRequestException('Grant end date must be after its start date');
    if (dto.fxRateToNgn) parseFxRateCents(dto.fxRateToNgn); // validate integer-math parseability
    const existing = await db.query.grants.findFirst({ where: eq(schema.grants.code, dto.code) });
    if (existing) throw new BadRequestException(`Grant code ${dto.code} already exists`);
    const [row] = await db.insert(schema.grants).values({
      code: dto.code, donor: dto.donor, title: dto.title, currency: dto.currency,
      valueMinor: BigInt(dto.valueMinor), fxRateToNgn: dto.fxRateToNgn ?? null,
      startDate: dto.startDate ?? null, endDate: dto.endDate ?? null,
      conditions: dto.conditions ?? null, status: dto.status ?? 'ACTIVE',
    }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'GRANT_CREATED',
      entityType: 'grant', entityId: row.code,
      data: { donor: dto.donor, title: dto.title, currency: dto.currency, valueMinor: dto.valueMinor }, ip: req.ip,
    });
    return serialiseGrant(row);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Post(':id')
  @RequireRoles('FINANCE', 'SYSTEM_ADMIN')
  async update(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = GrantUpdateSchema.parse(body);
    const g = await this.svc.getGrant(id);
    if (dto.fxRateToNgn) parseFxRateCents(dto.fxRateToNgn);
    const patch: Partial<typeof schema.grants.$inferInsert> = {};
    if (dto.donor !== undefined) patch.donor = dto.donor;
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.currency !== undefined) patch.currency = dto.currency;
    if (dto.valueMinor !== undefined) patch.valueMinor = BigInt(dto.valueMinor);
    if (dto.fxRateToNgn !== undefined) patch.fxRateToNgn = dto.fxRateToNgn;
    if (dto.startDate !== undefined) patch.startDate = dto.startDate;
    if (dto.endDate !== undefined) patch.endDate = dto.endDate;
    if (dto.conditions !== undefined) patch.conditions = dto.conditions;
    if (dto.status !== undefined) patch.status = dto.status;
    const start = patch.startDate !== undefined ? patch.startDate : g.startDate;
    const end = patch.endDate !== undefined ? patch.endDate : g.endDate;
    if (start && end && end <= start) throw new BadRequestException('Grant end date must be after its start date');
    if (Object.keys(patch).length === 0) throw new BadRequestException('Nothing to update');
    const [row] = await db.update(schema.grants).set(patch).where(eq(schema.grants.id, id)).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'GRANT_UPDATED',
      entityType: 'grant', entityId: g.code,
      data: { fields: Object.keys(patch), valueMinor: dto.valueMinor ?? undefined }, ip: req.ip,
    });
    return serialiseGrant(row);
  }

  @Delete(':id')
  @RequireRoles('SYSTEM_ADMIN')
  async remove(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    const g = await this.svc.getGrant(id);
    const tx = await db.query.transactions.findFirst({ where: eq(schema.transactions.donorCode, g.code) });
    if (tx) throw new BadRequestException('Grant has transactions charged to it; close it instead of deleting');
    await db.delete(schema.grantDeadlines).where(eq(schema.grantDeadlines.grantId, id));
    await db.delete(schema.grants).where(eq(schema.grants.id, id));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'GRANT_DELETED',
      entityType: 'grant', entityId: g.code, ip: req.ip,
    });
    return { ok: true };
  }

  /** DGM-03: donor-report evidence bundle (JSON). */
  @Get(':id/report-data')
  reportData(@Param('id') id: string, @Query() query: Record<string, string>) {
    const p = PeriodSchema.parse(query);
    return this.svc.reportData(id, p.from, p.to);
  }

  /** DGM-03: same rows as CSV text (manual escaping, no deps). */
  @Get(':id/report-data.csv')
  async reportCsv(@Param('id') id: string, @Query() query: Record<string, string>) {
    const p = PeriodSchema.parse(query);
    const data = await this.svc.reportData(id, p.from, p.to);
    const txCsv = toCsv(
      ['ref', 'title', 'department', 'status', 'amountKobo', 'amountGrantMinor', 'grantCurrency', 'approvalCompletedAt'],
      data.transactions.map((t) => [
        t.ref, t.title, t.department, t.status, t.amountKobo,
        t.amountGrantMinor ?? '', data.grant.currency,
        t.approvalCompletedAt ? t.approvalCompletedAt.toISOString() : '',
      ]),
    );
    const lineCsv = toCsv(
      ['budgetLineCode', 'budgetLineName', 'totalKobo', 'actualKobo', 'committedKobo', 'totalGrantMinor'],
      data.budgetLineTotals.map((l) => [l.code, l.name, l.totalKobo, l.actualKobo, l.committedKobo, l.totalGrantMinor ?? '']),
    );
    return { grantCode: data.grant.code, transactionsCsv: txCsv, budgetLineTotalsCsv: lineCsv };
  }

  /* ---------------- DGM-04 reporting calendar ---------------- */

  @Get(':id/deadlines')
  async deadlines(@Param('id') id: string) {
    await this.svc.getGrant(id);
    return db.query.grantDeadlines.findMany({
      where: eq(schema.grantDeadlines.grantId, id),
      orderBy: [asc(schema.grantDeadlines.dueDate)],
    });
  }

  @Post(':id/deadlines')
  @RequireRoles('FINANCE', 'INTERNAL_AUDIT', 'SYSTEM_ADMIN')
  async addDeadline(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = DeadlineCreateSchema.parse(body);
    const g = await this.svc.getGrant(id);
    const [row] = await db.insert(schema.grantDeadlines).values({
      grantId: id, title: dto.title, dueDate: dto.dueDate, ownerRole: dto.ownerRole ?? null,
    }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'GRANT_DEADLINE_CREATED',
      entityType: 'grant_deadline', entityId: row.id,
      data: { grant: g.code, title: dto.title, dueDate: dto.dueDate.toISOString(), ownerRole: dto.ownerRole ?? null },
      ip: req.ip,
    });
    return row;
  }
}

@Controller('v1/grant-deadlines')
@UseGuards(AuthGuard)
export class GrantDeadlinesController {
  constructor(private readonly audit: AuditService) {}

  /** DGM-04: deadlines due within N days across all grants (default 30), optional owner-role filter. */
  @Get('upcoming')
  async upcoming(@Query('days') days?: string, @Query('ownerRole') ownerRole?: string) {
    const n = Math.min(Math.max(Number(days) || 30, 1), 365);
    const now = new Date();
    const horizon = new Date(now.getTime() + n * 86400_000);
    const where = [
      inArray(schema.grantDeadlines.status, ['OPEN', 'OVERDUE']),
      lte(schema.grantDeadlines.dueDate, horizon),
    ];
    if (ownerRole && (schema.roleCode.enumValues as readonly string[]).includes(ownerRole)) {
      where.push(eq(schema.grantDeadlines.ownerRole, ownerRole as RoleCode));
    }
    const rows = await db.select({
      id: schema.grantDeadlines.id,
      title: schema.grantDeadlines.title,
      dueDate: schema.grantDeadlines.dueDate,
      ownerRole: schema.grantDeadlines.ownerRole,
      status: schema.grantDeadlines.status,
      grantId: schema.grants.id,
      grantCode: schema.grants.code,
      grantTitle: schema.grants.title,
      donor: schema.grants.donor,
    }).from(schema.grantDeadlines)
      .innerJoin(schema.grants, eq(schema.grants.id, schema.grantDeadlines.grantId))
      .where(and(...where))
      .orderBy(asc(schema.grantDeadlines.dueDate));
    return rows.map((r) => ({
      ...r,
      daysUntilDue: Math.floor((r.dueDate.getTime() - now.getTime()) / 86400_000),
      overdue: r.dueDate.getTime() < now.getTime(),
    }));
  }

  /**
   * DGM-04: flip OPEN deadlines past their due date to OVERDUE and escalate to
   * every active FINAL_APPROVER via a notification row (kind ESCALATION).
   */
  @Post('run-overdue')
  @RequireRoles('FINANCE', 'INTERNAL_AUDIT', 'SYSTEM_ADMIN')
  async runOverdue(@CurrentUser() user: AuthedUser, @Req() req: any) {
    const now = new Date();
    const overdue = await db.select({
      id: schema.grantDeadlines.id,
      title: schema.grantDeadlines.title,
      dueDate: schema.grantDeadlines.dueDate,
      grantCode: schema.grants.code,
    }).from(schema.grantDeadlines)
      .innerJoin(schema.grants, eq(schema.grants.id, schema.grantDeadlines.grantId))
      .where(and(eq(schema.grantDeadlines.status, 'OPEN'), lt(schema.grantDeadlines.dueDate, now)));
    if (overdue.length === 0) return { flipped: 0, notified: 0 };

    const finalApprovers = await db.select({ userId: schema.users.id })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
      .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
      .where(and(eq(schema.roles.code, 'FINAL_APPROVER'), eq(schema.users.active, true)));
    const approverIds = [...new Set(finalApprovers.map((r) => r.userId))];

    let notified = 0;
    for (const d of overdue) {
      await db.update(schema.grantDeadlines).set({ status: 'OVERDUE' }).where(eq(schema.grantDeadlines.id, d.id));
      if (approverIds.length) {
        await db.insert(schema.notifications).values(approverIds.map((userId) => ({
          userId, kind: 'ESCALATION',
          title: `Grant reporting deadline overdue: ${d.grantCode}`,
          body: `"${d.title}" was due ${d.dueDate.toISOString().slice(0, 10)} and is still open.`,
          entityType: 'grant_deadline', entityId: d.id,
        })));
        notified += approverIds.length;
      }
      await this.audit.log({
        actorId: user.id, actorEmail: user.email, action: 'GRANT_DEADLINE_OVERDUE',
        entityType: 'grant_deadline', entityId: d.id,
        data: { grant: d.grantCode, title: d.title, dueDate: d.dueDate.toISOString() }, ip: req.ip,
      });
    }
    return { flipped: overdue.length, notified };
  }

  @Post(':id')
  @RequireRoles('FINANCE', 'INTERNAL_AUDIT', 'SYSTEM_ADMIN')
  async update(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = DeadlineUpdateSchema.parse(body);
    const existing = await db.query.grantDeadlines.findFirst({ where: eq(schema.grantDeadlines.id, id) });
    if (!existing) throw new NotFoundException('Deadline not found');
    const patch: Partial<typeof schema.grantDeadlines.$inferInsert> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.dueDate !== undefined) patch.dueDate = dto.dueDate;
    if (dto.ownerRole !== undefined) patch.ownerRole = dto.ownerRole;
    if (dto.status !== undefined) patch.status = dto.status;
    if (Object.keys(patch).length === 0) throw new BadRequestException('Nothing to update');
    const [row] = await db.update(schema.grantDeadlines).set(patch).where(eq(schema.grantDeadlines.id, id)).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'GRANT_DEADLINE_UPDATED',
      entityType: 'grant_deadline', entityId: id, data: { fields: Object.keys(patch), status: dto.status ?? undefined },
      ip: req.ip,
    });
    return row;
  }

  @Delete(':id')
  @RequireRoles('FINANCE', 'SYSTEM_ADMIN')
  async remove(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    const existing = await db.query.grantDeadlines.findFirst({ where: eq(schema.grantDeadlines.id, id) });
    if (!existing) throw new NotFoundException('Deadline not found');
    await db.delete(schema.grantDeadlines).where(eq(schema.grantDeadlines.id, id));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'GRANT_DEADLINE_DELETED',
      entityType: 'grant_deadline', entityId: id, data: { title: existing.title }, ip: req.ip,
    });
    return { ok: true };
  }
}
