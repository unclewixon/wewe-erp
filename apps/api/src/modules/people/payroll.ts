/**
 * PAY-01..03 payroll: compute a draft run for a period from staff_profiles,
 * release through the PAYROLL workflow (FINANCE → FINAL_APPROVER), payslips,
 * statutory remittance summary, and project cost distribution from locked timesheets.
 */
import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable,
  NotFoundException, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';
import { WorkflowService } from '../../workflow/workflow.service';
import type { RoleCode } from '../../db/schema';
import { getSetting } from './settings.util';
import { computePayrollItem, parseRules, splitByPercents } from './payroll.logic';
import { TimesheetsService } from './timesheets';
import type { TimesheetRow } from './timesheet.logic';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const RunSchema = z.object({ period: z.string().regex(PERIOD_RE, 'period must be YYYY-MM') });
const AllowancesSchema = z.array(z.object({ name: z.string(), amountKobo: z.string().regex(/^\d+$/) }));

const hasRole = (user: AuthedUser, ...codes: RoleCode[]) => user.roles.some((r) => codes.includes(r.code));

/** onFinalApproval('PAYROLL'): mark released once + queue payslip notifications for staff. */
export async function payrollApprovalHook(tx: { id: string; ref: string; payload: unknown }): Promise<void> {
  const payload = (tx.payload ?? {}) as Record<string, unknown>;
  const runId = payload.runId as string | undefined;
  const run = runId
    ? await db.query.payrollRuns.findFirst({ where: eq(schema.payrollRuns.id, runId) })
    : await db.query.payrollRuns.findFirst({ where: eq(schema.payrollRuns.txId, tx.id) });
  if (!run || run.status === 'RELEASED') return; // idempotent-safe
  await db.update(schema.payrollRuns)
    .set({ status: 'RELEASED', releasedAt: new Date() })
    .where(eq(schema.payrollRuns.id, run.id));
  const items = await db.select({ userId: schema.payrollItems.userId })
    .from(schema.payrollItems).where(eq(schema.payrollItems.runId, run.id));
  if (items.length > 0) {
    await db.insert(schema.notifications).values(items.map((i) => ({
      userId: i.userId, kind: 'UPDATE',
      title: `Payslip available — ${run.period}`,
      body: `Your payslip for ${run.period} is now available.`,
      entityType: 'payroll_run', entityId: run.id,
    })));
  }
  await new AuditService().log({
    action: 'PAYROLL_RELEASED', entityType: 'payroll_run', entityId: run.id,
    data: { ref: tx.ref, period: run.period, staff: items.length },
  });
}

interface RunTotals {
  grossKobo: bigint; payeKobo: bigint; pensionEmployeeKobo: bigint;
  pensionEmployerKobo: bigint; nhfKobo: bigint; netKobo: bigint; staffCount: number;
}
const totalsOut = (t: RunTotals) => ({
  grossKobo: t.grossKobo.toString(), payeKobo: t.payeKobo.toString(),
  pensionEmployeeKobo: t.pensionEmployeeKobo.toString(), pensionEmployerKobo: t.pensionEmployerKobo.toString(),
  nhfKobo: t.nhfKobo.toString(), netKobo: t.netKobo.toString(), staffCount: t.staffCount,
});

@Injectable()
export class PayrollService {
  constructor(
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly timesheets: TimesheetsService,
  ) {}

  private async rules() {
    const raw = await getSetting('payroll.rules');
    if (!raw) throw new BadRequestException('payroll.rules is not configured in settings');
    return parseRules(raw);
  }

  /** PAY-01: compute (or recompute while DRAFT) the run for a period. */
  async computeRun(user: AuthedUser, period: string, ip?: string) {
    const rules = await this.rules();
    const existing = await db.query.payrollRuns.findFirst({ where: eq(schema.payrollRuns.period, period) });
    if (existing && existing.status !== 'DRAFT')
      throw new ConflictException(`Payroll run for ${period} is already ${existing.status}`);

    const staff = await db.select({
      id: schema.users.id, name: schema.users.name,
      salaryKobo: schema.staffProfiles.salaryKobo, allowances: schema.staffProfiles.allowances,
    }).from(schema.users)
      .innerJoin(schema.staffProfiles, eq(schema.staffProfiles.userId, schema.users.id))
      .where(and(eq(schema.users.active, true), isNotNull(schema.staffProfiles.salaryKobo)));
    if (staff.length === 0) throw new BadRequestException('No active staff with a salary on their profile');

    let runId: string;
    if (existing) {
      runId = existing.id;
      await db.delete(schema.payrollItems).where(eq(schema.payrollItems.runId, runId));
    } else {
      const [run] = await db.insert(schema.payrollRuns)
        .values({ period, status: 'DRAFT', createdById: user.id }).returning();
      runId = run.id;
    }

    const totals: RunTotals = {
      grossKobo: 0n, payeKobo: 0n, pensionEmployeeKobo: 0n,
      pensionEmployerKobo: 0n, nhfKobo: 0n, netKobo: 0n, staffCount: staff.length,
    };
    for (const s of staff) {
      const parsedAllowances = AllowancesSchema.safeParse(s.allowances ?? []);
      const allowances = parsedAllowances.success ? parsedAllowances.data : [];
      const c = computePayrollItem(s.salaryKobo!, allowances.map((a) => BigInt(a.amountKobo)), rules);
      await db.insert(schema.payrollItems).values({
        runId, userId: s.id,
        grossKobo: c.grossKobo, payeKobo: c.payeKobo,
        pensionEmployeeKobo: c.pensionEmployeeKobo, pensionEmployerKobo: c.pensionEmployerKobo,
        nhfKobo: c.nhfKobo, otherDeductionsKobo: 0n, netKobo: c.netKobo,
        breakdown: {
          salaryKobo: s.salaryKobo!.toString(),
          allowances,
          annualGrossKobo: c.annualGrossKobo.toString(),
          craAnnualKobo: c.craAnnualKobo.toString(),
          taxableAnnualKobo: c.taxableAnnualKobo.toString(),
          payeAnnualKobo: c.payeAnnualKobo.toString(),
        },
      });
      totals.grossKobo += c.grossKobo;
      totals.payeKobo += c.payeKobo;
      totals.pensionEmployeeKobo += c.pensionEmployeeKobo;
      totals.pensionEmployerKobo += c.pensionEmployerKobo;
      totals.nhfKobo += c.nhfKobo;
      totals.netKobo += c.netKobo;
    }
    await db.update(schema.payrollRuns).set({ totals: totalsOut(totals) }).where(eq(schema.payrollRuns.id, runId));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email,
      action: existing ? 'PAYROLL_RUN_RECOMPUTED' : 'PAYROLL_RUN_COMPUTED',
      entityType: 'payroll_run', entityId: runId,
      data: { period, totals: totalsOut(totals) }, ip,
    });
    return this.getRun(user, runId);
  }

  async listRuns() {
    const rows = await db.select().from(schema.payrollRuns).orderBy(desc(schema.payrollRuns.period)).limit(60);
    return rows.map((r) => ({
      id: r.id, period: r.period, status: r.status, totals: r.totals,
      releasedAt: r.releasedAt, createdAt: r.createdAt, txId: r.txId,
    }));
  }

  async getRun(_user: AuthedUser, id: string) {
    const run = await db.query.payrollRuns.findFirst({ where: eq(schema.payrollRuns.id, id) });
    if (!run) throw new NotFoundException('Payroll run not found');
    const items = await db.select({ item: schema.payrollItems, name: schema.users.name })
      .from(schema.payrollItems)
      .innerJoin(schema.users, eq(schema.payrollItems.userId, schema.users.id))
      .where(eq(schema.payrollItems.runId, id))
      .orderBy(schema.users.name);
    let ref: string | null = null;
    if (run.txId) {
      const tx = await db.query.transactions.findFirst({ where: eq(schema.transactions.id, run.txId) });
      ref = tx?.ref ?? null;
    }
    return {
      id: run.id, period: run.period, status: run.status, totals: run.totals,
      releasedAt: run.releasedAt, createdAt: run.createdAt, txId: run.txId, txRef: ref,
      items: items.map((r) => this.itemOut(r.item, r.name)),
    };
  }

  private itemOut(i: typeof schema.payrollItems.$inferSelect, name: string) {
    return {
      id: i.id, userId: i.userId, user: name,
      grossKobo: i.grossKobo.toString(), payeKobo: i.payeKobo.toString(),
      pensionEmployeeKobo: i.pensionEmployeeKobo.toString(), pensionEmployerKobo: i.pensionEmployerKobo.toString(),
      nhfKobo: i.nhfKobo.toString(), otherDeductionsKobo: i.otherDeductionsKobo.toString(),
      netKobo: i.netKobo.toString(), breakdown: i.breakdown,
    };
  }

  /** PAY-02: route the run for release approval — amount is the total net pay. */
  async release(user: AuthedUser, id: string, ip?: string) {
    const run = await db.query.payrollRuns.findFirst({ where: eq(schema.payrollRuns.id, id) });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== 'DRAFT') throw new ConflictException(`Payroll run is already ${run.status}`);
    const totals = (run.totals ?? {}) as { netKobo?: string };
    if (!totals.netKobo) throw new BadRequestException('Run has no computed totals — compute it first');
    const tx = await this.workflow.createTransaction(user, {
      typeCode: 'PAYROLL',
      title: `Payroll ${run.period}`,
      amountKobo: BigInt(totals.netKobo),
      payload: { runId: run.id, period: run.period, totals: run.totals },
      submit: true, ip,
    });
    await db.update(schema.payrollRuns).set({ status: 'PENDING', txId: tx.id }).where(eq(schema.payrollRuns.id, id));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'PAYROLL_RELEASE_SUBMITTED',
      entityType: 'payroll_run', entityId: id, data: { ref: tx.ref, period: run.period, netKobo: totals.netKobo }, ip,
    });
    return this.getRun(user, id);
  }

  async txIdFor(id: string): Promise<string> {
    const run = await db.query.payrollRuns.findFirst({ where: eq(schema.payrollRuns.id, id) });
    if (!run?.txId) throw new NotFoundException('Payroll run has no release transaction');
    return run.txId;
  }

  /** PAY-02 payslip: self always; other staff only for HR / Finance / Admin. */
  async payslip(user: AuthedUser, period: string, forUserId?: string) {
    const targetId = forUserId ?? user.id;
    const privileged = hasRole(user, 'HR_OFFICER', 'FINANCE', 'SYSTEM_ADMIN');
    if (targetId !== user.id && !privileged)
      throw new ForbiddenException('You can only view your own payslip');
    const run = await db.query.payrollRuns.findFirst({ where: eq(schema.payrollRuns.period, period) });
    if (!run) throw new NotFoundException(`No payroll run for ${period}`);
    if (run.status !== 'RELEASED' && !privileged)
      throw new NotFoundException(`Payroll for ${period} has not been released yet`);
    const item = await db.query.payrollItems.findFirst({
      where: and(eq(schema.payrollItems.runId, run.id), eq(schema.payrollItems.userId, targetId)),
    });
    if (!item) throw new NotFoundException('No payslip for this staff member in that period');
    const target = await db.query.users.findFirst({
      where: eq(schema.users.id, targetId), with: { department: true },
    });
    return {
      ...this.itemOut(item, target?.name ?? targetId),
      period, runStatus: run.status, releasedAt: run.releasedAt,
      user: { id: targetId, name: target?.name ?? targetId, title: target?.title ?? null, department: target?.department?.name ?? null },
    };
  }

  /** PAY-03: statutory remittance summary (PAYE / pension / NHF) for a period. */
  async remittance(period: string) {
    const run = await db.query.payrollRuns.findFirst({ where: eq(schema.payrollRuns.period, period) });
    if (!run) throw new NotFoundException(`No payroll run for ${period}`);
    const items = await db.select().from(schema.payrollItems).where(eq(schema.payrollItems.runId, run.id));
    const sum = (f: (i: typeof items[number]) => bigint) => items.reduce((s, i) => s + f(i), 0n);
    const paye = sum((i) => i.payeKobo);
    const pensionEmployee = sum((i) => i.pensionEmployeeKobo);
    const pensionEmployer = sum((i) => i.pensionEmployerKobo);
    const nhf = sum((i) => i.nhfKobo);
    return {
      period, runStatus: run.status, staffCount: items.length,
      payeKobo: paye.toString(),
      pensionEmployeeKobo: pensionEmployee.toString(),
      pensionEmployerKobo: pensionEmployer.toString(),
      pensionTotalKobo: (pensionEmployee + pensionEmployer).toString(),
      nhfKobo: nhf.toString(),
    };
  }

  /**
   * PAY-03 cost distribution: net + employer pension for each staff member,
   * split by their latest LOCKED timesheet for the period (fallback 100% 'ORG').
   */
  async costDistribution(period: string) {
    const run = await db.query.payrollRuns.findFirst({ where: eq(schema.payrollRuns.period, period) });
    if (!run) throw new NotFoundException(`No payroll run for ${period}`);
    const items = await db.select({ item: schema.payrollItems, name: schema.users.name })
      .from(schema.payrollItems)
      .innerJoin(schema.users, eq(schema.payrollItems.userId, schema.users.id))
      .where(eq(schema.payrollItems.runId, run.id))
      .orderBy(schema.users.name);
    const lockedByUser = await this.timesheets.latestLockedByUser(period);
    const byProject = new Map<string, bigint>();
    const perStaff = items.map(({ item, name }) => {
      const costKobo = item.netKobo + item.pensionEmployerKobo;
      const ts = lockedByUser.get(item.userId);
      const rows: TimesheetRow[] = ts ? (ts.rows as TimesheetRow[]) : [{ projectCode: 'ORG', percent: 100 }];
      const splits = splitByPercents(costKobo, rows);
      for (const s of splits) byProject.set(s.projectCode, (byProject.get(s.projectCode) ?? 0n) + s.amountKobo);
      return {
        userId: item.userId, user: name, costKobo: costKobo.toString(),
        source: ts ? 'TIMESHEET' : 'FALLBACK_ORG',
        splits: splits.map((s) => ({ projectCode: s.projectCode, percent: s.percent, amountKobo: s.amountKobo.toString() })),
      };
    });
    return {
      period, runStatus: run.status,
      byProject: [...byProject.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([projectCode, amount]) => ({ projectCode, amountKobo: amount.toString() })),
      perStaff,
    };
  }
}

@Controller('v1/payroll')
@UseGuards(AuthGuard)
export class PayrollController {
  constructor(private readonly svc: PayrollService, private readonly workflow: WorkflowService) {}

  /** PAY-01: compute a draft run for period YYYY-MM. */
  @Post('runs')
  @RequireRoles('HR_OFFICER', 'FINANCE')
  compute(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    const dto = RunSchema.parse(body);
    return this.svc.computeRun(user, dto.period, req.ip);
  }

  @Get('runs')
  @RequireRoles('HR_OFFICER', 'FINANCE', 'SYSTEM_ADMIN', 'INTERNAL_AUDIT')
  runs() {
    return this.svc.listRuns();
  }

  @Get('runs/:id')
  @RequireRoles('HR_OFFICER', 'FINANCE', 'SYSTEM_ADMIN', 'INTERNAL_AUDIT')
  run(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.svc.getRun(user, id);
  }

  @Post('runs/:id/release')
  @RequireRoles('HR_OFFICER', 'FINANCE')
  release(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    return this.svc.release(user, id, req.ip);
  }

  /** Approve / reject / return the underlying PAYROLL release transaction. */
  @Post('runs/:id/action')
  async action(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = z.object({ verb: z.enum(['approve', 'reject', 'return']), comment: z.string().max(2000).optional() }).parse(body);
    const txId = await this.svc.txIdFor(id);
    return this.workflow.act(txId, user, dto.verb, dto.comment, req.ip);
  }

  @Get('payslips/:period')
  payslip(@CurrentUser() user: AuthedUser, @Param('period') period: string, @Query('userId') userId?: string) {
    if (!PERIOD_RE.test(period)) throw new BadRequestException('period must be YYYY-MM');
    return this.svc.payslip(user, period, userId || undefined);
  }

  @Get('remittance')
  @RequireRoles('HR_OFFICER', 'FINANCE', 'SYSTEM_ADMIN')
  remittance(@Query('period') period?: string) {
    if (!period || !PERIOD_RE.test(period)) throw new BadRequestException('period=YYYY-MM is required');
    return this.svc.remittance(period);
  }

  @Get('cost-distribution')
  @RequireRoles('FINANCE', 'SYSTEM_ADMIN', 'INTERNAL_AUDIT')
  costDistribution(@Query('period') period?: string) {
    if (!period || !PERIOD_RE.test(period)) throw new BadRequestException('period=YYYY-MM is required');
    return this.svc.costDistribution(period);
  }
}
