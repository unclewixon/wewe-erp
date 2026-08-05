/**
 * TLS-01..03 timesheets: draft per period (rows total exactly 100%), submit through
 * the TIMESHEET workflow (SUPERVISOR → FINANCE), lock on final approval, post-lock
 * corrections as adjustment timesheets (the original is never edited), LOE report.
 */
import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable,
  NotFoundException, Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { and, desc, eq, gte, inArray, lt, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';
import { WorkflowService } from '../../workflow/workflow.service';
import type { RoleCode } from '../../db/schema';
import { validateTimesheetRows, type TimesheetRow } from './timesheet.logic';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const RowSchema = z.object({ projectCode: z.string().min(1).max(40), percent: z.number() });
const CreateSchema = z.object({ period: z.string().regex(PERIOD_RE, 'period must be YYYY-MM'), rows: z.array(RowSchema) });
const RowsSchema = z.object({ rows: z.array(RowSchema) });

const hasRole = (user: AuthedUser, ...codes: RoleCode[]) => user.roles.some((r) => codes.includes(r.code));
const CENTRAL_VIEW: RoleCode[] = ['HR_OFFICER', 'FINANCE', 'SYSTEM_ADMIN', 'INTERNAL_AUDIT'];

export function parsePeriod(period: string): { start: Date; endInclusive: Date; nextStart: Date } {
  const [y, m] = period.split('-').map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    endInclusive: new Date(Date.UTC(y, m, 0)), // last calendar day, 00:00 UTC
    nextStart: new Date(Date.UTC(y, m, 1)),
  };
}

export const periodOf = (periodStart: Date): string => periodStart.toISOString().slice(0, 7);

/** onFinalApproval('TIMESHEET'): lock the sheet exactly once. */
export async function timesheetApprovalHook(tx: { id: string; ref: string }): Promise<void> {
  const ts = await db.query.timesheets.findFirst({ where: eq(schema.timesheets.txId, tx.id) });
  if (!ts || ts.status === 'LOCKED') return; // idempotent-safe
  await db.update(schema.timesheets)
    .set({ status: 'LOCKED', lockedAt: new Date() })
    .where(eq(schema.timesheets.id, ts.id));
  await new AuditService().log({
    action: 'TIMESHEET_LOCKED', entityType: 'timesheet', entityId: ts.id,
    data: { ref: tx.ref, userId: ts.userId, period: periodOf(ts.periodStart) },
  });
}

@Injectable()
export class TimesheetsService {
  constructor(private readonly audit: AuditService, private readonly workflow: WorkflowService) {}

  /** TLS-01 auto-note: approved leave days falling inside the period. */
  async leaveNoteFor(userId: string, start: Date, endInclusive: Date): Promise<string | null> {
    const rows = await db.select({ lr: schema.leaveRequests, typeName: schema.leaveTypes.name })
      .from(schema.leaveRequests)
      .innerJoin(schema.transactions, eq(schema.leaveRequests.txId, schema.transactions.id))
      .innerJoin(schema.leaveTypes, eq(schema.leaveRequests.leaveTypeId, schema.leaveTypes.id))
      .where(and(
        eq(schema.leaveRequests.userId, userId),
        eq(schema.transactions.status, 'APPROVED'),
        lte(schema.leaveRequests.startDate, endInclusive),
        gte(schema.leaveRequests.endDate, start),
      ))
      .orderBy(schema.leaveRequests.startDate);
    if (rows.length === 0) return null;
    const parts = rows.map((r) =>
      `${r.typeName} ${r.lr.startDate.toISOString().slice(0, 10)}→${r.lr.endDate.toISOString().slice(0, 10)} (${r.lr.days}d)`);
    return `Approved leave in period: ${parts.join('; ')}`;
  }

  private async serialise(viewer: AuthedUser, ts: typeof schema.timesheets.$inferSelect, userName?: string) {
    const { start, endInclusive } = parsePeriod(periodOf(ts.periodStart));
    const isAdjustment = ts.periodStart.getTime() !== start.getTime();
    let tx: { ref: string; status: string; payload: unknown } | null = null;
    if (ts.txId) {
      const t = await db.query.transactions.findFirst({ where: eq(schema.transactions.id, ts.txId) });
      if (t) tx = { ref: t.ref, status: t.status, payload: t.payload };
    }
    const payload = (tx?.payload ?? {}) as Record<string, unknown>;
    return {
      id: ts.id, userId: ts.userId, user: userName ?? viewer.name,
      period: periodOf(ts.periodStart), periodStart: ts.periodStart, periodEnd: ts.periodEnd,
      rows: ts.rows as TimesheetRow[], status: ts.status, lockedAt: ts.lockedAt,
      isAdjustment,
      adjustsTimesheetId: (payload.adjustsTimesheetId as string | null) ?? null,
      leaveNote: (payload.leaveNote as string | null)
        ?? await this.leaveNoteFor(ts.userId, start, endInclusive),
      txRef: tx?.ref ?? null, txStatus: tx?.status ?? null, txId: ts.txId,
    };
  }

  async create(user: AuthedUser, body: unknown, ip?: string) {
    const dto = CreateSchema.parse(body);
    const verdict = validateTimesheetRows(dto.rows);
    if (!verdict.ok) throw new BadRequestException(verdict.reason);
    const { start, endInclusive } = parsePeriod(dto.period);
    const existing = await db.query.timesheets.findFirst({
      where: and(eq(schema.timesheets.userId, user.id), eq(schema.timesheets.periodStart, start)),
    });
    if (existing) throw new ConflictException(`A timesheet for ${dto.period} already exists — update it, or file an adjustment if it is locked`);
    const [ts] = await db.insert(schema.timesheets).values({
      userId: user.id, periodStart: start, periodEnd: endInclusive, rows: dto.rows, status: 'DRAFT',
    }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'TIMESHEET_CREATED',
      entityType: 'timesheet', entityId: ts.id, data: { period: dto.period, rows: dto.rows }, ip,
    });
    return this.serialise(user, ts);
  }

  async update(user: AuthedUser, id: string, body: unknown, ip?: string) {
    const dto = RowsSchema.parse(body);
    const verdict = validateTimesheetRows(dto.rows);
    if (!verdict.ok) throw new BadRequestException(verdict.reason);
    const ts = await db.query.timesheets.findFirst({ where: eq(schema.timesheets.id, id) });
    if (!ts) throw new NotFoundException('Timesheet not found');
    if (ts.userId !== user.id) throw new ForbiddenException('You can only edit your own timesheet');
    if (ts.status !== 'DRAFT') throw new BadRequestException(`A ${ts.status} timesheet cannot be edited — locked sheets take adjustments instead`);
    await db.update(schema.timesheets).set({ rows: dto.rows }).where(eq(schema.timesheets.id, id));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'TIMESHEET_UPDATED',
      entityType: 'timesheet', entityId: id, data: { rows: dto.rows }, ip,
    });
    return this.serialise(user, { ...ts, rows: dto.rows });
  }

  async submit(user: AuthedUser, id: string, ip?: string) {
    const ts = await db.query.timesheets.findFirst({ where: eq(schema.timesheets.id, id) });
    if (!ts) throw new NotFoundException('Timesheet not found');
    if (ts.userId !== user.id) throw new ForbiddenException('You can only submit your own timesheet');
    if (ts.status !== 'DRAFT') throw new BadRequestException(`Timesheet is already ${ts.status}`);
    const rows = ts.rows as TimesheetRow[];
    const verdict = validateTimesheetRows(rows);
    if (!verdict.ok) throw new BadRequestException(verdict.reason);
    const period = periodOf(ts.periodStart);
    const { start, endInclusive } = parsePeriod(period);
    const leaveNote = await this.leaveNoteFor(user.id, start, endInclusive);
    const tx = await this.workflow.createTransaction(user, {
      typeCode: 'TIMESHEET',
      title: `Timesheet ${period} — ${user.name}`,
      payload: { timesheetId: ts.id, period, rows, leaveNote },
      submit: true, ip,
    });
    await db.update(schema.timesheets).set({ txId: tx.id, status: 'SUBMITTED' }).where(eq(schema.timesheets.id, id));
    return this.serialise(user, { ...ts, txId: tx.id, status: 'SUBMITTED' });
  }

  /**
   * TLS-02 correction after lock: a NEW adjustment timesheet referencing the original
   * in its transaction payload. The original row is never edited. The adjustment's
   * periodStart is offset by a few seconds inside the same period to satisfy the
   * (userId, periodStart) unique index; period grouping is by month so reports are unaffected.
   */
  async adjust(user: AuthedUser, id: string, body: unknown, ip?: string) {
    const dto = RowsSchema.parse(body);
    const verdict = validateTimesheetRows(dto.rows);
    if (!verdict.ok) throw new BadRequestException(verdict.reason);
    const original = await db.query.timesheets.findFirst({ where: eq(schema.timesheets.id, id) });
    if (!original) throw new NotFoundException('Timesheet not found');
    if (original.userId !== user.id) throw new ForbiddenException('You can only adjust your own timesheet');
    if (original.status !== 'LOCKED') throw new BadRequestException('Only locked timesheets take adjustments — edit the draft instead');
    const period = periodOf(original.periodStart);
    const { start, endInclusive, nextStart } = parsePeriod(period);
    const siblings = await db.select({ id: schema.timesheets.id }).from(schema.timesheets)
      .where(and(
        eq(schema.timesheets.userId, user.id),
        gte(schema.timesheets.periodStart, start),
        lt(schema.timesheets.periodStart, nextStart),
      ));
    const adjStart = new Date(start.getTime() + siblings.length * 1000);
    const leaveNote = await this.leaveNoteFor(user.id, start, endInclusive);
    const [adj] = await db.insert(schema.timesheets).values({
      userId: user.id, periodStart: adjStart, periodEnd: endInclusive, rows: dto.rows, status: 'DRAFT',
    }).returning();
    const tx = await this.workflow.createTransaction(user, {
      typeCode: 'TIMESHEET',
      title: `Timesheet adjustment ${period} — ${user.name}`,
      payload: {
        timesheetId: adj.id, period, rows: dto.rows, leaveNote,
        adjustment: true, adjustsTimesheetId: original.id, adjustsTxId: original.txId,
      },
      submit: true, ip,
    });
    await db.update(schema.timesheets).set({ txId: tx.id, status: 'SUBMITTED' }).where(eq(schema.timesheets.id, adj.id));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'TIMESHEET_ADJUSTMENT_FILED',
      entityType: 'timesheet', entityId: adj.id,
      data: { ref: tx.ref, period, adjustsTimesheetId: original.id, rows: dto.rows }, ip,
    });
    return this.serialise(user, { ...adj, txId: tx.id, status: 'SUBMITTED' });
  }

  async list(user: AuthedUser, scope: 'mine' | 'all', period?: string) {
    if (scope === 'all' && !hasRole(user, ...CENTRAL_VIEW))
      throw new ForbiddenException('Only HR, Finance, Audit or Admin can list all timesheets');
    const filters = [scope === 'mine' ? eq(schema.timesheets.userId, user.id) : undefined];
    if (period) {
      if (!PERIOD_RE.test(period)) throw new BadRequestException('period must be YYYY-MM');
      const { start, nextStart } = parsePeriod(period);
      filters.push(gte(schema.timesheets.periodStart, start), lt(schema.timesheets.periodStart, nextStart));
    }
    const rows = await db.select({ ts: schema.timesheets, userName: schema.users.name })
      .from(schema.timesheets)
      .innerJoin(schema.users, eq(schema.timesheets.userId, schema.users.id))
      .where(and(...filters.filter((f): f is NonNullable<typeof f> => f !== undefined)))
      .orderBy(desc(schema.timesheets.periodStart))
      .limit(200);
    return Promise.all(rows.map((r) => this.serialise(user, r.ts, r.userName)));
  }

  async get(user: AuthedUser, id: string) {
    const ts = await db.query.timesheets.findFirst({ where: eq(schema.timesheets.id, id) });
    if (!ts) throw new NotFoundException('Timesheet not found');
    if (ts.userId !== user.id && !hasRole(user, 'SUPERVISOR', ...CENTRAL_VIEW))
      throw new ForbiddenException('Not your timesheet');
    const owner = await db.query.users.findFirst({ where: eq(schema.users.id, ts.userId) });
    return this.serialise(user, ts, owner?.name);
  }

  async txIdFor(id: string): Promise<string> {
    const ts = await db.query.timesheets.findFirst({ where: eq(schema.timesheets.id, id) });
    if (!ts?.txId) throw new NotFoundException('Timesheet has no submitted transaction');
    return ts.txId;
  }

  /** Latest LOCKED sheet per user for a period (adjustments supersede by lockedAt). */
  async latestLockedByUser(period: string): Promise<Map<string, typeof schema.timesheets.$inferSelect>> {
    const { start, nextStart } = parsePeriod(period);
    const locked = await db.select().from(schema.timesheets).where(and(
      eq(schema.timesheets.status, 'LOCKED'),
      gte(schema.timesheets.periodStart, start),
      lt(schema.timesheets.periodStart, nextStart),
    )).orderBy(desc(schema.timesheets.lockedAt), desc(schema.timesheets.periodStart));
    const byUser = new Map<string, typeof schema.timesheets.$inferSelect>();
    for (const ts of locked) if (!byUser.has(ts.userId)) byUser.set(ts.userId, ts);
    return byUser;
  }

  /** TLS-03 LOE report: per projectCode for a period — percent and salary-prorated cost. */
  async loeReport(period: string) {
    if (!PERIOD_RE.test(period)) throw new BadRequestException('period must be YYYY-MM');
    const byUser = await this.latestLockedByUser(period);
    const userIds = [...byUser.keys()];
    const users = userIds.length
      ? await db.select({
          id: schema.users.id, name: schema.users.name, salaryKobo: schema.staffProfiles.salaryKobo,
        }).from(schema.users)
          .leftJoin(schema.staffProfiles, eq(schema.staffProfiles.userId, schema.users.id))
          .where(inArray(schema.users.id, userIds))
      : [];
    const info = new Map(users.map((u) => [u.id, u]));
    const projects = new Map<string, {
      totalPercent: number; costKobo: bigint;
      staff: { userId: string; name: string; percent: number; costKobo: string }[];
    }>();
    const missingSalary: string[] = [];
    for (const [userId, ts] of byUser) {
      const u = info.get(userId);
      const salary = u?.salaryKobo ?? null;
      if (salary === null && u) missingSalary.push(u.name);
      for (const row of ts.rows as TimesheetRow[]) {
        // cost basis: monthly salaryKobo prorated by LOE percent
        const cost = salary === null ? 0n : (salary * BigInt(Math.round(row.percent * 100)) + 5000n) / 10000n;
        const agg = projects.get(row.projectCode) ?? { totalPercent: 0, costKobo: 0n, staff: [] };
        agg.totalPercent += row.percent;
        agg.costKobo += cost;
        agg.staff.push({ userId, name: u?.name ?? userId, percent: row.percent, costKobo: cost.toString() });
        projects.set(row.projectCode, agg);
      }
    }
    return {
      period,
      staffCount: byUser.size,
      staffWithoutSalary: missingSalary,
      projects: [...projects.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([projectCode, p]) => ({
          projectCode, totalPercent: p.totalPercent, costKobo: p.costKobo.toString(), staff: p.staff,
        })),
    };
  }
}

@Controller('v1/timesheets')
@UseGuards(AuthGuard)
export class TimesheetsController {
  constructor(private readonly svc: TimesheetsService, private readonly workflow: WorkflowService) {}

  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    return this.svc.create(user, body, req.ip);
  }

  @Get()
  list(@CurrentUser() user: AuthedUser, @Query('scope') scope?: string, @Query('period') period?: string) {
    return this.svc.list(user, scope === 'all' ? 'all' : 'mine', period || undefined);
  }

  /** TLS-03: LOE report — restricted to Finance, Admin and Internal Audit. */
  @Get('loe')
  @RequireRoles('FINANCE', 'SYSTEM_ADMIN', 'INTERNAL_AUDIT')
  loe(@Query('period') period?: string) {
    if (!period) throw new BadRequestException('period=YYYY-MM is required');
    return this.svc.loeReport(period);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.svc.get(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.update(user, id, body, req.ip);
  }

  @Post(':id/submit')
  submit(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    return this.svc.submit(user, id, req.ip);
  }

  @Post(':id/adjust')
  adjust(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.adjust(user, id, body, req.ip);
  }

  /** Approve / reject / return the underlying TIMESHEET transaction. */
  @Post(':id/action')
  async action(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = z.object({ verb: z.enum(['approve', 'reject', 'return']), comment: z.string().max(2000).optional() }).parse(body);
    const txId = await this.svc.txIdFor(id);
    return this.workflow.act(txId, user, dto.verb, dto.comment, req.ip);
  }
}
