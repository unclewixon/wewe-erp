import {
  BadRequestException, Body, Controller, Get, Injectable, NotFoundException,
  Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';
import { WorkflowService, type ApprovalHook } from '../../workflow/workflow.service';
import { applyRetirement, retirementFigures, sumLineAmounts } from './money.logic';
import { queueJournalAndProcess } from './qb';

const RetirementLineSchema = z.object({
  description: z.string().min(1).max(300),
  amountKobo: z.string().regex(/^[1-9]\d*$/, 'amountKobo must be a positive integer kobo string'),
  receiptRef: z.string().max(120).optional(),
});
const CreateRetirementSchema = z.object({
  /** Omit for a freestanding reimbursement claim (RET-05). */
  advanceId: z.string().optional().nullable(),
  title: z.string().min(3).max(200).optional(),
  lines: z.array(RetirementLineSchema).min(1).max(100),
  submit: z.boolean().optional(),
});
const SettleRefundSchema = z.object({
  refundSettledRef: z.string().min(1).max(120),
});

interface RetirementPayload {
  advanceId: string | null;
  lines: { description: string; amountKobo: string; receiptRef?: string }[];
  retirementApplied?: boolean;
}

@Injectable()
export class RetirementsService {
  constructor(private readonly audit: AuditService, private readonly workflow: WorkflowService) {}

  /** RET-01/02/05: retire an advance (partial allowed) or claim a freestanding reimbursement. */
  async create(user: AuthedUser, dto: z.infer<typeof CreateRetirementSchema>, ip?: string) {
    const lines = dto.lines.map((l) => ({ ...l, amountKobo: BigInt(l.amountKobo) }));
    const totalKobo = sumLineAmounts(lines);

    let advance = null;
    let advanceTx = null;
    if (dto.advanceId) {
      advance = await db.query.advances.findFirst({ where: eq(schema.advances.id, dto.advanceId) });
      if (!advance) throw new BadRequestException('Advance not found');
      if (advance.staffId !== user.id)
        throw new BadRequestException('You can only retire your own advance');
      if (advance.status !== 'DISBURSED' && advance.status !== 'RETIRING')
        throw new BadRequestException(`Advance is ${advance.status}; only a disbursed advance can be retired`);
      advanceTx = await db.query.transactions.findFirst({ where: eq(schema.transactions.id, advance.txId) });
    }

    const { varianceKobo, refundDueKobo } = retirementFigures(advance?.balanceKobo ?? 0n, totalKobo);
    const payload: RetirementPayload = {
      advanceId: dto.advanceId ?? null,
      lines: dto.lines,
    };
    const title = dto.title
      ?? (advanceTx ? `Retirement of ${advanceTx.ref}` : 'Expense reimbursement claim');
    const tx = await this.workflow.createTransaction(user, {
      typeCode: 'RETIREMENT', title, amountKobo: totalKobo,
      donorCode: advanceTx?.donorCode ?? null, payload, submit: dto.submit, ip,
    });
    const [row] = await db.insert(schema.retirements).values({
      txId: tx.id, advanceId: dto.advanceId ?? null,
      totalKobo, varianceKobo, refundDueKobo,
    }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'RETIREMENT_CREATED',
      entityType: 'retirement', entityId: row.id,
      data: {
        txRef: tx.ref, advanceId: dto.advanceId ?? null, lines: dto.lines.length,
        totalKobo: totalKobo.toString(), varianceKobo: varianceKobo.toString(),
        refundDueKobo: refundDueKobo.toString(),
      }, ip,
    });
    return this.get(row.id);
  }

  /** RET-04: Finance records settlement of an under-spend refund. */
  async settleRefund(user: AuthedUser, retirementId: string, dto: z.infer<typeof SettleRefundSchema>, ip?: string) {
    const row = await db.query.retirements.findFirst({ where: eq(schema.retirements.id, retirementId) });
    if (!row) throw new NotFoundException('Retirement not found');
    if (row.refundDueKobo <= 0n) throw new BadRequestException('No refund is due on this retirement');
    if (row.refundSettledAt) throw new BadRequestException('Refund already settled');
    const tx = await db.query.transactions.findFirst({ where: eq(schema.transactions.id, row.txId) });
    if (!tx || tx.status !== 'APPROVED')
      throw new BadRequestException('The retirement must be approved before its refund is settled');
    await db.update(schema.retirements)
      .set({ refundSettledAt: new Date(), refundSettledRef: dto.refundSettledRef })
      .where(eq(schema.retirements.id, retirementId));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'RETIREMENT_REFUND_SETTLED',
      entityType: 'retirement', entityId: retirementId,
      data: { txRef: tx.ref, refundDueKobo: row.refundDueKobo.toString(), refundSettledRef: dto.refundSettledRef }, ip,
    });
    return this.get(retirementId);
  }

  async list(user: AuthedUser, scope: 'mine' | 'all') {
    const central = user.roles.some((r) => ['FINANCE', 'SYSTEM_ADMIN', 'INTERNAL_AUDIT'].includes(r.code));
    const rows = await db.select({
      ret: schema.retirements, tx: schema.transactions, staffName: schema.users.name,
    }).from(schema.retirements)
      .innerJoin(schema.transactions, eq(schema.retirements.txId, schema.transactions.id))
      .innerJoin(schema.users, eq(schema.transactions.initiatorId, schema.users.id))
      .orderBy(desc(schema.transactions.updatedAt)).limit(200);
    return rows
      .filter((r) => (scope === 'mine' || !central ? r.tx.initiatorId === user.id : true))
      .map((r) => ({
        id: r.ret.id, txId: r.tx.id, ref: r.tx.ref, title: r.tx.title,
        staff: { id: r.tx.initiatorId, name: r.staffName },
        advanceId: r.ret.advanceId,
        totalKobo: r.ret.totalKobo.toString(), varianceKobo: r.ret.varianceKobo.toString(),
        refundDueKobo: r.ret.refundDueKobo.toString(),
        refundSettledAt: r.ret.refundSettledAt,
        txStatus: r.tx.status, submittedAt: r.tx.submittedAt, updatedAt: r.tx.updatedAt,
      }));
  }

  async get(retirementId: string) {
    const row = await db.query.retirements.findFirst({ where: eq(schema.retirements.id, retirementId) });
    if (!row) throw new NotFoundException('Retirement not found');
    const tx = await db.query.transactions.findFirst({
      where: eq(schema.transactions.id, row.txId),
      with: { initiator: { columns: { id: true, name: true } }, department: true },
    });
    if (!tx) throw new NotFoundException('Retirement transaction not found');
    const payload = (tx.payload ?? {}) as RetirementPayload;
    const advance = row.advanceId
      ? await db.query.advances.findFirst({ where: eq(schema.advances.id, row.advanceId) })
      : undefined;
    return {
      id: row.id, txId: tx.id, ref: tx.ref, title: tx.title,
      staff: tx.initiator, department: tx.department.name,
      txStatus: tx.status, currentStage: tx.currentStage,
      advance: advance ? {
        id: advance.id, purpose: advance.purpose, status: advance.status,
        balanceKobo: advance.balanceKobo.toString(),
      } : null,
      totalKobo: row.totalKobo.toString(),
      varianceKobo: row.varianceKobo.toString(),
      refundDueKobo: row.refundDueKobo.toString(),
      refundSettledAt: row.refundSettledAt, refundSettledRef: row.refundSettledRef,
      applied: payload.retirementApplied === true,
      lines: (payload.lines ?? []).map((l) => ({
        description: l.description, amountKobo: l.amountKobo, receiptRef: l.receiptRef ?? null,
      })),
      submittedAt: tx.submittedAt, createdAt: tx.createdAt,
    };
  }
}

@Controller('v1/retirements')
@UseGuards(AuthGuard)
export class RetirementsController {
  constructor(private readonly svc: RetirementsService) {}

  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    const dto = CreateRetirementSchema.parse(body);
    return this.svc.create(user, dto, req.ip);
  }

  @Get()
  list(@CurrentUser() user: AuthedUser, @Query('scope') scope?: string) {
    return this.svc.list(user, scope === 'all' ? 'all' : 'mine');
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post(':id/settle-refund')
  @RequireRoles('FINANCE')
  settleRefund(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = SettleRefundSchema.parse(body);
    return this.svc.settleRefund(user, id, dto, req.ip);
  }
}

const audit = new AuditService();

/**
 * RET-03 final-approval hook: reduce the advance balance by the approved
 * retirement (partial allowed); the advance closes at zero. Recomputes the
 * variance/refund against the balance at approval time (an earlier partial
 * retirement may have changed it since creation). Queues a QuickBooks JOURNAL.
 * Idempotent via the payload's retirementApplied marker.
 */
export const applyRetirementHook: ApprovalHook = async (tx) => {
  const payload = (tx.payload ?? {}) as RetirementPayload & Record<string, unknown>;
  if (payload.retirementApplied) return; // idempotency guard
  const row = await db.query.retirements.findFirst({ where: eq(schema.retirements.txId, tx.id) });
  if (!row) throw new Error(`Retirement row missing for ${tx.ref}`);

  let advanceData: Record<string, unknown> = {};
  if (row.advanceId) {
    const advance = await db.query.advances.findFirst({ where: eq(schema.advances.id, row.advanceId) });
    if (!advance) throw new Error(`Advance ${row.advanceId} missing for retirement ${tx.ref}`);
    const { varianceKobo, refundDueKobo } = retirementFigures(advance.balanceKobo, row.totalKobo);
    const { newBalanceKobo, closed } = applyRetirement(advance.balanceKobo, row.totalKobo);
    await db.update(schema.retirements)
      .set({ varianceKobo, refundDueKobo })
      .where(eq(schema.retirements.id, row.id));
    await db.update(schema.advances)
      .set({ balanceKobo: newBalanceKobo, status: closed ? 'CLOSED' : 'RETIRING' })
      .where(eq(schema.advances.id, advance.id));
    advanceData = {
      advanceId: advance.id, previousBalanceKobo: advance.balanceKobo.toString(),
      newBalanceKobo: newBalanceKobo.toString(), advanceStatus: closed ? 'CLOSED' : 'RETIRING',
      varianceKobo: varianceKobo.toString(), refundDueKobo: refundDueKobo.toString(),
    };
  }

  await db.update(schema.transactions)
    .set({ payload: { ...payload, retirementApplied: true }, updatedAt: new Date() })
    .where(eq(schema.transactions.id, tx.id));
  await audit.log({
    action: 'RETIREMENT_APPLIED', entityType: 'retirement', entityId: row.id,
    data: { txRef: tx.ref, totalKobo: row.totalKobo.toString(), ...advanceData },
  });
  await queueJournalAndProcess(tx.id, {
    entry: row.advanceId ? 'ADVANCE_RETIREMENT' : 'REIMBURSEMENT',
    txRef: tx.ref, retirementId: row.id, advanceId: row.advanceId,
    totalKobo: row.totalKobo.toString(), donorCode: tx.donorCode,
    lines: payload.lines ?? [],
  });
};
