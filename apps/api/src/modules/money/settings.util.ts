import { eq } from 'drizzle-orm';
import { db, schema } from '../../db/client';
import type { PerDiemRates } from './money.logic';

/** Settings keys the money area reads, with their defaults (seeded by seedDefaults). */
export const MONEY_SETTING_DEFAULTS = {
  /** REQ-02: 'block' → 400 on over-budget lines; 'warn' → proceed with warnings. */
  'budget.checkMode': 'warn' as 'block' | 'warn',
  /** ADV-02: nightly per-diem rate table, grade → locationCategory → kobo string. */
  'travel.perDiemRates': {
    DEFAULT: { STANDARD: '2500000', HIGH_COST: '4000000' },
    SENIOR: { STANDARD: '3500000', HIGH_COST: '5500000' },
  } as PerDiemRates,
  /** ADV-03: days after disbursement (or travel end) before retirement is due. */
  'advance.retirementDays': 5,
  /** ADV-04: refuse a new advance while the requester has one overdue. */
  'advance.blockOnOverdue': true,
  /** QBI: 'sandbox' posts locally with QB-SANDBOX refs; 'live' awaits real OAuth. */
  'qb.mode': 'sandbox' as 'sandbox' | 'live',
};
export type MoneySettingKey = keyof typeof MONEY_SETTING_DEFAULTS;

/** Read a setting with its money-area default when unset. */
export async function getSetting<K extends MoneySettingKey>(key: K): Promise<(typeof MONEY_SETTING_DEFAULTS)[K]> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
  if (!row || row.value === null || row.value === undefined) return MONEY_SETTING_DEFAULTS[key];
  return row.value as (typeof MONEY_SETTING_DEFAULTS)[K];
}
