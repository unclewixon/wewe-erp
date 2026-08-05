/**
 * TLS-01 pure validation — no I/O.
 */

export interface TimesheetRow {
  projectCode: string;
  percent: number;
}

export type RowsVerdict = { ok: true } | { ok: false; reason: string };

/** Rows must be non-empty, integer percents 1–100, unique project codes, totalling exactly 100. */
export function validateTimesheetRows(rows: TimesheetRow[]): RowsVerdict {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, reason: 'At least one row is required' };
  if (rows.length > 30) return { ok: false, reason: 'Too many rows (max 30)' };
  const seen = new Set<string>();
  let total = 0;
  for (const r of rows) {
    const code = (r.projectCode ?? '').trim();
    if (!code) return { ok: false, reason: 'Every row needs a projectCode' };
    if (seen.has(code)) return { ok: false, reason: `Duplicate projectCode ${code}` };
    seen.add(code);
    if (!Number.isInteger(r.percent) || r.percent < 1 || r.percent > 100)
      return { ok: false, reason: 'Each percent must be an integer between 1 and 100' };
    total += r.percent;
  }
  if (total !== 100) return { ok: false, reason: `Percentages must total exactly 100 (got ${total})` };
  return { ok: true };
}
