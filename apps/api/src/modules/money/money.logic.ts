/**
 * Pure MONEY-area computation (BUD-01..03, REQ-02, ADV-01..04, RET-01..05).
 * No I/O — everything here is unit-testable with vitest. DB-wired services call these.
 * All amounts are BigInt kobo (ADR-001).
 */

/* ---------------------------------------------------------------- budgets */

/** One committed/actual contributor against a budget line (a requisition line or an advance). */
export interface UsageEntry {
  budgetLineId: string | null;
  /** transaction status of the parent transaction */
  status: string;
  amountKobo: bigint;
}

export interface LineUsage {
  committedKobo: bigint; // PENDING transactions
  actualKobo: bigint; // APPROVED transactions
}

/**
 * BUD-03 commitment accounting: PENDING amounts are commitments, APPROVED amounts
 * are actuals; every other status contributes nothing.
 */
export function accumulateUsage(entries: UsageEntry[]): Map<string, LineUsage> {
  const map = new Map<string, LineUsage>();
  for (const e of entries) {
    if (!e.budgetLineId) continue;
    if (e.status !== 'PENDING' && e.status !== 'APPROVED') continue;
    const u = map.get(e.budgetLineId) ?? { committedKobo: 0n, actualKobo: 0n };
    if (e.status === 'PENDING') u.committedKobo += e.amountKobo;
    else u.actualKobo += e.amountKobo;
    map.set(e.budgetLineId, u);
  }
  return map;
}

export interface BudgetPosition {
  allocatedKobo: bigint;
  committedKobo: bigint;
  actualKobo: bigint;
  availableKobo: bigint; // allocated − committed − actual (may be negative)
}

export function budgetPosition(allocatedKobo: bigint, usage?: LineUsage): BudgetPosition {
  const committedKobo = usage?.committedKobo ?? 0n;
  const actualKobo = usage?.actualKobo ?? 0n;
  return { allocatedKobo, committedKobo, actualKobo, availableKobo: allocatedKobo - committedKobo - actualKobo };
}

/** A requested spend against a budget line (one requisition line, already qty×unit). */
export interface BudgetRequest {
  index: number; // position in the submitted lines array, for per-line error detail
  budgetLineId: string | null;
  amountKobo: bigint;
}

export interface BudgetViolation {
  index: number;
  budgetLineId: string;
  requestedKobo: bigint; // cumulative request against the line up to and including this entry
  availableKobo: bigint;
  shortfallKobo: bigint;
}

/**
 * REQ-02: check requested amounts against available budget. Requests against the
 * same line accumulate — the first entry that pushes the running total past the
 * line's available amount (and each subsequent one) is a violation.
 * Lines without a budgetLineId, or whose line has no known position, pass silently.
 */
export function checkAgainstAvailable(
  requests: BudgetRequest[],
  availableByLine: Map<string, bigint>,
): BudgetViolation[] {
  const running = new Map<string, bigint>();
  const violations: BudgetViolation[] = [];
  for (const r of requests) {
    if (!r.budgetLineId) continue;
    const available = availableByLine.get(r.budgetLineId);
    if (available === undefined) continue;
    const total = (running.get(r.budgetLineId) ?? 0n) + r.amountKobo;
    running.set(r.budgetLineId, total);
    if (total > available) {
      violations.push({
        index: r.index, budgetLineId: r.budgetLineId,
        requestedKobo: total, availableKobo: available, shortfallKobo: total - available,
      });
    }
  }
  return violations;
}

/* -------------------------------------------------------------- virements */

/**
 * BUD-02: a virement may not take the source line's allocation below what is
 * already committed + actual (i.e. available after transfer must stay ≥ 0).
 */
export function virementCheck(
  sourceAllocatedKobo: bigint,
  sourceUsage: LineUsage | undefined,
  amountKobo: bigint,
): { ok: boolean; availableKobo: bigint; reason?: string } {
  const available = budgetPosition(sourceAllocatedKobo, sourceUsage).availableKobo;
  if (amountKobo <= 0n) return { ok: false, availableKobo: available, reason: 'Virement amount must be positive' };
  if (amountKobo > available) {
    return {
      ok: false, availableKobo: available,
      reason: `Virement of ${amountKobo} kobo would take the source line below its committed/actual spend (available ${available} kobo)`,
    };
  }
  return { ok: true, availableKobo: available };
}

/* ------------------------------------------------------- advances / travel */

/** Rate table shape for settings key 'travel.perDiemRates': grade → locationCategory → kobo string. */
export type PerDiemRates = Record<string, Record<string, string>>;

export const DEFAULT_GRADE = 'DEFAULT';
export const DEFAULT_LOCATION_CATEGORY = 'STANDARD';

/**
 * ADV-02: resolve the nightly per-diem for a staff grade and location category.
 * Falls back to the DEFAULT grade row and the STANDARD category. Returns null
 * when the table has no applicable rate at all.
 */
export function perDiemFor(
  rates: PerDiemRates,
  grade: string | null | undefined,
  locationCategory: string | null | undefined,
): bigint | null {
  const gradeRow = (grade && rates[grade]) || rates[DEFAULT_GRADE];
  if (!gradeRow) return null;
  const raw = (locationCategory && gradeRow[locationCategory]) || gradeRow[DEFAULT_LOCATION_CATEGORY];
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  return BigInt(raw);
}

/** Nights between two dates (UTC midnight difference); a same-day trip is 0 nights. */
export function computeNights(startDate: Date, endDate: Date): number {
  const dayMs = 86_400_000;
  const start = Math.floor(startDate.getTime() / dayMs);
  const end = Math.floor(endDate.getTime() / dayMs);
  return Math.max(0, end - start);
}

export function travelPerDiemTotal(nights: number, perDiemKobo: bigint): bigint {
  return BigInt(nights) * perDiemKobo;
}

/**
 * ADV-03: retirement deadline = later of disbursement date and travel end date,
 * plus N days (settings 'advance.retirementDays'; simple calendar +N per spec).
 */
export function retirementDeadline(disbursedAt: Date, travelEndDate: Date | null, days: number): Date {
  const base = travelEndDate && travelEndDate.getTime() > disbursedAt.getTime() ? travelEndDate : disbursedAt;
  return new Date(base.getTime() + days * 86_400_000);
}

/** ADV-04 outstanding register: age (days since disbursement) and overdue flag. */
export function advanceAging(
  disbursedAt: Date, deadline: Date | null, now: Date,
): { ageDays: number; overdue: boolean } {
  const ageDays = Math.max(0, Math.floor((now.getTime() - disbursedAt.getTime()) / 86_400_000));
  const overdue = deadline !== null && now.getTime() > deadline.getTime();
  return { ageDays, overdue };
}

/* ------------------------------------------------------------ retirements */

/**
 * RET-02 variance math, computed against the advance's outstanding balance at
 * retirement time. variance = total − balance (negative = under-spent);
 * refundDue = the under-spend, i.e. balance − total when total < balance.
 * Freestanding reimbursements (no advance) pass balance 0n → variance = total, no refund.
 */
export function retirementFigures(balanceKobo: bigint, totalKobo: bigint): {
  varianceKobo: bigint; refundDueKobo: bigint;
} {
  const varianceKobo = totalKobo - balanceKobo;
  const refundDueKobo = totalKobo < balanceKobo ? balanceKobo - totalKobo : 0n;
  return { varianceKobo, refundDueKobo };
}

/**
 * RET-03 partial retirement: an approved retirement reduces the advance balance
 * by what it accounts for (never below zero); at zero the advance closes.
 */
export function applyRetirement(balanceKobo: bigint, totalKobo: bigint): {
  newBalanceKobo: bigint; closed: boolean;
} {
  const reduction = totalKobo < balanceKobo ? totalKobo : balanceKobo;
  const newBalanceKobo = balanceKobo - reduction;
  return { newBalanceKobo, closed: newBalanceKobo === 0n };
}

export function sumLineAmounts(lines: { amountKobo: bigint }[]): bigint {
  return lines.reduce((s, l) => s + l.amountKobo, 0n);
}
