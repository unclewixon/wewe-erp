import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { AuditService } from '../audit/audit.service';
import type { AuthedUser } from '../auth/auth';
import {
  canAct, canResubmit, canSubmit, canWithdraw, applyVerb, currentStageRole,
  type StageDef, type TxCtx, type Verb,
} from './engine.logic';

/** DB-wired workflow engine. All state changes flow through here and are audit-logged. */
@Injectable()
export class WorkflowService {
  constructor(private readonly audit: AuditService) {}

  async loadCtx(txId: string): Promise<TxCtx & { ref: string }> {
    const tx = await db.query.transactions.findFirst({
      where: eq(schema.transactions.id, txId),
      with: { type: true, stageEvents: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');
    const chain = tx.type.stages as StageDef[];
    const priorApproverIds = tx.stageEvents.filter((e) => e.action === 'APPROVED').map((e) => e.actorId);
    return {
      id: tx.id, ref: tx.ref, initiatorId: tx.initiatorId, departmentId: tx.departmentId,
      status: tx.status, currentStage: tx.currentStage, chain, priorApproverIds,
    };
  }

  private actorCtx(user: AuthedUser) {
    return { id: user.id, roles: user.roles };
  }

  async submit(txId: string, user: AuthedUser, ip?: string) {
    const ctx = await this.loadCtx(txId);
    const d = canSubmit(this.actorCtx(user), ctx);
    if (!d.ok) throw new ForbiddenException(d.reason);
    await db.update(schema.transactions)
      .set({ status: 'PENDING', currentStage: 0, submittedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.transactions.id, txId));
    await db.insert(schema.stageEvents).values({
      transactionId: txId, stageIndex: 0, role: null, action: 'SUBMITTED', actorId: user.id,
    });
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'TX_SUBMITTED',
      entityType: 'transaction', entityId: ctx.ref, ip,
    });
  }

  async act(txId: string, user: AuthedUser, verb: Verb, comment?: string, ip?: string) {
    const ctx = await this.loadCtx(txId);
    const d = canAct(this.actorCtx(user), ctx);
    if (!d.ok) throw new ForbiddenException(d.reason);
    if ((verb === 'reject' || verb === 'return') && !comment?.trim())
      throw new BadRequestException(`A ${verb === 'reject' ? 'rejection reason' : 'clarification note'} is required`);

    const role = currentStageRole(ctx)!;
    const next = applyVerb(ctx, verb);
    await db.update(schema.transactions)
      .set({ status: next.status, currentStage: next.currentStage, updatedAt: new Date() })
      .where(eq(schema.transactions.id, txId));
    const actionMap = { approve: 'APPROVED', reject: 'REJECTED', return: 'RETURNED' } as const;
    await db.insert(schema.stageEvents).values({
      transactionId: txId, stageIndex: ctx.currentStage, role, action: actionMap[verb],
      actorId: user.id, comment: comment?.trim() || null,
    });
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: `TX_${actionMap[verb]}`,
      entityType: 'transaction', entityId: ctx.ref,
      data: { stage: ctx.currentStage, role, comment: comment ?? null, resulting: next.status }, ip,
    });
    return next;
  }

  async resubmit(txId: string, user: AuthedUser, ip?: string) {
    const ctx = await this.loadCtx(txId);
    const d = canResubmit(this.actorCtx(user), ctx);
    if (!d.ok) throw new ForbiddenException(d.reason);
    // WFE-04: resubmission restarts the chain — every approver sees the edited version
    await db.update(schema.transactions)
      .set({ status: 'PENDING', currentStage: 0, updatedAt: new Date() })
      .where(eq(schema.transactions.id, txId));
    await db.insert(schema.stageEvents).values({
      transactionId: txId, stageIndex: 0, role: null, action: 'RESUBMITTED', actorId: user.id,
    });
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'TX_RESUBMITTED',
      entityType: 'transaction', entityId: ctx.ref, ip,
    });
  }

  async withdraw(txId: string, user: AuthedUser, ip?: string) {
    const ctx = await this.loadCtx(txId);
    const d = canWithdraw(this.actorCtx(user), ctx);
    if (!d.ok) throw new ForbiddenException(d.reason);
    await db.update(schema.transactions)
      .set({ status: 'WITHDRAWN', updatedAt: new Date() })
      .where(eq(schema.transactions.id, txId));
    await db.insert(schema.stageEvents).values({
      transactionId: txId, stageIndex: ctx.currentStage, role: null, action: 'WITHDRAWN', actorId: user.id,
    });
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'TX_WITHDRAWN',
      entityType: 'transaction', entityId: ctx.ref, ip,
    });
  }
}
