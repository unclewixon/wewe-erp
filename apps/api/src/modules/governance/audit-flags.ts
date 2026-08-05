/**
 * AUD-02: audit flags ("audit queries") on any entity, and the findings register.
 * Every step is audit-logged; transaction-linked flags notify the transaction's initiator.
 */
import {
  BadRequestException, Body, Controller, Get, Injectable, NotFoundException,
  Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, like, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';
import { WorkflowService } from '../../workflow/workflow.service';

const RaiseSchema = z.object({
  entityType: z.string().min(2).max(60),
  entityId: z.string().min(1).max(120),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  question: z.string().min(5).max(4000),
});
const RespondSchema = z.object({ response: z.string().min(3).max(4000) });
const CheckSchema = z.object({ entityType: z.string().min(1), entityId: z.string().min(1) });

const FINDING_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
type FindingStatus = (typeof FINDING_STATUSES)[number];
/** Allowed findings-register status transitions. CLOSED is terminal. */
export const FINDING_TRANSITIONS: Record<FindingStatus, FindingStatus[]> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'CLOSED', 'OPEN'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: [],
};

const FindingCreateSchema = z.object({
  title: z.string().min(3).max(300),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  ownerId: z.string().optional().nullable(),
  dueDate: z.coerce.date().optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});
const FindingUpdateSchema = FindingCreateSchema.partial();
const FindingStatusSchema = z.object({ status: z.enum(FINDING_STATUSES) });

@Injectable()
export class AuditFlagsService {
  constructor(private readonly audit: AuditService) {}

  /** Resolve a transaction by id OR ref. Null when the string matches neither. */
  async findTransaction(idOrRef: string) {
    return db.query.transactions.findFirst({
      where: or(eq(schema.transactions.id, idOrRef), eq(schema.transactions.ref, idOrRef)),
    });
  }

  /** Notify the flagged entity's initiator when the entity is a transaction. */
  async notifyTxInitiator(entityType: string, entityId: string, title: string, body: string, flagId: string) {
    if (entityType !== 'transaction') return;
    const tx = await this.findTransaction(entityId);
    if (!tx) return;
    await db.insert(schema.notifications).values({
      userId: tx.initiatorId, kind: 'FLAG', title, body,
      entityType: 'audit_flag', entityId: flagId,
    });
  }
}

@Controller('v1/audit-flags')
@UseGuards(AuthGuard)
export class AuditFlagsController {
  constructor(private readonly svc: AuditFlagsService, private readonly audit: AuditService) {}

  /** AUD-02: raise a flag on any entity — Internal Audit only. */
  @Post()
  @RequireRoles('INTERNAL_AUDIT')
  async raise(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    const dto = RaiseSchema.parse(body);
    // Transactions may be referenced by id or ref; store the ref so downstream
    // checks and the audit trail use the human-readable identifier consistently.
    let entityId = dto.entityId;
    if (dto.entityType === 'transaction') {
      const tx = await this.svc.findTransaction(dto.entityId);
      if (!tx) throw new NotFoundException(`Transaction ${dto.entityId} not found (by id or ref)`);
      entityId = tx.ref;
    }
    const [row] = await db.insert(schema.auditFlags).values({
      entityType: dto.entityType, entityId, raisedById: user.id,
      severity: dto.severity ?? 'MEDIUM', question: dto.question,
    }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'AUDIT_FLAG_RAISED',
      entityType: 'audit_flag', entityId: row.id,
      data: { on: { entityType: dto.entityType, entityId }, severity: row.severity, question: dto.question },
      ip: req.ip,
    });
    await this.svc.notifyTxInitiator(dto.entityType, entityId,
      `Audit flag raised on ${entityId}`,
      `Internal Audit has a question on ${entityId}: ${dto.question}`, row.id);
    return row;
  }

  @Get()
  async list(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('status') status?: string,
  ) {
    const where = [];
    if (entityType) where.push(eq(schema.auditFlags.entityType, entityType));
    if (entityId) where.push(eq(schema.auditFlags.entityId, entityId));
    if (status && ['OPEN', 'RESPONDED', 'CLOSED'].includes(status)) where.push(eq(schema.auditFlags.status, status));
    return db.query.auditFlags.findMany({
      where: where.length ? and(...where) : undefined,
      orderBy: [desc(schema.auditFlags.createdAt)],
      limit: 500,
    });
  }

  /** Open-flag check for other modules/UI: is this entity currently under an audit query? */
  @Get('check')
  async check(@Query() query: Record<string, string>) {
    const dto = CheckSchema.parse(query);
    // Accept a transaction id OR ref, since flags on transactions are stored by ref.
    const ids = [dto.entityId];
    if (dto.entityType === 'transaction') {
      const tx = await this.svc.findTransaction(dto.entityId);
      if (tx) { ids.push(tx.id); ids.push(tx.ref); }
    }
    const flags = await db.query.auditFlags.findMany({
      where: and(
        eq(schema.auditFlags.entityType, dto.entityType),
        inArray(schema.auditFlags.entityId, [...new Set(ids)]),
        inArray(schema.auditFlags.status, ['OPEN', 'RESPONDED']),
      ),
      orderBy: [desc(schema.auditFlags.createdAt)],
    });
    return {
      open: flags.length > 0,
      openCount: flags.length,
      flags: flags.map((f) => ({ id: f.id, severity: f.severity, status: f.status, question: f.question, createdAt: f.createdAt })),
    };
  }

  /** AUD-02: any authed user answers a flag; a response text is mandatory. */
  @Post(':id/respond')
  async respond(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = RespondSchema.parse(body);
    const flag = await db.query.auditFlags.findFirst({ where: eq(schema.auditFlags.id, id) });
    if (!flag) throw new NotFoundException('Audit flag not found');
    if (flag.status === 'CLOSED') throw new BadRequestException('This flag is closed');
    const [row] = await db.update(schema.auditFlags).set({
      response: dto.response, respondedById: user.id, status: 'RESPONDED',
    }).where(eq(schema.auditFlags.id, id)).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'AUDIT_FLAG_RESPONDED',
      entityType: 'audit_flag', entityId: id,
      data: { on: { entityType: flag.entityType, entityId: flag.entityId }, response: dto.response }, ip: req.ip,
    });
    // Tell the raiser their question was answered…
    await db.insert(schema.notifications).values({
      userId: flag.raisedById, kind: 'FLAG',
      title: `Response to your audit flag on ${flag.entityId}`,
      body: dto.response.slice(0, 500),
      entityType: 'audit_flag', entityId: id,
    });
    // …and keep the transaction's initiator in the loop.
    if (flag.raisedById !== user.id) {
      await this.svc.notifyTxInitiator(flag.entityType, flag.entityId,
        `Audit flag on ${flag.entityId} was answered`,
        `A response was recorded on the audit query for ${flag.entityId}.`, id);
    }
    return row;
  }

  /** AUD-02: close a flag — Internal Audit only. */
  @Post(':id/close')
  @RequireRoles('INTERNAL_AUDIT')
  async close(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    const flag = await db.query.auditFlags.findFirst({ where: eq(schema.auditFlags.id, id) });
    if (!flag) throw new NotFoundException('Audit flag not found');
    if (flag.status === 'CLOSED') throw new BadRequestException('Flag is already closed');
    const [row] = await db.update(schema.auditFlags).set({
      status: 'CLOSED', closedAt: new Date(),
    }).where(eq(schema.auditFlags.id, id)).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'AUDIT_FLAG_CLOSED',
      entityType: 'audit_flag', entityId: id,
      data: { on: { entityType: flag.entityType, entityId: flag.entityId } }, ip: req.ip,
    });
    await this.svc.notifyTxInitiator(flag.entityType, flag.entityId,
      `Audit flag on ${flag.entityId} closed`,
      'Internal Audit has closed its query on this transaction.', id);
    return row;
  }
}

@Controller('v1/findings')
@UseGuards(AuthGuard)
export class FindingsController {
  constructor(private readonly audit: AuditService, private readonly workflow: WorkflowService) {}

  /** AUD-02: register a finding, ref F-YYYY-NNNN via WorkflowService.nextRef('F'). */
  @Post()
  @RequireRoles('INTERNAL_AUDIT')
  async create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    const dto = FindingCreateSchema.parse(body);
    if (dto.ownerId) {
      const owner = await db.query.users.findFirst({ where: eq(schema.users.id, dto.ownerId) });
      if (!owner || !owner.active) throw new BadRequestException('Finding owner not found or inactive');
    }
    // nextRef numbers off the transactions table; findings live in their own
    // table, so bump the sequence until the ref is free among findings too.
    let ref = await this.workflow.nextRef('F');
    for (;;) {
      const clash = await db.query.findings.findFirst({ where: eq(schema.findings.ref, ref) });
      if (!clash) break;
      const m = /^(F-\d{4}-)(\d+)$/.exec(ref);
      if (!m) throw new BadRequestException('Could not allocate a finding reference');
      ref = m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0');
    }
    const [row] = await db.insert(schema.findings).values({
      ref, title: dto.title, severity: dto.severity ?? 'MEDIUM',
      ownerId: dto.ownerId ?? null, dueDate: dto.dueDate ?? null, notes: dto.notes ?? null,
    }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'FINDING_CREATED',
      entityType: 'finding', entityId: ref,
      data: { title: dto.title, severity: row.severity, ownerId: dto.ownerId ?? null, dueDate: dto.dueDate?.toISOString() ?? null },
      ip: req.ip,
    });
    if (dto.ownerId) {
      await db.insert(schema.notifications).values({
        userId: dto.ownerId, kind: 'ACTION_REQUIRED',
        title: `Audit finding ${ref} assigned to you`,
        body: dto.title, entityType: 'finding', entityId: row.id,
      });
    }
    return row;
  }

  @Get()
  async list(@Query('status') status?: string, @Query('severity') severity?: string) {
    const where = [];
    if (status && (FINDING_STATUSES as readonly string[]).includes(status)) where.push(eq(schema.findings.status, status));
    if (severity && ['LOW', 'MEDIUM', 'HIGH'].includes(severity)) where.push(eq(schema.findings.severity, severity));
    const rows = await db.query.findings.findMany({
      where: where.length ? and(...where) : undefined,
      orderBy: [desc(schema.findings.createdAt)],
      limit: 500,
    });
    return this.withOwners(rows);
  }

  /** Findings past their due date and not yet resolved/closed. */
  @Get('overdue')
  async overdue() {
    const rows = await db.query.findings.findMany({
      where: and(
        inArray(schema.findings.status, ['OPEN', 'IN_PROGRESS']),
        lt(schema.findings.dueDate, new Date()),
      ),
      orderBy: [asc(schema.findings.dueDate)],
    });
    return this.withOwners(rows);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const row = await db.query.findings.findFirst({
      where: or(eq(schema.findings.id, id), eq(schema.findings.ref, id)),
    });
    if (!row) throw new NotFoundException('Finding not found');
    return (await this.withOwners([row]))[0];
  }

  @Post(':id')
  @RequireRoles('INTERNAL_AUDIT')
  async update(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = FindingUpdateSchema.parse(body);
    const existing = await db.query.findings.findFirst({ where: eq(schema.findings.id, id) });
    if (!existing) throw new NotFoundException('Finding not found');
    if (existing.status === 'CLOSED') throw new BadRequestException('Closed findings cannot be edited');
    const patch: Partial<typeof schema.findings.$inferInsert> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.severity !== undefined) patch.severity = dto.severity;
    if (dto.ownerId !== undefined) patch.ownerId = dto.ownerId;
    if (dto.dueDate !== undefined) patch.dueDate = dto.dueDate;
    if (dto.notes !== undefined) patch.notes = dto.notes;
    if (Object.keys(patch).length === 0) throw new BadRequestException('Nothing to update');
    const [row] = await db.update(schema.findings).set(patch).where(eq(schema.findings.id, id)).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'FINDING_UPDATED',
      entityType: 'finding', entityId: existing.ref, data: { fields: Object.keys(patch) }, ip: req.ip,
    });
    return row;
  }

  /** Guarded status transitions (CLOSED is terminal; closing is Internal Audit's call). */
  @Post(':id/status')
  @RequireRoles('INTERNAL_AUDIT')
  async setStatus(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = FindingStatusSchema.parse(body);
    const existing = await db.query.findings.findFirst({ where: eq(schema.findings.id, id) });
    if (!existing) throw new NotFoundException('Finding not found');
    const fromStatus = existing.status as FindingStatus;
    if (!FINDING_TRANSITIONS[fromStatus]?.includes(dto.status)) {
      throw new BadRequestException(`Cannot move a ${fromStatus} finding to ${dto.status}`);
    }
    const [row] = await db.update(schema.findings).set({ status: dto.status }).where(eq(schema.findings.id, id)).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'FINDING_STATUS_CHANGED',
      entityType: 'finding', entityId: existing.ref, data: { from: fromStatus, to: dto.status }, ip: req.ip,
    });
    return row;
  }

  private async withOwners(rows: (typeof schema.findings.$inferSelect)[]) {
    const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter((x): x is string => !!x))];
    const owners = ownerIds.length
      ? await db.query.users.findMany({ where: inArray(schema.users.id, ownerIds), columns: { id: true, name: true, email: true } })
      : [];
    const byId = new Map(owners.map((o) => [o.id, o]));
    const now = Date.now();
    return rows.map((r) => ({
      ...r,
      owner: r.ownerId ? byId.get(r.ownerId) ?? null : null,
      overdue: !!r.dueDate && r.dueDate.getTime() < now && (r.status === 'OPEN' || r.status === 'IN_PROGRESS'),
    }));
  }
}
