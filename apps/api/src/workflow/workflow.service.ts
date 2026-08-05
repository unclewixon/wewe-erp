import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client';
import { AuditService } from '../audit/audit.service';
import type { AuthedUser } from '../auth/auth';
import { and, eq as eq2, gt, lte } from 'drizzle-orm';
import {
  canAct, canResubmit, canSubmit, canWithdraw, applyVerb, currentStageRole, resolveChain,
  type RoleGrant, type StageDef, type TxCtx, type Verb,
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
    // WFE-03: a submitted transaction carries the chain resolved for its amount;
    // fall back to the type's full stage list for drafts.
    const payload = (tx.payload ?? {}) as { chain?: StageDef[] };
    const chain = payload.chain ?? (tx.type.stages as StageDef[]);
    const priorApproverIds = tx.stageEvents.filter((e) => e.action === 'APPROVED').map((e) => e.actorId);
    return {
      id: tx.id, ref: tx.ref, initiatorId: tx.initiatorId, departmentId: tx.departmentId,
      status: tx.status, currentStage: tx.currentStage, chain, priorApproverIds,
    };
  }

  private actorCtx(user: AuthedUser) {
    return { id: user.id, roles: user.roles as RoleGrant[] };
  }

  /**
   * WFE-05: the actor's own grants plus grants delegated to them by an active,
   * in-window delegation. Delegated grants carry onBehalfOf; delegations do not
   * chain (only the delegator's OWN grants transfer, never their delegated ones).
   */
  async effectiveActor(user: AuthedUser): Promise<{ id: string; roles: RoleGrant[] }> {
    const now = new Date();
    const dels = await db.select().from(schema.delegations).where(and(
      eq2(schema.delegations.delegateId, user.id),
      eq2(schema.delegations.active, true),
      lte(schema.delegations.startsAt, now),
      gt(schema.delegations.endsAt, now),
    ));
    const roles: RoleGrant[] = [...(user.roles as RoleGrant[])];
    for (const d of dels) {
      const delegator = await db.query.users.findFirst({
        where: eq(schema.users.id, d.delegatorId),
        with: { roles: { with: { role: true } } },
      });
      if (!delegator || !delegator.active) continue;
      for (const ur of delegator.roles) {
        roles.push({ code: ur.role.code, departmentId: ur.departmentId, onBehalfOf: { userId: delegator.id, name: delegator.name } });
      }
    }
    return { id: user.id, roles };
  }

  async submit(txId: string, user: AuthedUser, ip?: string) {
    const ctx = await this.loadCtx(txId);
    const d = canSubmit(this.actorCtx(user), ctx);
    if (!d.ok) throw new ForbiddenException(d.reason);
    // WFE-03: resolve and freeze the chain for this amount at submission
    const tx = await db.query.transactions.findFirst({ where: eq(schema.transactions.id, txId), with: { type: true } });
    const { chain, skipped } = resolveChain(tx!.type.stages as StageDef[], tx!.amountKobo);
    const payload = { ...((tx!.payload as object) ?? {}), chain, autoPassed: skipped };
    await db.update(schema.transactions)
      .set({ status: 'PENDING', currentStage: 0, submittedAt: new Date(), updatedAt: new Date(), payload })
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
    const d = canAct(await this.effectiveActor(user), ctx);
    if (!d.ok) throw new ForbiddenException(d.reason);
    if ((verb === 'reject' || verb === 'return') && !comment?.trim())
      throw new BadRequestException(`A ${verb === 'reject' ? 'rejection reason' : 'clarification note'} is required`);

    const role = currentStageRole(ctx)!;
    const next = applyVerb(ctx, verb);
    const via = (d as { via?: RoleGrant }).via;
    const onBehalfOf = via?.onBehalfOf ?? null;
    await db.update(schema.transactions)
      .set({ status: next.status, currentStage: next.currentStage, updatedAt: new Date() })
      .where(eq(schema.transactions.id, txId));
    const actionMap = { approve: 'APPROVED', reject: 'REJECTED', return: 'RETURNED' } as const;
    const noted = onBehalfOf
      ? `[on behalf of ${onBehalfOf.name}] ${comment?.trim() ?? ''}`.trim()
      : comment?.trim() || null;
    await db.insert(schema.stageEvents).values({
      transactionId: txId, stageIndex: ctx.currentStage, role, action: actionMap[verb],
      actorId: user.id, comment: noted,
    });
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: `TX_${actionMap[verb]}`,
      entityType: 'transaction', entityId: ctx.ref,
      data: { stage: ctx.currentStage, role, comment: comment ?? null, resulting: next.status, onBehalfOf }, ip,
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
