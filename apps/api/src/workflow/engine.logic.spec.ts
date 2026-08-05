import { describe, it, expect } from 'vitest';
import {
  canAct, applyVerb, canWithdraw, canResubmit, canSubmit, currentStageRole,
  type ActorCtx, type TxCtx, type StageDef,
} from './engine.logic';

const CHAIN: StageDef[] = [
  { role: 'SUPERVISOR' }, { role: 'INTERNAL_AUDIT' }, { role: 'FINANCE' }, { role: 'FINAL_APPROVER' },
];

const tx = (over: Partial<TxCtx> = {}): TxCtx => ({
  id: 't1', initiatorId: 'amina', departmentId: 'prg', status: 'PENDING',
  currentStage: 0, chain: CHAIN, priorApproverIds: [], ...over,
});
const actor = (id: string, code: any, departmentId: string | null = null): ActorCtx => ({
  id, roles: [{ code, departmentId }],
});

describe('five-stage chain (WFE-01/02)', () => {
  it('routes stage 0 to SUPERVISOR and advances through the chain to APPROVED', () => {
    let t = tx();
    expect(currentStageRole(t)).toBe('SUPERVISOR');
    for (let i = 0; i < CHAIN.length - 1; i++) {
      const next = applyVerb(t, 'approve');
      expect(next.status).toBe('PENDING');
      expect(next.currentStage).toBe(i + 1);
      t = { ...t, ...next };
    }
    expect(applyVerb(t, 'approve')).toEqual({ status: 'APPROVED', currentStage: 3 });
  });

  it('scopes SUPERVISOR to the transaction department; org-wide grants always qualify', () => {
    expect(canAct(actor('tunde', 'SUPERVISOR', 'prg'), tx()).ok).toBe(true);
    expect(canAct(actor('tunde', 'SUPERVISOR', 'fin'), tx()).ok).toBe(false);
    expect(canAct(actor('tunde', 'SUPERVISOR', null), tx()).ok).toBe(true);
  });

  it('requires the exact stage role', () => {
    expect(canAct(actor('ibrahim', 'FINANCE'), tx()).ok).toBe(false); // stage 0 is SUPERVISOR
    expect(canAct(actor('ibrahim', 'FINANCE'), tx({ currentStage: 2 })).ok).toBe(true);
  });
});

describe('segregation of duties', () => {
  it('blocks the initiator from acting on their own transaction, whatever roles they hold', () => {
    const d = canAct(actor('amina', 'SUPERVISOR', 'prg'), tx());
    expect(d.ok).toBe(false);
    expect((d as any).reason).toMatch(/initiator/i);
  });

  it('blocks a user from approving two stages of one transaction', () => {
    const d = canAct(actor('ngozi', 'FINANCE'), tx({ currentStage: 2, priorApproverIds: ['ngozi'] }));
    expect(d.ok).toBe(false);
    expect((d as any).reason).toMatch(/already approved/i);
  });
});

describe('reject / return / resubmit (WFE-04)', () => {
  it('reject terminates; return sends back to initiator and resets the chain', () => {
    expect(applyVerb(tx({ currentStage: 2 }), 'reject').status).toBe('REJECTED');
    const r = applyVerb(tx({ currentStage: 2 }), 'return');
    expect(r).toEqual({ status: 'RETURNED', currentStage: 0 });
  });

  it('only the initiator can resubmit, and only when RETURNED', () => {
    expect(canResubmit(actor('amina', 'INITIATOR'), tx({ status: 'RETURNED' })).ok).toBe(true);
    expect(canResubmit(actor('tunde', 'SUPERVISOR'), tx({ status: 'RETURNED' })).ok).toBe(false);
    expect(canResubmit(actor('amina', 'INITIATOR'), tx({ status: 'REJECTED' })).ok).toBe(false);
  });
});

describe('withdrawal (WFE-09)', () => {
  it('initiator may withdraw only before any approver acts', () => {
    expect(canWithdraw(actor('amina', 'INITIATOR'), tx()).ok).toBe(true);
    expect(canWithdraw(actor('amina', 'INITIATOR'), tx({ currentStage: 1 })).ok).toBe(false);
    expect(canWithdraw(actor('amina', 'INITIATOR'), tx({ priorApproverIds: ['tunde'] })).ok).toBe(false);
    expect(canWithdraw(actor('tunde', 'SUPERVISOR'), tx()).ok).toBe(false);
  });
});

describe('submission', () => {
  it('only the initiator submits, and only from DRAFT', () => {
    expect(canSubmit(actor('amina', 'INITIATOR'), tx({ status: 'DRAFT' })).ok).toBe(true);
    expect(canSubmit(actor('amina', 'INITIATOR'), tx({ status: 'PENDING' })).ok).toBe(false);
    expect(canSubmit(actor('tunde', 'SUPERVISOR'), tx({ status: 'DRAFT' })).ok).toBe(false);
  });
});
