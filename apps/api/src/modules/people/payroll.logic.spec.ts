import { describe, it, expect } from 'vitest';
import {
  SEED_PAYROLL_RULES, annualPaye, computePayrollItem, divRound, parseRules, pctBp, splitByPercents,
} from './payroll.logic';

const rules = parseRules(SEED_PAYROLL_RULES);
const naira = (n: number) => BigInt(n) * 100n; // whole naira → kobo

describe('parseRules', () => {
  it('normalises percentages to basis points and naira to kobo', () => {
    expect(rules.pensionEmployeeBp).toBe(800);
    expect(rules.pensionEmployerBp).toBe(1000);
    expect(rules.nhfBp).toBe(250); // 2.5% survives as an exact bp value
    expect(rules.craFixedKobo).toBe(naira(200_000));
    expect(rules.bands[0]).toEqual({ uptoKobo: naira(300_000), rateBp: 700 });
    expect(rules.bands[5]).toEqual({ uptoKobo: null, rateBp: 2400 });
  });

  it('rejects malformed rules', () => {
    expect(() => parseRules({ bands: [] })).toThrow();
    expect(() => parseRules({ ...SEED_PAYROLL_RULES, nhfPct: -1 })).toThrow();
  });
});

describe('annualPaye — consolidated band walk', () => {
  it('is zero at or below zero taxable', () => {
    expect(annualPaye(0n, rules.bands)).toBe(0n);
    expect(annualPaye(-5n, rules.bands)).toBe(0n);
  });

  it('taxes entirely inside the first band at 7%', () => {
    expect(annualPaye(naira(50_200), rules.bands)).toBe(naira(3_514)); // 50,200 × 7%
  });

  it('walks all six bands for a high earner', () => {
    // 16,440,000: 300k@7 + 300k@11 + 500k@15 + 500k@19 + 1.6m@21 + 13,240,000@24
    // = 21,000 + 33,000 + 75,000 + 95,000 + 336,000 + 3,177,600 = 3,737,600
    expect(annualPaye(naira(16_440_000), rules.bands)).toBe(naira(3_737_600));
  });

  it('stops exactly at a band boundary', () => {
    // 600,000 taxable: 300k@7 + 300k@11 = 21,000 + 33,000
    expect(annualPaye(naira(600_000), rules.bands)).toBe(naira(54_000));
  });
});

describe('computePayrollItem — monthly statutory computation (BigInt kobo)', () => {
  it('mid earner ₦250,000/month', () => {
    const c = computePayrollItem(naira(250_000), [], rules);
    expect(c.grossKobo).toBe(naira(250_000));
    expect(c.pensionEmployeeKobo).toBe(naira(20_000)); // 8%
    expect(c.pensionEmployerKobo).toBe(naira(25_000)); // 10%
    expect(c.nhfKobo).toBe(naira(6_250)); // 2.5%
    // annual gross 3,000,000; CRA = max(200,000, 30,000) + 600,000 = 800,000
    expect(c.craAnnualKobo).toBe(naira(800_000));
    // taxable = 3,000,000 − 800,000 − 240,000 − 75,000 = 1,885,000
    expect(c.taxableAnnualKobo).toBe(naira(1_885_000));
    expect(c.payeAnnualKobo).toBe(naira(283_850));
    // 28,385,000 kobo / 12 = 2,365,416.67 → rounds to 2,365,417 kobo
    expect(c.payeKobo).toBe(2_365_417n);
    expect(c.netKobo).toBe(naira(250_000) - 2_365_417n - naira(20_000) - naira(6_250));
    expect(c.netKobo).toBe(20_009_583n);
  });

  it('low earner ₦30,000/month rounds monthly PAYE to the kobo', () => {
    const c = computePayrollItem(naira(30_000), [], rules);
    // taxable annual = 360,000 − 272,000 − 28,800 − 9,000 = 50,200 → PAYE 3,514/yr
    expect(c.taxableAnnualKobo).toBe(naira(50_200));
    expect(c.payeAnnualKobo).toBe(naira(3_514));
    expect(c.payeKobo).toBe(29_283n); // 351,400 / 12 = 29,283.33 kobo
  });

  it('high earner ₦2,000,000/month reaches the 24% band', () => {
    const c = computePayrollItem(naira(2_000_000), [], rules);
    expect(c.craAnnualKobo).toBe(naira(5_040_000)); // max(200k, 240k) + 4.8m
    expect(c.taxableAnnualKobo).toBe(naira(16_440_000));
    expect(c.payeAnnualKobo).toBe(naira(3_737_600));
    expect(c.payeKobo).toBe(divRound(naira(3_737_600), 12n));
    expect(c.payeKobo).toBe(31_146_667n);
  });

  it('very low earner pays no PAYE once relief exceeds gross', () => {
    const c = computePayrollItem(naira(10_000), [], rules);
    expect(c.taxableAnnualKobo).toBe(0n);
    expect(c.payeKobo).toBe(0n);
    expect(c.netKobo).toBe(naira(10_000) - c.pensionEmployeeKobo - c.nhfKobo);
  });

  it('allowances raise the gross before every statutory line', () => {
    const base = computePayrollItem(naira(200_000), [naira(30_000), naira(20_000)], rules);
    const flat = computePayrollItem(naira(250_000), [], rules);
    expect(base).toEqual(flat); // 200k + 30k + 20k ≡ 250k flat
  });
});

describe('pctBp rounding', () => {
  it('rounds half-up to the kobo', () => {
    expect(pctBp(101n, 250)).toBe(3n); // 2.525 → 3
    expect(pctBp(100n, 250)).toBe(3n); // 2.5 → 3 (half-up)
    expect(pctBp(99n, 250)).toBe(2n); // 2.475 → 2
  });
});

describe('splitByPercents — cost distribution never loses a kobo', () => {
  it('splits exactly with awkward thirds', () => {
    const parts = splitByPercents(1000n, [
      { projectCode: 'A', percent: 33 }, { projectCode: 'B', percent: 33 }, { projectCode: 'C', percent: 34 },
    ]);
    expect(parts.map((p) => p.amountKobo)).toEqual([330n, 330n, 340n]);
    expect(parts.reduce((s, p) => s + p.amountKobo, 0n)).toBe(1000n);
  });

  it('last row absorbs rounding drift', () => {
    const parts = splitByPercents(101n, [
      { projectCode: 'A', percent: 50 }, { projectCode: 'B', percent: 50 },
    ]);
    expect(parts.reduce((s, p) => s + p.amountKobo, 0n)).toBe(101n);
  });

  it('single ORG fallback row takes everything', () => {
    expect(splitByPercents(123_456n, [{ projectCode: 'ORG', percent: 100 }])[0].amountKobo).toBe(123_456n);
  });
});
