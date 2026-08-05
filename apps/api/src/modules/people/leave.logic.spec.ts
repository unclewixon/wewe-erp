import { describe, it, expect } from 'vitest';
import { balanceAllows, leaveDays, rangesOverlap } from './leave.logic';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('leaveDays — working days Mon–Fri inclusive', () => {
  it('counts a full working week as 5', () => {
    expect(leaveDays(d('2026-08-03'), d('2026-08-07'))).toBe(5); // Mon–Fri
  });
  it('skips the weekend when the range spans it', () => {
    expect(leaveDays(d('2026-08-06'), d('2026-08-11'))).toBe(4); // Thu,Fri,Mon,Tue
  });
  it('a single working day is 1; a Saturday is 0', () => {
    expect(leaveDays(d('2026-08-05'), d('2026-08-05'))).toBe(1);
    expect(leaveDays(d('2026-08-08'), d('2026-08-08'))).toBe(0);
  });
  it('end before start is 0', () => {
    expect(leaveDays(d('2026-08-10'), d('2026-08-05'))).toBe(0);
  });
  it('maternity-length span: 84 entitled days covers 12 working weeks', () => {
    expect(leaveDays(d('2026-01-05'), d('2026-03-27'))).toBe(60); // 12 full weeks Mon–Fri
  });
});

describe('rangesOverlap', () => {
  it('detects overlap including shared boundary days', () => {
    expect(rangesOverlap(d('2026-08-03'), d('2026-08-07'), d('2026-08-07'), d('2026-08-10'))).toBe(true);
    expect(rangesOverlap(d('2026-08-03'), d('2026-08-07'), d('2026-08-05'), d('2026-08-06'))).toBe(true);
  });
  it('disjoint ranges do not overlap', () => {
    expect(rangesOverlap(d('2026-08-03'), d('2026-08-07'), d('2026-08-10'), d('2026-08-12'))).toBe(false);
  });
});

describe('balanceAllows — HRM-02 negative-balance gate', () => {
  it('allows up to exactly the remaining balance', () => {
    expect(balanceAllows(20, 15, 5, false)).toBe(true);
    expect(balanceAllows(20, 15, 6, false)).toBe(false);
  });
  it('setting leave.allowNegative unblocks overdraw', () => {
    expect(balanceAllows(20, 20, 3, true)).toBe(true);
    expect(balanceAllows(20, 20, 3, false)).toBe(false);
  });
});
