/**
 * HRM-02 pure leave math — no I/O. Days are working days (Mon–Fri), UTC calendar.
 */

const DAY_MS = 86_400_000;

const utcMidnight = (d: Date): number =>
  Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Working days (Mon–Fri) between start and end inclusive; 0 if end < start. */
export function leaveDays(start: Date, end: Date): number {
  const s = utcMidnight(start);
  const e = utcMidnight(end);
  if (e < s) return 0;
  let count = 0;
  for (let t = s; t <= e; t += DAY_MS) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

/** Inclusive date-range overlap. */
export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return utcMidnight(aStart) <= utcMidnight(bEnd) && utcMidnight(bStart) <= utcMidnight(aEnd);
}

/**
 * Balance gate: taking `days` must not push the balance negative unless the
 * organisation setting 'leave.allowNegative' is on.
 */
export function balanceAllows(entitledDays: number, usedDays: number, days: number, allowNegative: boolean): boolean {
  if (allowNegative) return true;
  return entitledDays - usedDays - days >= 0;
}
