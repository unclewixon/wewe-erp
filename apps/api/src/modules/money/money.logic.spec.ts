import { describe, expect, it } from 'vitest';
import {
  accumulateUsage, advanceAging, applyRetirement, budgetPosition, checkAgainstAvailable,
  computeNights, perDiemFor, retirementDeadline, retirementFigures, sumLineAmounts,
  travelPerDiemTotal, virementCheck, type PerDiemRates,
} from './money.logic';

describe('budget position math (BUD-03)', () => {
  it('splits PENDING into committed and APPROVED into actual, ignoring other statuses', () => {
    const usage = accumulateUsage([
      { budgetLineId: 'L1', status: 'PENDING', amountKobo: 100n },
      { budgetLineId: 'L1', status: 'PENDING', amountKobo: 50n },
      { budgetLineId: 'L1', status: 'APPROVED', amountKobo: 200n },
      { budgetLineId: 'L1', status: 'REJECTED', amountKobo: 999n },
      { budgetLineId: 'L1', status: 'DRAFT', amountKobo: 999n },
      { budgetLineId: 'L1', status: 'RETURNED', amountKobo: 999n },
      { budgetLineId: 'L1', status: 'WITHDRAWN', amountKobo: 999n },
      { budgetLineId: 'L2', status: 'APPROVED', amountKobo: 10n },
      { budgetLineId: null, status: 'PENDING', amountKobo: 999n },
    ]);
    expect(usage.get('L1')).toEqual({ committedKobo: 150n, actualKobo: 200n });
    expect(usage.get('L2')).toEqual({ committedKobo: 0n, actualKobo: 10n });
    expect(usage.has('null')).toBe(false);
  });

  it('computes available = allocated − committed − actual', () => {
    const p = budgetPosition(1_000n, { committedKobo: 150n, actualKobo: 200n });
    expect(p).toEqual({ allocatedKobo: 1_000n, committedKobo: 150n, actualKobo: 200n, availableKobo: 650n });
  });

  it('handles a line with no usage and allows negative availability', () => {
    expect(budgetPosition(500n).availableKobo).toBe(500n);
    expect(budgetPosition(100n, { committedKobo: 150n, actualKobo: 0n }).availableKobo).toBe(-50n);
  });
});

describe('REQ-02 budget check', () => {
  const available = new Map([['L1', 1_000n], ['L2', 300n]]);

  it('passes lines within budget and lines without a budget line', () => {
    const v = checkAgainstAvailable([
      { index: 0, budgetLineId: 'L1', amountKobo: 400n },
      { index: 1, budgetLineId: null, amountKobo: 9_999n },
      { index: 2, budgetLineId: 'UNKNOWN', amountKobo: 9_999n },
    ], available);
    expect(v).toEqual([]);
  });

  it('flags the line that breaches available, with the shortfall', () => {
    const v = checkAgainstAvailable([{ index: 0, budgetLineId: 'L2', amountKobo: 301n }], available);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ index: 0, budgetLineId: 'L2', requestedKobo: 301n, availableKobo: 300n, shortfallKobo: 1n });
  });

  it('accumulates multiple lines against the same budget line', () => {
    const v = checkAgainstAvailable([
      { index: 0, budgetLineId: 'L1', amountKobo: 600n },
      { index: 1, budgetLineId: 'L1', amountKobo: 500n }, // running total 1100 > 1000
    ], available);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ index: 1, requestedKobo: 1_100n, shortfallKobo: 100n });
  });

  it('exactly-available spends pass', () => {
    expect(checkAgainstAvailable([{ index: 0, budgetLineId: 'L2', amountKobo: 300n }], available)).toEqual([]);
  });
});

describe('virement guard (BUD-02)', () => {
  it('allows a transfer within available headroom', () => {
    const r = virementCheck(1_000n, { committedKobo: 300n, actualKobo: 200n }, 500n);
    expect(r.ok).toBe(true);
    expect(r.availableKobo).toBe(500n);
  });

  it('blocks a transfer that would take the source below committed + actual', () => {
    const r = virementCheck(1_000n, { committedKobo: 300n, actualKobo: 200n }, 501n);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('below');
  });

  it('blocks non-positive amounts and unused-line over-transfers', () => {
    expect(virementCheck(1_000n, undefined, 0n).ok).toBe(false);
    expect(virementCheck(1_000n, undefined, 1_000n).ok).toBe(true);
    expect(virementCheck(1_000n, undefined, 1_001n).ok).toBe(false);
  });
});

describe('per-diem calc (ADV-02)', () => {
  const rates: PerDiemRates = {
    DEFAULT: { STANDARD: '2500000', HIGH_COST: '4000000' },
    SENIOR: { STANDARD: '3500000', HIGH_COST: '5500000' },
  };

  it('resolves grade + location category', () => {
    expect(perDiemFor(rates, 'SENIOR', 'HIGH_COST')).toBe(5_500_000n);
  });

  it('falls back to DEFAULT grade and STANDARD category', () => {
    expect(perDiemFor(rates, 'UNKNOWN_GRADE', 'HIGH_COST')).toBe(4_000_000n);
    expect(perDiemFor(rates, 'SENIOR', undefined)).toBe(3_500_000n);
    expect(perDiemFor(rates, null, null)).toBe(2_500_000n);
    expect(perDiemFor(rates, 'SENIOR', 'NOWHERE')).toBe(3_500_000n);
  });

  it('returns null when the table has no applicable rate', () => {
    expect(perDiemFor({}, 'SENIOR', 'STANDARD')).toBeNull();
    expect(perDiemFor({ DEFAULT: { HIGH_COST: '100' } }, null, 'STANDARD')).toBeNull();
    expect(perDiemFor({ DEFAULT: { STANDARD: 'not-a-number' } }, null, null)).toBeNull();
  });

  it('computes nights and total: 3 nights at the resolved rate', () => {
    const nights = computeNights(new Date('2026-08-10T08:00:00Z'), new Date('2026-08-13T18:00:00Z'));
    expect(nights).toBe(3);
    expect(travelPerDiemTotal(nights, 2_500_000n)).toBe(7_500_000n);
  });

  it('a same-day trip has zero nights', () => {
    expect(computeNights(new Date('2026-08-10T06:00:00Z'), new Date('2026-08-10T22:00:00Z'))).toBe(0);
  });
});

describe('retirement deadline & aging (ADV-03/04)', () => {
  it('deadline = disbursedAt + N days when there is no travel', () => {
    const d = retirementDeadline(new Date('2026-08-01T00:00:00Z'), null, 5);
    expect(d.toISOString()).toBe('2026-08-06T00:00:00.000Z');
  });

  it('deadline uses the travel end date when later than disbursement', () => {
    const d = retirementDeadline(new Date('2026-08-01T00:00:00Z'), new Date('2026-08-10T00:00:00Z'), 5);
    expect(d.toISOString()).toBe('2026-08-15T00:00:00.000Z');
  });

  it('deadline ignores a travel end date already in the past at disbursement', () => {
    const d = retirementDeadline(new Date('2026-08-20T00:00:00Z'), new Date('2026-08-10T00:00:00Z'), 5);
    expect(d.toISOString()).toBe('2026-08-25T00:00:00.000Z');
  });

  it('flags overdue only after the deadline passes', () => {
    const disbursed = new Date('2026-08-01T00:00:00Z');
    const deadline = new Date('2026-08-06T00:00:00Z');
    expect(advanceAging(disbursed, deadline, new Date('2026-08-05T00:00:00Z'))).toEqual({ ageDays: 4, overdue: false });
    expect(advanceAging(disbursed, deadline, new Date('2026-08-07T00:00:00Z'))).toEqual({ ageDays: 6, overdue: true });
    expect(advanceAging(disbursed, null, new Date('2026-09-01T00:00:00Z')).overdue).toBe(false);
  });
});

describe('retirement variance math (RET-02/03)', () => {
  it('under-spend: negative variance and a refund due', () => {
    const { varianceKobo, refundDueKobo } = retirementFigures(1_000n, 800n);
    expect(varianceKobo).toBe(-200n);
    expect(refundDueKobo).toBe(200n);
  });

  it('over-spend: positive variance, no refund', () => {
    const { varianceKobo, refundDueKobo } = retirementFigures(1_000n, 1_150n);
    expect(varianceKobo).toBe(150n);
    expect(refundDueKobo).toBe(0n);
  });

  it('exact retirement: zero variance, zero refund', () => {
    expect(retirementFigures(1_000n, 1_000n)).toEqual({ varianceKobo: 0n, refundDueKobo: 0n });
  });

  it('freestanding reimbursement (balance 0): variance = total, no refund', () => {
    expect(retirementFigures(0n, 750n)).toEqual({ varianceKobo: 750n, refundDueKobo: 0n });
  });

  it('partial retirement reduces the balance; full retirement closes the advance', () => {
    expect(applyRetirement(1_000n, 400n)).toEqual({ newBalanceKobo: 600n, closed: false });
    expect(applyRetirement(600n, 600n)).toEqual({ newBalanceKobo: 0n, closed: true });
    // over-spend never drives the balance negative
    expect(applyRetirement(500n, 800n)).toEqual({ newBalanceKobo: 0n, closed: true });
  });

  it('sums retirement lines', () => {
    expect(sumLineAmounts([{ amountKobo: 1n }, { amountKobo: 2n }, { amountKobo: 3n }])).toBe(6n);
  });
});
