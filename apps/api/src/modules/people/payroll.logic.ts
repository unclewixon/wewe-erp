/**
 * PAY-01..03 pure computation — simplified Nigerian statutory payroll.
 * All money is BigInt kobo; percentages are handled in basis points (1% = 100 bp)
 * so fractional rates like 2.5% stay exact. Rounding is half-up to the kobo.
 * No I/O here — fully unit-testable.
 */
import { z } from 'zod';

/** Raw shape stored in settings key 'payroll.rules'. */
export const PayrollRulesSchema = z.object({
  pensionEmployeePct: z.number().min(0).max(100),
  pensionEmployerPct: z.number().min(0).max(100),
  nhfPct: z.number().min(0).max(100),
  /** CRA = max(craFixedNaira, craMinPctOfGross% of annual gross) + craPctOfGross% of annual gross */
  craFixedNaira: z.number().min(0),
  craMinPctOfGross: z.number().min(0).max(100),
  craPctOfGross: z.number().min(0).max(100),
  /** Annualised progressive bands; uptoNaira is the cumulative upper bound, null = no cap (top band). */
  bands: z.array(z.object({ uptoNaira: z.number().positive().nullable(), rate: z.number().min(0).max(100) })).min(1),
});
export type PayrollRulesRaw = z.infer<typeof PayrollRulesSchema>;

/** Seeded default: current consolidated relief + 7/11/15/19/21/24% bands. */
export const SEED_PAYROLL_RULES: PayrollRulesRaw = {
  pensionEmployeePct: 8,
  pensionEmployerPct: 10,
  nhfPct: 2.5,
  craFixedNaira: 200_000,
  craMinPctOfGross: 1,
  craPctOfGross: 20,
  bands: [
    { uptoNaira: 300_000, rate: 7 },   // first 300k
    { uptoNaira: 600_000, rate: 11 },  // next 300k
    { uptoNaira: 1_100_000, rate: 15 }, // next 500k
    { uptoNaira: 1_600_000, rate: 19 }, // next 500k
    { uptoNaira: 3_200_000, rate: 21 }, // next 1.6m
    { uptoNaira: null, rate: 24 },      // above 3.2m
  ],
};

export interface PayrollRules {
  pensionEmployeeBp: number;
  pensionEmployerBp: number;
  nhfBp: number;
  craFixedKobo: bigint;
  craMinPctBp: number;
  craPctBp: number;
  bands: { uptoKobo: bigint | null; rateBp: number }[];
}

const pctToBp = (pct: number): number => Math.round(pct * 100);
const nairaToKobo = (naira: number): bigint => BigInt(Math.round(naira)) * 100n;

/** Validate + normalise the raw settings value into BigInt-kobo/basis-point form. */
export function parseRules(raw: unknown): PayrollRules {
  const r = PayrollRulesSchema.parse(raw);
  return {
    pensionEmployeeBp: pctToBp(r.pensionEmployeePct),
    pensionEmployerBp: pctToBp(r.pensionEmployerPct),
    nhfBp: pctToBp(r.nhfPct),
    craFixedKobo: nairaToKobo(r.craFixedNaira),
    craMinPctBp: pctToBp(r.craMinPctOfGross),
    craPctBp: pctToBp(r.craPctOfGross),
    bands: r.bands.map((b) => ({ uptoKobo: b.uptoNaira === null ? null : nairaToKobo(b.uptoNaira), rateBp: pctToBp(b.rate) })),
  };
}

/** Half-up integer division for non-negative BigInt. */
export function divRound(n: bigint, d: bigint): bigint {
  return (n + d / 2n) / d;
}

/** percent-of in basis points, rounded half-up to the kobo. */
export function pctBp(amountKobo: bigint, bp: number): bigint {
  return divRound(amountKobo * BigInt(bp), 10000n);
}

/** Annual PAYE over progressive cumulative bands (taxable annual income, kobo). */
export function annualPaye(taxableAnnualKobo: bigint, bands: PayrollRules['bands']): bigint {
  if (taxableAnnualKobo <= 0n) return 0n;
  let weighted = 0n; // kobo * bp
  let prev = 0n;
  for (const band of bands) {
    const upper = band.uptoKobo === null ? taxableAnnualKobo : (taxableAnnualKobo < band.uptoKobo ? taxableAnnualKobo : band.uptoKobo);
    const slice = upper - prev;
    if (slice <= 0n) break;
    weighted += slice * BigInt(band.rateBp);
    prev = upper;
    if (prev >= taxableAnnualKobo) break;
  }
  return divRound(weighted, 10000n);
}

export interface PayrollComputation {
  grossKobo: bigint;
  payeKobo: bigint;
  pensionEmployeeKobo: bigint;
  pensionEmployerKobo: bigint;
  nhfKobo: bigint;
  netKobo: bigint;
  // annualised working figures, for the payslip breakdown
  annualGrossKobo: bigint;
  craAnnualKobo: bigint;
  taxableAnnualKobo: bigint;
  payeAnnualKobo: bigint;
}

/**
 * One staff member, one month. gross = salary + allowances.
 * Taxable annual = annual gross − CRA − annual employee pension − annual NHF (floored at 0);
 * monthly PAYE = annual PAYE / 12, rounded to the kobo.
 */
export function computePayrollItem(salaryKobo: bigint, allowancesKobo: bigint[], rules: PayrollRules): PayrollComputation {
  const gross = allowancesKobo.reduce((s, a) => s + a, salaryKobo);
  const pensionEmployee = pctBp(gross, rules.pensionEmployeeBp);
  const pensionEmployer = pctBp(gross, rules.pensionEmployerBp);
  const nhf = pctBp(gross, rules.nhfBp);
  const annualGross = gross * 12n;
  const craFloor = pctBp(annualGross, rules.craMinPctBp);
  const cra = (rules.craFixedKobo > craFloor ? rules.craFixedKobo : craFloor) + pctBp(annualGross, rules.craPctBp);
  let taxable = annualGross - cra - pensionEmployee * 12n - nhf * 12n;
  if (taxable < 0n) taxable = 0n;
  const payeAnnual = annualPaye(taxable, rules.bands);
  const paye = divRound(payeAnnual, 12n);
  const net = gross - paye - pensionEmployee - nhf;
  return {
    grossKobo: gross, payeKobo: paye, pensionEmployeeKobo: pensionEmployee,
    pensionEmployerKobo: pensionEmployer, nhfKobo: nhf, netKobo: net,
    annualGrossKobo: annualGross, craAnnualKobo: cra, taxableAnnualKobo: taxable, payeAnnualKobo: payeAnnual,
  };
}

/**
 * PAY-03 cost distribution: split an amount by timesheet percentages with no
 * lost/spare kobo — every row gets its rounded share, the last row absorbs the remainder.
 * Assumes percentages total 100 (validated at the timesheet edge).
 */
export function splitByPercents(
  amountKobo: bigint,
  rows: { projectCode: string; percent: number }[],
): { projectCode: string; percent: number; amountKobo: bigint }[] {
  const out: { projectCode: string; percent: number; amountKobo: bigint }[] = [];
  let allocated = 0n;
  rows.forEach((r, i) => {
    const share = i === rows.length - 1 ? amountKobo - allocated : pctBp(amountKobo, r.percent * 100);
    allocated += share;
    out.push({ projectCode: r.projectCode, percent: r.percent, amountKobo: share });
  });
  return out;
}
