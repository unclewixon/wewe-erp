/**
 * Reporting & auditor-access module:
 *  - AUD-06 external auditor accounts (scoped, expiring, read-only — enforcement in AuthGuard)
 *  - DSH-05 scheduled reports (weekly cadence → email outbox + notifications)
 *  - DSH-06 saved custom reports over curated views (safe column/filter whitelist)
 */
import {
  BadRequestException, Body, Controller, Get, Injectable, NotFoundException,
  Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';

// ---------------- AUD-06: external auditor accounts ----------------
const AuditorSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  donorCode: z.string().optional().nullable(),
  periodStart: z.coerce.date().optional().nullable(),
  periodEnd: z.coerce.date().optional().nullable(),
  expiresAt: z.coerce.date(),
});

@Controller('v1/auditor')
@UseGuards(AuthGuard)
export class AuditorController {
  constructor(private readonly audit: AuditService) {}

  @Post('accounts')
  @RequireRoles('SYSTEM_ADMIN')
  async create(@CurrentUser() admin: AuthedUser, @Body() body: unknown, @Req() req: any) {
    const dto = AuditorSchema.parse(body);
    if (dto.expiresAt <= new Date()) throw new BadRequestException('Expiry must be in the future');
    const tempPassword = randomBytes(9).toString('base64url');
    const [user] = await db.insert(schema.users).values({
      email: dto.email.toLowerCase(), name: dto.name, title: 'External Auditor',
      passwordHash: await argon2.hash(tempPassword),
    }).returning();
    const role = await db.query.roles.findFirst({ where: eq(schema.roles.code, 'EXTERNAL_AUDITOR') });
    if (!role) throw new BadRequestException('EXTERNAL_AUDITOR role missing — reseed');
    await db.insert(schema.userRoles).values({ userId: user.id, roleId: role.id, departmentId: null });
    const [scope] = await db.insert(schema.auditorScopes).values({
      userId: user.id, donorCode: dto.donorCode ?? null,
      periodStart: dto.periodStart ?? null, periodEnd: dto.periodEnd ?? null,
      expiresAt: dto.expiresAt, createdById: admin.id,
    }).returning();
    await this.audit.log({
      actorId: admin.id, actorEmail: admin.email, action: 'AUDITOR_ACCOUNT_CREATED',
      entityType: 'user', entityId: user.id,
      data: { donorCode: dto.donorCode ?? 'ALL', expiresAt: dto.expiresAt.toISOString() }, ip: req.ip,
    });
    // temp password returned ONCE; auditor must be given it out-of-band
    return { user: { id: user.id, email: user.email, name: user.name }, scope, tempPassword };
  }

  @Get('accounts')
  @RequireRoles('SYSTEM_ADMIN', 'INTERNAL_AUDIT')
  async list() {
    const scopes = await db.select().from(schema.auditorScopes).orderBy(desc(schema.auditorScopes.createdAt));
    const userIds = [...new Set(scopes.map((s) => s.userId))];
    const users = userIds.length
      ? await db.select().from(schema.users).where(inArray(schema.users.id, userIds)) : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return scopes.map((s) => ({
      ...s,
      user: byId.get(s.userId) ? { name: byId.get(s.userId)!.name, email: byId.get(s.userId)!.email, active: byId.get(s.userId)!.active } : null,
      expired: s.expiresAt <= new Date(),
    }));
  }

  @Post('accounts/:scopeId/revoke')
  @RequireRoles('SYSTEM_ADMIN')
  async revoke(@CurrentUser() admin: AuthedUser, @Param('scopeId') scopeId: string, @Req() req: any) {
    const [scope] = await db.select().from(schema.auditorScopes).where(eq(schema.auditorScopes.id, scopeId));
    if (!scope) throw new NotFoundException('Scope not found');
    await db.update(schema.auditorScopes).set({ expiresAt: new Date() }).where(eq(schema.auditorScopes.id, scopeId));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, scope.userId));
    await this.audit.log({ actorId: admin.id, actorEmail: admin.email, action: 'AUDITOR_ACCESS_REVOKED', entityType: 'user', entityId: scope.userId, ip: req.ip });
    return { ok: true };
  }

  /** The auditor's own view of what they can see. */
  @Get('my-scope')
  async myScope(@CurrentUser() user: AuthedUser) {
    const [scope] = await db.select().from(schema.auditorScopes)
      .where(and(eq(schema.auditorScopes.userId, user.id), sql`${schema.auditorScopes.expiresAt} > now()`));
    if (!scope) throw new NotFoundException('No active auditor scope');
    return scope;
  }
}

// ---------------- report generators (shared by scheduled + on-demand) ----------------
export type ReportKey = 'requisition-register' | 'outstanding-advances' | 'pipeline';

export async function generateReport(key: ReportKey, filters?: { from?: Date; to?: Date; donorCode?: string }) {
  if (key === 'requisition-register') {
    const rows = await db.query.transactions.findMany({
      where: eq(schema.transactions.typeCode, 'REQUISITION'),
      with: { department: true, initiator: { columns: { name: true } } },
      orderBy: [desc(schema.transactions.createdAt)], limit: 1000,
    });
    const filtered = rows.filter((t) =>
      (!filters?.from || (t.submittedAt && t.submittedAt >= filters.from)) &&
      (!filters?.to || (t.submittedAt && t.submittedAt <= filters.to)) &&
      (!filters?.donorCode || t.donorCode === filters.donorCode));
    return {
      title: 'Requisition register',
      columns: ['Ref', 'Title', 'Department', 'Initiator', 'Amount (kobo)', 'Donor', 'Status'],
      rows: filtered.map((t) => [t.ref, t.title, t.department.name, t.initiator.name, t.amountKobo.toString(), t.donorCode ?? '', t.status]),
    };
  }
  if (key === 'outstanding-advances') {
    const rows = await db.query.advances?.findMany
      ? await db.query.advances.findMany({ with: undefined as any })
      : await db.select().from(schema.advances);
    const open = (rows as any[]).filter((a) => !['CLOSED', 'WRITTEN_OFF'].includes(a.status));
    const users = open.length
      ? await db.select().from(schema.users).where(inArray(schema.users.id, [...new Set(open.map((a) => a.staffId))])) : [];
    const byId = new Map(users.map((u) => [u.id, u.name]));
    return {
      title: 'Outstanding advances',
      columns: ['Ref/Advance', 'Staff', 'Purpose', 'Balance (kobo)', 'Deadline', 'Status'],
      rows: open.map((a) => [a.id, byId.get(a.staffId) ?? a.staffId, a.purpose, a.balanceKobo.toString(),
        a.retirementDeadline ? new Date(a.retirementDeadline).toISOString().slice(0, 10) : '', a.status]),
    };
  }
  // pipeline
  const txs = await db.select().from(schema.transactions);
  const byStatus: Record<string, number> = {};
  for (const t of txs) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
  return {
    title: 'Approval pipeline summary',
    columns: ['Status', 'Count'],
    rows: Object.entries(byStatus).map(([k, v]) => [k, String(v)]),
  };
}

function reportToText(r: { title: string; columns: string[]; rows: string[][] }): string {
  return [r.title, r.columns.join(' | '), ...r.rows.map((row) => row.join(' | '))].join('\n');
}

// ---------------- DSH-05: scheduled reports ----------------
const ScheduleSchema = z.object({
  name: z.string().min(3),
  reportKey: z.enum(['requisition-register', 'outstanding-advances', 'pipeline']),
  filters: z.object({ donorCode: z.string().optional() }).optional(),
  recipientsRole: z.enum(['SUPERVISOR', 'INTERNAL_AUDIT', 'FINANCE', 'FINAL_APPROVER', 'HR_OFFICER', 'SYSTEM_ADMIN']),
  dayOfWeek: z.number().int().min(0).max(6).default(1),
  hour: z.number().int().min(0).max(23).default(8),
});

@Injectable()
export class ScheduledReportsService {
  constructor(private readonly audit: AuditService) {}

  /** Run all schedules that are due (matching weekday+hour in Africa/Lagos, not already run this hour). */
  async runDue(now = new Date()): Promise<number> {
    const lagos = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
    const schedules = await db.select().from(schema.scheduledReports).where(eq(schema.scheduledReports.active, true));
    let ran = 0;
    for (const s of schedules) {
      if (lagos.getDay() !== s.dayOfWeek || lagos.getHours() !== s.hour) continue;
      if (s.lastRunAt && now.getTime() - s.lastRunAt.getTime() < 3600_000) continue; // once per hour slot
      await this.runOne(s.id, now);
      ran += 1;
    }
    return ran;
  }

  async runOne(id: string, now = new Date()) {
    const [s] = await db.select().from(schema.scheduledReports).where(eq(schema.scheduledReports.id, id));
    if (!s) throw new NotFoundException('Schedule not found');
    const report = await generateReport(s.reportKey as ReportKey, (s.filters as any) ?? undefined);
    const body = reportToText(report);
    // recipients = active holders of the role (role survives staff changes — the point of role recipients)
    const role = await db.query.roles.findFirst({ where: eq(schema.roles.code, s.recipientsRole) });
    const grants = role ? await db.select().from(schema.userRoles).where(eq(schema.userRoles.roleId, role.id)) : [];
    const userIds = [...new Set(grants.map((g) => g.userId))];
    const recipients = userIds.length
      ? await db.select().from(schema.users).where(and(inArray(schema.users.id, userIds), eq(schema.users.active, true))) : [];
    for (const u of recipients) {
      await db.insert(schema.emailOutbox).values({ toEmail: u.email, subject: `[WEWE ERP] ${s.name}`, body });
      await db.insert(schema.notifications).values({
        userId: u.id, kind: 'UPDATE', title: `Scheduled report: ${s.name}`, body: `${report.title} — ${report.rows.length} rows`,
        entityType: 'scheduled_report', entityId: s.id,
      });
    }
    await db.update(schema.scheduledReports).set({ lastRunAt: now }).where(eq(schema.scheduledReports.id, id));
    await this.audit.log({ action: 'SCHEDULED_REPORT_RUN', entityType: 'scheduled_report', entityId: s.id, data: { rows: report.rows.length, recipients: recipients.length } });
    return { rows: report.rows.length, recipients: recipients.length };
  }
}

@Controller('v1/reports/schedules')
@UseGuards(AuthGuard)
@RequireRoles('SYSTEM_ADMIN', 'FINANCE')
export class ScheduledReportsController {
  constructor(private readonly svc: ScheduledReportsService, private readonly audit: AuditService) {}

  @Get()
  list() { return db.select().from(schema.scheduledReports); }

  @Post()
  async create(@CurrentUser() user: AuthedUser, @Body() body: unknown) {
    const dto = ScheduleSchema.parse(body);
    const [row] = await db.insert(schema.scheduledReports).values({ ...dto, createdById: user.id }).returning();
    await this.audit.log({ actorId: user.id, actorEmail: user.email, action: 'SCHEDULED_REPORT_CREATED', entityType: 'scheduled_report', entityId: row.id, data: dto });
    return row;
  }

  @Post(':id/run')
  run(@Param('id') id: string) { return this.svc.runOne(id); }

  @Post(':id/toggle')
  async toggle(@Param('id') id: string) {
    const [s] = await db.select().from(schema.scheduledReports).where(eq(schema.scheduledReports.id, id));
    if (!s) throw new NotFoundException('Schedule not found');
    await db.update(schema.scheduledReports).set({ active: !s.active }).where(eq(schema.scheduledReports.id, id));
    return { active: !s.active };
  }
}

// ---------------- DSH-06: saved custom reports (curated view: transactions) ----------------
const TX_COLUMNS = {
  ref: 'Ref', title: 'Title', typeCode: 'Type', status: 'Status',
  amountKobo: 'Amount (kobo)', donorCode: 'Donor', submittedAt: 'Submitted', createdAt: 'Created',
} as const;
type TxColumn = keyof typeof TX_COLUMNS;

const SavedReportSchema = z.object({
  name: z.string().min(3),
  shared: z.boolean().default(false),
  config: z.object({
    entity: z.literal('transactions'),
    columns: z.array(z.enum(Object.keys(TX_COLUMNS) as [TxColumn, ...TxColumn[]])).min(1),
    filters: z.object({
      status: z.string().optional(),
      typeCode: z.string().optional(),
      donorCode: z.string().optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }).default({}),
  }),
});

@Controller('v1/reports/saved')
@UseGuards(AuthGuard)
export class SavedReportsController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(@CurrentUser() user: AuthedUser) {
    const rows = await db.select().from(schema.savedReports);
    return rows.filter((r) => r.shared || r.ownerId === user.id);
  }

  @Post()
  async create(@CurrentUser() user: AuthedUser, @Body() body: unknown) {
    const dto = SavedReportSchema.parse(body);
    const [row] = await db.insert(schema.savedReports).values({
      name: dto.name, shared: dto.shared, ownerId: user.id, config: dto.config,
    }).returning();
    await this.audit.log({ actorId: user.id, actorEmail: user.email, action: 'SAVED_REPORT_CREATED', entityType: 'saved_report', entityId: row.id });
    return row;
  }

  /** Run a saved definition — whitelisted columns/filters only; permission model intact by construction. */
  @Get(':id/run')
  async run(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Query('format') format?: string) {
    const [r] = await db.select().from(schema.savedReports).where(eq(schema.savedReports.id, id));
    if (!r || (!r.shared && r.ownerId !== user.id)) throw new NotFoundException('Report not found');
    const cfg = r.config as z.infer<typeof SavedReportSchema>['config'];
    const conds = [] as any[];
    if (cfg.filters.status) conds.push(eq(schema.transactions.status, cfg.filters.status as any));
    if (cfg.filters.typeCode) conds.push(eq(schema.transactions.typeCode, cfg.filters.typeCode));
    if (cfg.filters.donorCode) conds.push(eq(schema.transactions.donorCode, cfg.filters.donorCode));
    if (cfg.filters.from) conds.push(gte(schema.transactions.createdAt, new Date(cfg.filters.from)));
    if (cfg.filters.to) conds.push(lte(schema.transactions.createdAt, new Date(cfg.filters.to)));
    const rows = await db.select().from(schema.transactions)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(schema.transactions.createdAt)).limit(2000);
    const data = rows.map((t) => cfg.columns.map((c) => {
      const v = (t as any)[c];
      return v instanceof Date ? v.toISOString() : v === null || v === undefined ? '' : String(v);
    }));
    await this.audit.log({ actorId: user.id, actorEmail: user.email, action: 'SAVED_REPORT_RUN', entityType: 'saved_report', entityId: id, data: { rows: data.length } });
    if (format === 'csv') {
      const esc = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      return { csv: [cfg.columns.map((c) => TX_COLUMNS[c]).join(','), ...data.map((row) => row.map(esc).join(','))].join('\n') };
    }
    return { name: r.name, columns: cfg.columns.map((c) => TX_COLUMNS[c]), rows: data };
  }
}

// ---------------- module wiring ----------------
export const controllers = [AuditorController, ScheduledReportsController, SavedReportsController];
export const providers = [ScheduledReportsService];

export async function seedDefaults(): Promise<void> {
  // EXTERNAL_AUDITOR role row (enum value exists; role table row needed for grants)
  const existing = await db.query.roles.findFirst({ where: eq(schema.roles.code, 'EXTERNAL_AUDITOR') });
  if (!existing) await db.insert(schema.roles).values({ code: 'EXTERNAL_AUDITOR', name: 'External Auditor' }).onConflictDoNothing();
  // PROC-01: same pattern — the enum value exists, but grants need a roles row to point at.
  const proc = await db.query.roles.findFirst({ where: eq(schema.roles.code, 'PROCUREMENT_OFFICER') });
  if (!proc) await db.insert(schema.roles).values({ code: 'PROCUREMENT_OFFICER', name: 'Procurement Officer' }).onConflictDoNothing();
}

let interval: NodeJS.Timeout | null = null;
export function register(): void {
  if (interval) return;
  const svc = new ScheduledReportsService(new AuditService());
  interval = setInterval(() => { svc.runDue().catch(() => undefined); }, 5 * 60_000);
  interval.unref();
}
