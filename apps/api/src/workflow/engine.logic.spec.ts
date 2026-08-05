import { describe, it, expect } from 'vitest';
import {
  canAct, applyVerb, canWithdraw, canResubmit, canSubmit, currentStageRole, resolveChain,
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

describe('amount-based rules (WFE-03)', () => {
  const STAGES = [
    { role: 'SUPERVISOR' }, { role: 'INTERNAL_AUDIT' }, { role: 'FINANCE' },
    { role: 'FINAL_APPROVER', minAmountKobo: '50000000' }, // ₦500,000.00
  ] as any;

  it('auto-passes Final Approver under the threshold and reports it as skipped', () => {
    const r = resolveChain(STAGES, 46_000_000n); // ₦460k
    expect(r.chain.map((s: any) => s.role)).toEqual(['SUPERVISOR', 'INTERNAL_AUDIT', 'FINANCE']);
    expect(r.skipped.map((s: any) => s.role)).toEqual(['FINAL_APPROVER']);
  });

  it('keeps the full chain at or above the threshold', () => {
    const r = resolveChain(STAGES, 50_000_000n);
    expect(r.chain).toHaveLength(4);
    expect(r.skipped).toHaveLength(0);
  });
});

describe('delegation (WFE-05)', () => {
  const delegated = (delegatorId: string): ActorCtx => ({
    id: 'zainab',
    roles: [{ code: 'FINANCE' as any, departmentId: null, onBehalfOf: { userId: delegatorId, name: 'Ibrahim Musa' } }],
  });

  it('a delegate can act at the delegated stage, and the grant is reported for on-behalf-of logging', () => {
    const d = canAct(delegated('ibrahim'), tx({ currentStage: 2 }));
    expect(d.ok).toBe(true);
    expect((d as any).via.onBehalfOf.userId).toBe('ibrahim');
  });

  it('delegation cannot defeat SoD: blocked when the delegator is the initiator', () => {
    const d = canAct(delegated('amina'), tx({ currentStage: 2 })); // amina initiated the tx
    expect(d.ok).toBe(false);
    expect((d as any).reason).toMatch(/delegat/i);
  });

  it('delegation cannot defeat SoD: blocked when the delegator already approved a stage', () => {
    const d = canAct(delegated('tunde'), tx({ currentStage: 2, priorApproverIds: ['tunde'] }));
    expect(d.ok).toBe(false);
  });
});

describe('return/resubmit restarts the double-act rule (found by system sweep)', () => {
  it('an approver who acted before a return may approve again after resubmission', async () => {
    const { priorApproversSinceLastSubmit } = await import('./engine.logic');
    const ev = (action: string, actorId: string, t: number) => ({ action, actorId, createdAt: new Date(t) });
    const events = [
      ev('SUBMITTED', 'amina', 1), ev('APPROVED', 'tunde', 2), ev('RETURNED', 'ngozi', 3),
      ev('RESUBMITTED', 'amina', 4),
    ];
    expect(priorApproversSinceLastSubmit(events)).toEqual([]); // tunde free to act again
    expect(priorApproversSinceLastSubmit([...events, ev('APPROVED', 'tunde', 5)])).toEqual(['tunde']);
  });
});
