/**
 * Pure workflow-engine logic (WFE-01/02/04/09 core).
 * No I/O here — everything is unit-testable. The DB-wired WorkflowService calls these.
 */
import type { RoleCode, TxStatus } from '../db/schema';

export type StageDef = { role: RoleCode };
export type Verb = 'approve' | 'reject' | 'return';

export interface ActorCtx {
  id: string;
  roles: { code: RoleCode; departmentId: string | null }[]; // departmentId null = org-wide scope
}

export interface TxCtx {
  id: string;
  initiatorId: string;
  departmentId: string;
  status: TxStatus;
  currentStage: number; // index into chain while PENDING
  chain: StageDef[];
  priorApproverIds: string[]; // users who already APPROVED a stage on this transaction
}

export function currentStageRole(tx: TxCtx): RoleCode | null {
  if (tx.status !== 'PENDING') return null;
  return tx.chain[tx.currentStage]?.role ?? null;
}

/** Does the actor hold `role` for the transaction's department? Org-wide grants always qualify. */
export function holdsRoleFor(actor: ActorCtx, role: RoleCode, departmentId: string): boolean {
  return actor.roles.some(
    (r) => r.code === role && (r.departmentId === null || r.departmentId === departmentId),
  );
}

export type Decision = { ok: true } | { ok: false; reason: string };

/** WFE-04 + segregation-of-duties checks. */
export function canAct(actor: ActorCtx, tx: TxCtx): Decision {
  if (tx.status !== 'PENDING') return { ok: false, reason: `Transaction is ${tx.status}, not pending approval` };
  const stage = tx.chain[tx.currentStage];
  if (!stage) return { ok: false, reason: 'Invalid stage state' };
  if (actor.id === tx.initiatorId)
    return { ok: false, reason: 'Segregation of duties: an initiator cannot act on their own transaction' };
  if (tx.priorApproverIds.includes(actor.id))
    return { ok: false, reason: 'Segregation of duties: this user has already approved a stage on this transaction' };
  if (!holdsRoleFor(actor, stage.role, tx.departmentId))
    return { ok: false, reason: `Current stage requires the ${stage.role} role for this department` };
  return { ok: true };
}

/** State transition for an allowed verb. Reject/return require a comment (enforced at the service edge). */
export function applyVerb(tx: TxCtx, verb: Verb): { status: TxStatus; currentStage: number } {
  switch (verb) {
    case 'approve': {
      const last = tx.currentStage >= tx.chain.length - 1;
      return last
        ? { status: 'APPROVED', currentStage: tx.currentStage }
        : { status: 'PENDING', currentStage: tx.currentStage + 1 };
    }
    case 'reject':
      return { status: 'REJECTED', currentStage: tx.currentStage };
    case 'return':
      // WFE-04: return goes back to the initiator; on resubmission the chain restarts from stage 0
      return { status: 'RETURNED', currentStage: 0 };
  }
}

/** WFE-09: withdrawal only before any approver has acted. */
export function canWithdraw(actor: ActorCtx, tx: TxCtx): Decision {
  if (actor.id !== tx.initiatorId) return { ok: false, reason: 'Only the initiator can withdraw' };
  if (tx.status !== 'PENDING') return { ok: false, reason: `Cannot withdraw a ${tx.status} transaction` };
  if (tx.currentStage > 0 || tx.priorApproverIds.length > 0)
    return { ok: false, reason: 'An approver has already acted; ask for a return instead' };
  return { ok: true };
}

export function canResubmit(actor: ActorCtx, tx: TxCtx): Decision {
  if (actor.id !== tx.initiatorId) return { ok: false, reason: 'Only the initiator can resubmit' };
  if (tx.status !== 'RETURNED') return { ok: false, reason: 'Only returned transactions can be resubmitted' };
  return { ok: true };
}

export function canSubmit(actor: ActorCtx, tx: TxCtx): Decision {
  if (actor.id !== tx.initiatorId) return { ok: false, reason: 'Only the initiator can submit' };
  if (tx.status !== 'DRAFT') return { ok: false, reason: `Cannot submit a ${tx.status} transaction` };
  return { ok: true };
}
