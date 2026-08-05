import { describe, expect, it } from 'vitest';
import {
  clusterFailedLogins,
  computeGrantHealth,
  computeStageDurations,
  csvEscape,
  elapsedFraction,
  findBottleneck,
  grantMinorToKobo,
  isAfterHoursLagos,
  koboToGrantMinor,
  lagosDayKey,
  median,
  parseFxRateCents,
  pendingByRole,
  percentile,
  summariseStages,
  toCsv,
  type StageEventLite,
} from './governance.logic';

describe('FX integer math (DGM-02)', () => {
  it('parses decimal rate strings into rate*100 BigInt', () => {
    expect(parseFxRateCents('1650.00')).toBe(165000n);
    expect(parseFxRateCents('1650')).toBe(165000n);
    expect(parseFxRateCents('1650.5')).toBe(165050n);
    expect(parseFxRateCents('0.75')).toBe(75n);
  });

  it('rejects malformed or non-positive rates', () => {
    expect(() => parseFxRateCents('1,650.00')).toThrow();
    expect(() => parseFxRateCents('1650.123')).toThrow();
    expect(() => parseFxRateCents('-5')).toThrow();
    expect(() => parseFxRateCents('0')).toThrow();
    expect(() => parseFxRateCents('')).toThrow();
  });

  it('converts kobo to grant minor units without floats', () => {
    // ₦1,650.00 (=165000 kobo) at 1650 NGN/USD → $1.00 = 100 cents
    expect(koboToGrantMinor(165_000n, 165000n)).toBe(100n);
    // ₦2,475,000.00 at 1650 → $1,500.00
    expect(koboToGrantMinor(247_500_000n, 165000n)).toBe(150_000n);
  });

  it('rounds half-up on conversion', () => {
    // 1 kobo at rate 1650 → 100/165000 = 0.0006 cents → rounds to 0
    expect(koboToGrantMinor(1n, 165000n)).toBe(0n);
    // 825 kobo → 82500/165000 = exactly 0.5 cents → rounds up to 1
    expect(koboToGrantMinor(825n, 165000n)).toBe(1n);
  });

  it('round-trips grant minor to kobo', () => {
    expect(grantMinorToKobo(100n, 165000n)).toBe(165_000n); // $1 → ₦1,650.00
    expect(grantMinorToKobo(250_000_000n, 165000n)).toBe(412_500_000_000n); // $2.5m grant in kobo
  });

  it('survives amounts far beyond Number safe range', () => {
    const hugeKobo = 9_007_199_254_740_993_000n;
    expect(koboToGrantMinor(hugeKobo, 100n)).toBe(hugeKobo); // rate 1.00 → identity
  });
});

describe('elapsedFraction', () => {
  const start = new Date('2024-01-01T00:00:00Z');
  const end = new Date('2026-01-01T00:00:00Z');
  it('clamps to [0,1] and handles midpoints', () => {
    expect(elapsedFraction(start, end, new Date('2023-06-01T00:00:00Z'))).toBe(0);
    expect(elapsedFraction(start, end, new Date('2026-06-01T00:00:00Z'))).toBe(1);
    expect(elapsedFraction(start, end, new Date('2025-01-01T00:00:00Z'))).toBeCloseTo(0.5, 2);
  });
  it('returns null for missing or inverted dates', () => {
    expect(elapsedFraction(null, end, new Date())).toBeNull();
    expect(elapsedFraction(start, null, new Date())).toBeNull();
    expect(elapsedFraction(end, start, new Date())).toBeNull();
  });
});

describe('computeGrantHealth (DGM-02 alerts & burn rate)', () => {
  const base = {
    budgetMinor: 1_000_000n,
    committedMinor: 0n,
    // 732 days total (2024 is a leap year); 2025-01-01 is exactly half way.
    startDate: new Date('2024-01-01T00:00:00Z'),
    endDate: new Date('2026-01-02T00:00:00Z'),
    now: new Date('2025-01-01T00:00:00Z'), // exactly half way, > 60 days from end
  };

  it('computes utilisation in basis points and remaining', () => {
    const h = computeGrantHealth({ ...base, actualMinor: 400_000n });
    expect(h.utilisationBp).toBe(4000);
    expect(h.utilisationPct).toBe(40);
    expect(h.remainingMinor).toBe('600000');
    expect(h.alerts).toEqual([]);
  });

  it('projects full-period spend as actual / elapsed-fraction', () => {
    const h = computeGrantHealth({ ...base, actualMinor: 400_000n });
    // Half the period elapsed → projected spend = 2x actual; on-pace ratio 0.8
    expect(h.burnRateMinor).toBe('800000');
    expect(h.burnRateRatio).toBeCloseTo(0.8, 2);
  });

  it('raises AMBER at >=80% utilisation and RED at >=95%', () => {
    expect(computeGrantHealth({ ...base, actualMinor: 800_000n }).alerts)
      .toContainEqual(expect.objectContaining({ level: 'AMBER', code: 'UTILISATION_80' }));
    expect(computeGrantHealth({ ...base, actualMinor: 950_000n }).alerts)
      .toContainEqual(expect.objectContaining({ level: 'RED', code: 'UTILISATION_95' }));
    // 95 supersedes 80 — only one utilisation alert at a time
    const red = computeGrantHealth({ ...base, actualMinor: 990_000n });
    expect(red.alerts.filter((a) => a.code.startsWith('UTILISATION'))).toHaveLength(1);
  });

  it('flags an end date within 60 days (AMBER) and a passed end date (RED)', () => {
    const soon = computeGrantHealth({ ...base, actualMinor: 0n, now: new Date('2025-11-15T00:00:00Z') });
    expect(soon.alerts).toContainEqual(expect.objectContaining({ level: 'AMBER', code: 'ENDING_SOON' }));
    const ended = computeGrantHealth({ ...base, actualMinor: 0n, now: new Date('2026-02-01T00:00:00Z') });
    expect(ended.alerts).toContainEqual(expect.objectContaining({ level: 'RED', code: 'GRANT_ENDED' }));
  });

  it('accounts committed separately in uncommitted remaining', () => {
    const h = computeGrantHealth({ ...base, actualMinor: 400_000n, committedMinor: 100_000n });
    expect(h.remainingMinor).toBe('600000');       // budget - actual
    expect(h.uncommittedMinor).toBe('500000');     // budget - actual - committed
  });

  it('handles a zero budget and missing dates without dividing by zero', () => {
    const h = computeGrantHealth({
      budgetMinor: 0n, actualMinor: 50n, committedMinor: 0n,
      startDate: null, endDate: null, now: new Date(),
    });
    expect(h.utilisationBp).toBe(0);
    expect(h.elapsedFraction).toBeNull();
    expect(h.burnRateRatio).toBeNull();
    expect(h.burnRateMinor).toBe('0');
  });
});

describe('CSV building (DGM-03)', () => {
  it('escapes quotes, commas and newlines', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('joins header and rows with CRLF and a trailing newline', () => {
    const csv = toCsv(['ref', 'title'], [['REQ-2026-0001', 'Fuel, generator']]);
    expect(csv).toBe('ref,title\r\nREQ-2026-0001,"Fuel, generator"\r\n');
  });
});

describe('AUD-05 activity helpers', () => {
  it('uses the Lagos (UTC+1) calendar day for grouping', () => {
    // 23:30 UTC = 00:30 next day in Lagos
    expect(lagosDayKey(new Date('2026-08-04T23:30:00Z'))).toBe('2026-08-05');
    expect(lagosDayKey(new Date('2026-08-04T12:00:00Z'))).toBe('2026-08-04');
  });

  it('marks activity outside 07:00–20:00 Lagos as after-hours, with exact boundaries', () => {
    expect(isAfterHoursLagos(new Date('2026-08-04T06:00:00Z'))).toBe(false); // 07:00 Lagos — first working hour
    expect(isAfterHoursLagos(new Date('2026-08-04T05:59:00Z'))).toBe(true);  // 06:59 Lagos
    expect(isAfterHoursLagos(new Date('2026-08-04T19:00:00Z'))).toBe(true);  // 20:00 Lagos — after hours
    expect(isAfterHoursLagos(new Date('2026-08-04T18:59:00Z'))).toBe(false); // 19:59 Lagos
    expect(isAfterHoursLagos(new Date('2026-08-04T23:30:00Z'))).toBe(true);  // 00:30 Lagos
  });

  it('clusters >=3 failed logins per user per day', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 7, 4, h, 0, 0));
    const events = [
      { userId: 'u1', at: at(9) }, { userId: 'u1', at: at(10) }, { userId: 'u1', at: at(11) },
      { userId: 'u2', at: at(9) }, { userId: 'u2', at: at(10) }, // only 2 — below threshold
      { userId: 'u3', at: new Date(Date.UTC(2026, 7, 3, 9, 0)) }, // different day
      { userId: 'u3', at: at(9) }, { userId: 'u3', at: at(10) },
    ];
    const clusters = clusterFailedLogins(events, 3);
    expect(clusters).toEqual([{ userId: 'u1', day: '2026-08-04', count: 3 }]);
  });

  it('splits clusters across the Lagos midnight, not UTC midnight', () => {
    const events = [
      { userId: 'u1', at: new Date('2026-08-04T22:40:00Z') }, // 23:40 Lagos, day 04
      { userId: 'u1', at: new Date('2026-08-04T23:10:00Z') }, // 00:10 Lagos, day 05
      { userId: 'u1', at: new Date('2026-08-04T23:20:00Z') },
      { userId: 'u1', at: new Date('2026-08-04T23:30:00Z') },
    ];
    expect(clusterFailedLogins(events, 3)).toEqual([{ userId: 'u1', day: '2026-08-05', count: 3 }]);
  });
});

describe('DSH-02 pipeline analytics', () => {
  it('median handles odd, even and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('percentile uses nearest-rank', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(xs, 90)).toBe(9);
    expect(percentile(xs, 50)).toBe(5);
    expect(percentile([42], 90)).toBe(42);
    expect(percentile([], 90)).toBe(0);
  });

  const at = (h: number) => new Date(Date.UTC(2026, 7, 1, h, 0, 0));

  it('measures each stage from arrival to action', () => {
    const events: StageEventLite[] = [
      { transactionId: 't1', role: null, action: 'SUBMITTED', at: at(0) },
      { transactionId: 't1', role: 'SUPERVISOR', action: 'APPROVED', at: at(2) },     // 2h at supervisor
      { transactionId: 't1', role: 'INTERNAL_AUDIT', action: 'APPROVED', at: at(5) }, // 3h at audit
      { transactionId: 't1', role: 'FINANCE', action: 'RETURNED', at: at(9) },        // 4h at finance
    ];
    const d = computeStageDurations(events);
    expect(d.get('SUPERVISOR')).toEqual([2]);
    expect(d.get('INTERNAL_AUDIT')).toEqual([3]);
    expect(d.get('FINANCE')).toEqual([4]);
  });

  it('restarts the clock on RESUBMITTED and ignores time spent with the initiator', () => {
    const events: StageEventLite[] = [
      { transactionId: 't1', role: null, action: 'SUBMITTED', at: at(0) },
      { transactionId: 't1', role: 'SUPERVISOR', action: 'RETURNED', at: at(1) },
      { transactionId: 't1', role: null, action: 'RESUBMITTED', at: at(10) }, // 9h with initiator — not counted
      { transactionId: 't1', role: 'SUPERVISOR', action: 'APPROVED', at: at(12) },
    ];
    const d = computeStageDurations(events);
    expect(d.get('SUPERVISOR')).toEqual([1, 2]);
  });

  it('interleaves multiple transactions independently', () => {
    const events: StageEventLite[] = [
      { transactionId: 'a', role: null, action: 'SUBMITTED', at: at(0) },
      { transactionId: 'b', role: null, action: 'SUBMITTED', at: at(1) },
      { transactionId: 'b', role: 'SUPERVISOR', action: 'APPROVED', at: at(2) },
      { transactionId: 'a', role: 'SUPERVISOR', action: 'APPROVED', at: at(4) },
    ];
    const d = computeStageDurations(events);
    expect(d.get('SUPERVISOR')?.sort((x, y) => x - y)).toEqual([1, 4]);
  });

  it('summarises volume, median and p90 per role', () => {
    const durations = new Map<string, number[]>([
      ['SUPERVISOR', [1, 2, 3, 4, 100]],
      ['FINANCE', [5]],
    ]);
    const stats = summariseStages(durations);
    const sup = stats.find((s) => s.role === 'SUPERVISOR')!;
    expect(sup.volume).toBe(5);
    expect(sup.medianHours).toBe(3);
    expect(sup.p90Hours).toBe(100); // nearest-rank: ceil(0.9*5)=5th value
    expect(stats[0].role).toBe('SUPERVISOR'); // sorted by volume desc
  });

  it('finds the bottleneck: most pending items, ties broken by longer wait', () => {
    expect(findBottleneck([])).toBeNull();
    const b1 = findBottleneck([
      { role: 'FINANCE', waitingHours: 10 },
      { role: 'FINANCE', waitingHours: 20 },
      { role: 'SUPERVISOR', waitingHours: 90 },
    ]);
    expect(b1).toEqual({ role: 'FINANCE', count: 2, avgWaitHours: 15 });
    const b2 = findBottleneck([
      { role: 'FINANCE', waitingHours: 10 },
      { role: 'SUPERVISOR', waitingHours: 90 },
    ]);
    expect(b2?.role).toBe('SUPERVISOR'); // equal counts → longer average wait wins
  });

  it('reports the pending queue per role sorted by count', () => {
    const rows = pendingByRole([
      { role: 'FINANCE', waitingHours: 2 },
      { role: 'FINANCE', waitingHours: 4 },
      { role: 'FINAL_APPROVER', waitingHours: 50 },
    ]);
    expect(rows[0]).toEqual({ role: 'FINANCE', count: 2, avgWaitHours: 3 });
    expect(rows[1]).toEqual({ role: 'FINAL_APPROVER', count: 1, avgWaitHours: 50 });
  });
});
