/** Small shared helpers for the ops module (refs, settings lookups, zod primitives). */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import type { WorkflowService } from '../../workflow/workflow.service';
import { DEFAULT_ASSET_CATEGORIES, DEFAULT_THRESHOLDS, type ThresholdBand } from './ops.logic';

/** Non-negative integer kobo amount as a string ("125000000"). */
export const KoboString = z.string().regex(/^\d+$/, 'amount must be a non-negative integer kobo string');

/**
 * Ref for rows living OUTSIDE the transactions table (rfqs / purchase_orders / contracts).
 * Starts from WorkflowService.nextRef (canonical PREFIX-YYYY-NNNN format) and bumps the
 * sequence past refs already taken in the target table — nextRef only counts transactions.
 */
export async function tableRef(
  workflow: WorkflowService, prefix: string, taken: (ref: string) => Promise<boolean>,
): Promise<string> {
  let ref = await workflow.nextRef(prefix);
  const m = ref.match(/^(.*-)(\d+)$/);
  let n = m ? Number(m[2]) : 1;
  const stem = m ? m[1] : `${prefix}-${new Date().getFullYear()}-`;
  while (await taken(ref)) {
    n += 1;
    ref = `${stem}${String(n).padStart(4, '0')}`;
  }
  return ref;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
  return (row?.value as T) ?? fallback;
}

export function loadThresholds(): Promise<ThresholdBand[]> {
  return getSetting<ThresholdBand[]>('procurement.thresholds', DEFAULT_THRESHOLDS);
}

/** category → default useful life in months, from settings 'assets.categories'. */
export async function loadCategoryLives(): Promise<Map<string, number>> {
  const rows = await getSetting<{ category: string; usefulLifeMonths: number }[]>(
    'assets.categories', DEFAULT_ASSET_CATEGORIES,
  );
  return new Map(rows.map((r) => [r.category, r.usefulLifeMonths]));
}
