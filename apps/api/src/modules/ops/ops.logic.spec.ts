import { describe, it, expect } from 'vitest';
import {
  DEFAULT_THRESHOLDS, applyReceipt, bandFor, dueDiligenceStatus, monthsBetween,
  orderSplittingFlags, quoteRequirement, straightLine, type PoLine,
} from './ops.logic';

const k = (naira: number) => BigInt(naira) * 100n; // naira → kobo

describe('PRC-02 threshold bands', () => {
  it('below ₦100,000 needs 1 quote', () => {
    expect(bandFor(DEFAULT_THRESHOLDS, k(50_000)).minQuotes).toBe(1);
    expect(bandFor(DEFAULT_THRESHOLDS, k(99_999)).minQuotes).toBe(1);
  });

  it('₦100,000 up to (but excluding) ₦1,000,000 needs 3 quotes, no committee note', () => {
    const band = bandFor(DEFAULT_THRESHOLDS, k(100_000));
    expect(band.minQuotes).toBe(3);
    expect(band.committeeNote).toBeUndefined();
    expect(bandFor(DEFAULT_THRESHOLDS, k(999_999)).committeeNote).toBeUndefined();
  });

  it('₦1,000,000 and above needs 3 quotes plus a committee note', () => {
    const band = bandFor(DEFAULT_THRESHOLDS, k(1_000_000));
    expect(band.minQuotes).toBe(3);
    expect(band.committeeNote).toBe(true);
    expect(bandFor(DEFAULT_THRESHOLDS, k(25_000_000)).committeeNote).toBe(true);
  });

  it('blocks selection when quotes are below the band minimum', () => {
    const d = quoteRequirement(DEFAULT_THRESHOLDS, k(500_000), 2);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toMatch(/at least 3 quote/);
  });

  it('sole-source justification bypasses the quote-count minimum', () => {
    expect(quoteRequirement(DEFAULT_THRESHOLDS, k(500_000), 1, { soleSource: true }).ok).toBe(true);
  });

  it('committee note is required in the top band even with enough quotes', () => {
    expect(quoteRequirement(DEFAULT_THRESHOLDS, k(2_000_000), 3).ok).toBe(false);
    expect(quoteRequirement(DEFAULT_THRESHOLDS, k(2_000_000), 3, { committeeNote: true }).ok).toBe(true);
  });

  it('sole source does NOT waive the committee note in the top band', () => {
    expect(quoteRequirement(DEFAULT_THRESHOLDS, k(2_000_000), 1, { soleSource: true }).ok).toBe(false);
    expect(quoteRequirement(DEFAULT_THRESHOLDS, k(2_000_000), 1, { soleSource: true, committeeNote: true }).ok).toBe(true);
  });

  it('a single quote suffices below ₦100k', () => {
    expect(quoteRequirement(DEFAULT_THRESHOLDS, k(80_000), 1).ok).toBe(true);
  });
});

describe('PRC-03 goods-receipt status transitions', () => {
  const lines = (): PoLine[] => [
    { description: 'Laptops', qty: 10, unitKobo: '45000000' },
    { description: 'Mice', qty: 20, unitKobo: '500000' },
  ];

  it('partial receipt moves OPEN → PARTIAL', () => {
    const r = applyReceipt(lines(), [{ lineIndex: 0, qty: 4 }]);
    expect(r.status).toBe('PARTIAL');
    expect(r.lines[0].receivedQty).toBe(4);
    expect(r.lines[1].receivedQty).toBe(0);
  });

  it('stays PARTIAL until every line is fully received, then CLOSED', () => {
    const first = applyReceipt(lines(), [{ lineIndex: 0, qty: 10 }]);
    expect(first.status).toBe('PARTIAL');
    const second = applyReceipt(first.lines, [{ lineIndex: 1, qty: 20 }]);
    expect(second.status).toBe('CLOSED');
  });

  it('one receipt covering everything goes straight to CLOSED', () => {
    const r = applyReceipt(lines(), [{ lineIndex: 0, qty: 10 }, { lineIndex: 1, qty: 20 }]);
    expect(r.status).toBe('CLOSED');
  });

  it('rejects over-receipt beyond the ordered qty (cumulative)', () => {
    const first = applyReceipt(lines(), [{ lineIndex: 0, qty: 8 }]);
    expect(() => applyReceipt(first.lines, [{ lineIndex: 0, qty: 3 }])).toThrow(/exceed ordered qty/);
  });

  it('rejects unknown line indices and non-positive quantities', () => {
    expect(() => applyReceipt(lines(), [{ lineIndex: 5, qty: 1 }])).toThrow(/does not exist/);
    expect(() => applyReceipt(lines(), [{ lineIndex: 0, qty: 0 }])).toThrow(/positive integer/);
    expect(() => applyReceipt(lines(), [])).toThrow(/at least one line/);
  });
});

describe('PRC-03 order-splitting detection', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));

  it('flags same vendor+category POs inside 30 days aggregating over the threshold', () => {
    const flags = orderSplittingFlags([
      { ref: 'PO-1', vendorId: 'v1', category: 'IT', totalKobo: k(60_000), issuedAt: day(0) },
      { ref: 'PO-2', vendorId: 'v1', category: 'IT', totalKobo: k(70_000), issuedAt: day(10) },
    ], k(100_000));
    expect(flags).toHaveLength(1);
    expect(flags[0].refs).toEqual(['PO-1', 'PO-2']);
    expect(flags[0].totalKobo).toBe(k(130_000).toString());
  });

  it('does not flag POs more than 30 days apart, different vendors, or under-threshold sums', () => {
    expect(orderSplittingFlags([
      { ref: 'PO-1', vendorId: 'v1', category: 'IT', totalKobo: k(60_000), issuedAt: day(0) },
      { ref: 'PO-2', vendorId: 'v1', category: 'IT', totalKobo: k(70_000), issuedAt: day(35) },
      { ref: 'PO-3', vendorId: 'v2', category: 'IT', totalKobo: k(70_000), issuedAt: day(1) },
      { ref: 'PO-4', vendorId: 'v1', category: 'FUEL', totalKobo: k(20_000), issuedAt: day(2) },
    ], k(100_000))).toHaveLength(0);
  });

  it('never flags a lone PO', () => {
    expect(orderSplittingFlags([
      { ref: 'PO-1', vendorId: 'v1', category: 'IT', totalKobo: k(900_000), issuedAt: day(0) },
    ], k(100_000))).toHaveLength(0);
  });
});

describe('PRC-01 due-diligence status', () => {
  const now = new Date('2026-08-05T00:00:00Z');
  it('COMPLETE when both docs present and not expired', () => {
    expect(dueDiligenceStatus({ cacDocId: 'a', taxClearanceDocId: 'b', expiresAt: '2027-01-01T00:00:00Z' }, now)).toBe('COMPLETE');
    expect(dueDiligenceStatus({ cacDocId: 'a', taxClearanceDocId: 'b' }, now)).toBe('COMPLETE');
  });
  it('EXPIRED when docs present but past expiry', () => {
    expect(dueDiligenceStatus({ cacDocId: 'a', taxClearanceDocId: 'b', expiresAt: '2026-01-01T00:00:00Z' }, now)).toBe('EXPIRED');
  });
  it('INCOMPLETE when any doc is missing (or no data at all)', () => {
    expect(dueDiligenceStatus({ cacDocId: 'a' }, now)).toBe('INCOMPLETE');
    expect(dueDiligenceStatus(null, now)).toBe('INCOMPLETE');
  });
});

describe('AST depreciation (straight-line monthly)', () => {
  it('computes monthly, accumulated and NBV', () => {
    // ₦360,000 over 36 months, 12 months in → monthly ₦10,000; NBV ₦240,000
    const d = straightLine(k(360_000), 36, 12);
    expect(d.monthlyKobo).toBe(k(10_000));
    expect(d.accumulatedKobo).toBe(k(120_000));
    expect(d.nbvKobo).toBe(k(240_000));
  });

  it('fully depreciates to zero NBV once life has elapsed (remainder absorbed)', () => {
    const d = straightLine(100n, 3, 3); // monthly floor = 33; final month absorbs remainder
    expect(d.accumulatedKobo).toBe(100n);
    expect(d.nbvKobo).toBe(0n);
    expect(straightLine(k(360_000), 36, 48).nbvKobo).toBe(0n);
  });

  it('mid-life integer division floors the monthly charge', () => {
    const d = straightLine(100n, 3, 2);
    expect(d.monthlyKobo).toBe(33n);
    expect(d.accumulatedKobo).toBe(66n);
    expect(d.nbvKobo).toBe(34n);
  });

  it('zero months elapsed → NBV equals cost; missing life → no depreciation', () => {
    expect(straightLine(k(500_000), 36, 0).nbvKobo).toBe(k(500_000));
    expect(straightLine(k(500_000), 0, 12).nbvKobo).toBe(k(500_000));
  });

  it('monthsBetween counts full calendar months only', () => {
    expect(monthsBetween(new Date('2026-01-15T00:00:00Z'), new Date('2026-03-14T00:00:00Z'))).toBe(1);
    expect(monthsBetween(new Date('2026-01-15T00:00:00Z'), new Date('2026-03-15T00:00:00Z'))).toBe(2);
    expect(monthsBetween(new Date('2026-03-15T00:00:00Z'), new Date('2026-01-15T00:00:00Z'))).toBe(0);
  });
});
