/**
 * HRM-02 leave: types + lazily-created yearly balances, approval-routed requests
 * (LEAVE transaction: SUPERVISOR → HR_OFFICER), team calendar, balance decrement
 * on final approval. Sick-leave evidence notes are HR-only (and self).
 */
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Injectable,
  NotFoundException, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, type AuthedUser } from '../../auth/auth';
import { WorkflowService } from '../../workflow/workflow.service';
import type { RoleCode } from '../../db/schema';
import { getSetting } from './settings.util';
import { balanceAllows, leaveDays } from './leave.logic';

export const LEAVE_TYPE_SEED = [
  { code: 'ANNUAL', name: 'Annual Leave', daysPerYear: 20 },
  { code: 'SICK', name: 'Sick Leave', daysPerYear: 10 },
  { code: 'COMPASSIONATE', name: 'Compassionate Leave', daysPerYear: 5 },
  { code: 'MATERNITY', name: 'Maternity Leave', daysPerYear: 84 },
  { code: 'PATERNITY', name: 'Paternity Leave', daysPerYear: 10 },
];

const RequestSchema = z.object({
  leaveTypeCode: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  handoverNote: z.string().max(2000).optional(),
  /** Sick leave only — medical evidence reference; visible to HR (and the requester). */
  sickEvidenceNote: z.string().max(2000).optional(),
});

const hasRole = (user: AuthedUser, ...codes: RoleCode[]) => user.roles.some((r) => codes.includes(r.code));
const HR_VIEW: RoleCode[] = ['HR_OFFICER', 'SYSTEM_ADMIN'];

/** Lazily create this year's balance rows from the configured leave types (idempotent). */
export async function ensureBalances(userId: string, year: number): Promise<void> {
  const types = await db.select().from(schema.leaveTypes);
  for (const t of types) {
    await db.insert(schema.leaveBalances)
      .values({ userId, leaveTypeId: t.id, year, entitledDays: t.daysPerYear })
      .onConflictDoNothing({
        target: [schema.leaveBalances.userId, schema.leaveBalances.leaveTypeId, schema.leaveBalances.year],
      });
  }
}

/** onFinalApproval('LEAVE'): decrement the balance exactly once (payload flag guards re-entry). */
export async function leaveApprovalHook(tx: {
  id: string; ref: string; payload: unknown;
}): Promise<void> {
  const payload = (tx.payload ?? {}) as Record<string, unknown>;
  if (payload.balanceApplied === true) return; // idempotent-safe
  const lr = await db.query.leaveRequests.findFirst({ where: eq(schema.leaveRequests.txId, tx.id) });
  if (!lr) return;
  const year = lr.startDate.getUTCFullYear();
  await ensureBalances(lr.userId, year);
  const bal = await db.query.leaveBalances.findFirst({
    where: and(
      eq(schema.leaveBalances.userId, lr.userId),
      eq(schema.leaveBalances.leaveTypeId, lr.leaveTypeId),
      eq(schema.leaveBalances.year, year),
    ),
  });
  if (!bal) return;
  await db.update(schema.leaveBalances)
    .set({ usedDays: bal.usedDays + lr.days })
    .where(eq(schema.leaveBalances.id, bal.id));
  await db.update(schema.transactions)
    .set({ payload: { ...payload, balanceApplied: true } })
    .where(eq(schema.transactions.id, tx.id));
  await new AuditService().log({
    action: 'LEAVE_BALANCE_APPLIED', entityType: 'leave_request', entityId: lr.id,
    data: { ref: tx.ref, userId: lr.userId, days: lr.days, year },
  });
}

@Injectable()
export class LeaveService {
  constructor(private readonly audit: AuditService, private readonly workflow: WorkflowService) {}

  types() {
    return db.select().from(schema.leaveTypes).orderBy(schema.leaveTypes.name);
  }

  async balances(user: AuthedUser, forUserId?: string, year?: number) {
    const userId = forUserId ?? user.id;
    if (userId !== user.id && !hasRole(user, ...HR_VIEW))
      throw new ForbiddenException('Only HR can view another staff member\'s balances');
    const y = year ?? new Date().getUTCFullYear();
    await ensureBalances(userId, y);
    const rows = await db.select({ bal: schema.leaveBalances, type: schema.leaveTypes })
      .from(schema.leaveBalances)
      .innerJoin(schema.leaveTypes, eq(schema.leaveBalances.leaveTypeId, schema.leaveTypes.id))
      .where(and(eq(schema.leaveBalances.userId, userId), eq(schema.leaveBalances.year, y)))
      .orderBy(schema.leaveTypes.name);
    return rows.map((r) => ({
      leaveTypeCode: r.type.code, leaveType: r.type.name, year: r.bal.year,
      entitledDays: r.bal.entitledDays, usedDays: r.bal.usedDays,
      remainingDays: r.bal.entitledDays - r.bal.usedDays,
    }));
  }

  async request(user: AuthedUser, body: unknown, ip?: string) {
    const dto = RequestSchema.parse(body);
    const type = await db.query.leaveTypes.findFirst({ where: eq(schema.leaveTypes.code, dto.leaveTypeCode) });
    if (!type) throw new BadRequestException(`Unknown leave type ${dto.leaveTypeCode}`);
    if (dto.endDate < dto.startDate) throw new BadRequestException('endDate must be on or after startDate');
    if (dto.startDate.getUTCFullYear() !== dto.endDate.getUTCFullYear())
      throw new BadRequestException('Leave spanning a year end must be split into two requests');
    if (dto.sickEvidenceNote && type.code !== 'SICK')
      throw new BadRequestException('Evidence notes apply to sick leave only');
    const days = leaveDays(dto.startDate, dto.endDate);
    if (days < 1) throw new BadRequestException('The selected range contains no working days');

    const year = dto.startDate.getUTCFullYear();
    await ensureBalances(user.id, year);
    const bal = await db.query.leaveBalances.findFirst({
      where: and(
        eq(schema.leaveBalances.userId, user.id),
        eq(schema.leaveBalances.leaveTypeId, type.id),
        eq(schema.leaveBalances.year, year),
      ),
    });
    const allowNegative = (await getSetting<boolean>('leave.allowNegative')) === true;
    if (!bal || !balanceAllows(bal.entitledDays, bal.usedDays, days, allowNegative))
      throw new BadRequestException(
        `Insufficient ${type.name} balance: ${bal ? bal.entitledDays - bal.usedDays : 0} day(s) remaining, ${days} requested`,
      );

    // Overlap: block any range that collides with own approved (or still-pending) leave.
    const clashes = await db.select({ lr: schema.leaveRequests, status: schema.transactions.status })
      .from(schema.leaveRequests)
      .innerJoin(schema.transactions, eq(schema.leaveRequests.txId, schema.transactions.id))
      .where(and(
        eq(schema.leaveRequests.userId, user.id),
        inArray(schema.transactions.status, ['APPROVED', 'PENDING']),
        lte(schema.leaveRequests.startDate, dto.endDate),
        gte(schema.leaveRequests.endDate, dto.startDate),
      ));
    if (clashes.length > 0)
      throw new BadRequestException('This range overlaps leave you already have approved or awaiting approval');

    const tx = await this.workflow.createTransaction(user, {
      typeCode: 'LEAVE',
      title: `${type.name} — ${user.name} (${days}d)`,
      payload: {
        leaveTypeCode: type.code, leaveType: type.name,
        startDate: dto.startDate.toISOString(), endDate: dto.endDate.toISOString(), days,
        handoverNote: dto.handoverNote ?? null,
        sickEvidenceNote: dto.sickEvidenceNote ?? null, // surfaced to HR only via the API layer
      },
      submit: true, ip,
    });
    const [lr] = await db.insert(schema.leaveRequests).values({
      txId: tx.id, userId: user.id, leaveTypeId: type.id,
      startDate: dto.startDate, endDate: dto.endDate, days,
      handoverNote: dto.handoverNote ?? null,
    }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'LEAVE_REQUESTED',
      entityType: 'leave_request', entityId: lr.id,
      data: { ref: tx.ref, type: type.code, days, startDate: dto.startDate.toISOString(), endDate: dto.endDate.toISOString() }, ip,
    });
    return this.serialise(user, lr, tx, type.name);
  }

  private serialise(
    viewer: AuthedUser,
    lr: typeof schema.leaveRequests.$inferSelect,
    tx: typeof schema.transactions.$inferSelect,
    typeName: string,
    userName?: string,
  ) {
    const payload = (tx.payload ?? {}) as Record<string, unknown>;
    const canSeeEvidence = viewer.id === lr.userId || hasRole(viewer, ...HR_VIEW);
    return {
      id: lr.id, txId: tx.id, ref: tx.ref, status: tx.status, currentStage: tx.currentStage,
      userId: lr.userId, user: userName ?? viewer.name, leaveType: typeName,
      startDate: lr.startDate, endDate: lr.endDate, days: lr.days,
      handoverNote: lr.handoverNote,
      sickEvidenceNote: canSeeEvidence ? ((payload.sickEvidenceNote as string | null) ?? null) : null,
      submittedAt: tx.submittedAt,
    };
  }

  async list(user: AuthedUser, scope: 'mine' | 'all') {
    if (scope === 'all' && !hasRole(user, ...HR_VIEW))
      throw new ForbiddenException('Only HR can list all leave requests');
    const rows = await db.select({
      lr: schema.leaveRequests, tx: schema.transactions,
      typeName: schema.leaveTypes.name, userName: schema.users.name,
    }).from(schema.leaveRequests)
      .innerJoin(schema.transactions, eq(schema.leaveRequests.txId, schema.transactions.id))
      .innerJoin(schema.leaveTypes, eq(schema.leaveRequests.leaveTypeId, schema.leaveTypes.id))
      .innerJoin(schema.users, eq(schema.leaveRequests.userId, schema.users.id))
      .where(scope === 'mine' ? eq(schema.leaveRequests.userId, user.id) : undefined)
      .orderBy(desc(schema.leaveRequests.startDate))
      .limit(200);
    return rows.map((r) => this.serialise(user, r.lr, r.tx, r.typeName, r.userName));
  }

  /** HRM-02 team calendar: approved leave for one department over a period. */
  async calendar(user: AuthedUser, departmentId?: string, from?: Date, to?: Date) {
    const depId = departmentId ?? user.departmentId;
    if (!depId) throw new BadRequestException('No department: pass ?departmentId=');
    const now = new Date();
    const start = from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = to ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    const dep = await db.query.departments.findFirst({ where: eq(schema.departments.id, depId) });
    if (!dep) throw new NotFoundException('Department not found');
    const rows = await db.select({
      lr: schema.leaveRequests, typeName: schema.leaveTypes.name, userName: schema.users.name,
    }).from(schema.leaveRequests)
      .innerJoin(schema.transactions, eq(schema.leaveRequests.txId, schema.transactions.id))
      .innerJoin(schema.users, eq(schema.leaveRequests.userId, schema.users.id))
      .innerJoin(schema.leaveTypes, eq(schema.leaveRequests.leaveTypeId, schema.leaveTypes.id))
      .where(and(
        eq(schema.transactions.status, 'APPROVED'),
        eq(schema.users.departmentId, depId),
        lte(schema.leaveRequests.startDate, end),
        gte(schema.leaveRequests.endDate, start),
      ))
      .orderBy(schema.leaveRequests.startDate);
    return {
      department: { id: dep.id, name: dep.name },
      from: start, to: end,
      entries: rows.map((r) => ({
        userId: r.lr.userId, user: r.userName, leaveType: r.typeName,
        startDate: r.lr.startDate, endDate: r.lr.endDate, days: r.lr.days,
      })),
    };
  }

  async txIdFor(id: string): Promise<string> {
    const lr = await db.query.leaveRequests.findFirst({ where: eq(schema.leaveRequests.id, id) });
    if (!lr) throw new NotFoundException('Leave request not found');
    return lr.txId;
  }
}

@Controller('v1/leave')
@UseGuards(AuthGuard)
export class LeaveController {
  constructor(private readonly svc: LeaveService, private readonly workflow: WorkflowService) {}

  @Get('types')
  types() {
    return this.svc.types();
  }

  @Get('balances')
  balances(@CurrentUser() user: AuthedUser, @Query('userId') userId?: string, @Query('year') year?: string) {
    return this.svc.balances(user, userId || undefined, year ? Number(year) : undefined);
  }

  @Post('requests')
  request(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    return this.svc.request(user, body, req.ip);
  }

  @Get('requests')
  list(@CurrentUser() user: AuthedUser, @Query('scope') scope?: string) {
    return this.svc.list(user, scope === 'all' ? 'all' : 'mine');
  }

  /** Approve / reject / return the underlying LEAVE transaction (engine enforces SoD). */
  @Post('requests/:id/action')
  async action(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = z.object({ verb: z.enum(['approve', 'reject', 'return']), comment: z.string().max(2000).optional() }).parse(body);
    const txId = await this.svc.txIdFor(id);
    return this.workflow.act(txId, user, dto.verb, dto.comment, req.ip);
  }

  @Get('calendar')
  calendar(
    @CurrentUser() user: AuthedUser,
    @Query('departmentId') departmentId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const parse = (s?: string) => {
      if (!s) return undefined;
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date filter');
      return d;
    };
    return this.svc.calendar(user, departmentId || undefined, parse(from), parse(to));
  }
}
