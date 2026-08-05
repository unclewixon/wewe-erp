/**
 * OPERATIONS — pure logic (no I/O). Covers:
 *  - PRC-02 quote threshold bands (settings key 'procurement.thresholds')
 *  - PRC-03 goods-receipt application + PO status transitions, order-splitting detection
 *  - PRC-01 vendor due-diligence status
 *  - AST-02 straight-line monthly depreciation
 * Everything here is unit-tested in ops.logic.spec.ts.
 */

// ---------- PRC-02: procurement threshold bands ----------

export type ThresholdBand = {
  /** Band applies while amountKobo < maxKobo (string BigInt). Absent = open-ended top band. */
  maxKobo?: string;
  minQuotes: number;
  /** Top band: selection additionally requires a procurement-committee note. */
  committeeNote?: boolean;
};

/** Seed default: below ₦100,000 → 1 quote; to ₦1,000,000 → 3 quotes; above → 3 quotes + committee note. */
export const DEFAULT_THRESHOLDS: ThresholdBand[] = [
  { maxKobo: '10000000', minQuotes: 1 },
  { maxKobo: '100000000', minQuotes: 3 },
  { minQuotes: 3, committeeNote: true },
];

/** First band whose upper bound exceeds the amount; the open-ended band catches the rest. */
export function bandFor(thresholds: ThresholdBand[], amountKobo: bigint): ThresholdBand {
  for (const band of thresholds) {
    if (band.maxKobo === undefined || amountKobo < BigInt(band.maxKobo)) return band;
  }
  return thresholds[thresholds.length - 1];
}

export function quoteRequirement(
  thresholds: ThresholdBand[],
  amountKobo: bigint,
  quoteCount: number,
  opts: { soleSource?: boolean; committeeNote?: boolean } = {},
): { ok: true } | { ok: false; reason: string } {
  const band = bandFor(thresholds, amountKobo);
  if (band.committeeNote && !opts.committeeNote) {
    return { ok: false, reason: 'A procurement-committee note is required for selections in this amount band' };
  }
  if (quoteCount < band.minQuotes && !opts.soleSource) {
    return {
      ok: false,
      reason: `This amount band requires at least ${band.minQuotes} quote(s) — you have ${quoteCount}. ` +
        `Add more quotes or provide a sole-source justification ('soleSource').`,
    };
  }
  return { ok: true };
}

// ---------- PRC-03: goods receipt against PO lines ----------

export type PoLine = { description: string; qty: number; unitKobo: string; receivedQty?: number };
export type ReceiptLine = { lineIndex: number; qty: number };
export type PoStatus = 'OPEN' | 'PARTIAL' | 'CLOSED';

/**
 * Apply a (possibly partial) goods receipt to PO lines. Throws Error with a
 * human-readable message on invalid input; callers map that to HTTP 400.
 */
export function applyReceipt(lines: PoLine[], receipt: ReceiptLine[]): { lines: PoLine[]; status: PoStatus } {
  if (!receipt.length) throw new Error('A receipt needs at least one line');
  const next = lines.map((l) => ({ ...l, receivedQty: l.receivedQty ?? 0 }));
  for (const r of receipt) {
    if (!Number.isInteger(r.qty) || r.qty <= 0) throw new Error('Received qty must be a positive integer');
    const line = next[r.lineIndex];
    if (!line) throw new Error(`Line index ${r.lineIndex} does not exist on this PO`);
    if (line.receivedQty + r.qty > line.qty) {
      throw new Error(
        `Line ${r.lineIndex} (${line.description}): receiving ${r.qty} would exceed ordered qty ` +
        `${line.qty} (already received ${line.receivedQty})`,
      );
    }
    line.receivedQty += r.qty;
  }
  const allReceived = next.every((l) => l.receivedQty >= l.qty);
  const anyReceived = next.some((l) => (l.receivedQty ?? 0) > 0);
  return { lines: next, status: allReceived ? 'CLOSED' : anyReceived ? 'PARTIAL' : 'OPEN' };
}

// ---------- PRC-03: order-splitting detection ----------

export type PoForSplit = { ref: string; vendorId: string; vendorName?: string; category: string; totalKobo: bigint; issuedAt: Date };
export type SplitFlag = {
  vendorId: string; vendorName?: string; category: string;
  refs: string[]; count: number; totalKobo: string;
  windowStart: Date; windowEnd: Date;
};

/**
 * Same vendor + category purchases inside any rolling `windowDays` window whose
 * aggregate exceeds the single-quote threshold → flag (possible order splitting).
 * Windows of a single PO are not flagged (a lone large PO went through quoting rules).
 */
export function orderSplittingFlags(pos: PoForSplit[], singleQuoteMaxKobo: bigint, windowDays = 30): SplitFlag[] {
  const groups = new Map<string, PoForSplit[]>();
  for (const po of pos) {
    const key = `${po.vendorId}::${po.category}`;
    const list = groups.get(key) ?? [];
    list.push(po);
    groups.set(key, list);
  }
  const windowMs = windowDays * 86400_000;
  const flags: SplitFlag[] = [];
  const seen = new Set<string>();
  for (const list of groups.values()) {
    list.sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime());
    for (let i = 0; i < list.length; i++) {
      const windowPos: PoForSplit[] = [];
      for (let j = i; j < list.length; j++) {
        if (list[j].issuedAt.getTime() - list[i].issuedAt.getTime() < windowMs) windowPos.push(list[j]);
        else break;
      }
      if (windowPos.length < 2) continue;
      const total = windowPos.reduce((s, p) => s + p.totalKobo, 0n);
      if (total <= singleQuoteMaxKobo) continue;
      const key = windowPos.map((p) => p.ref).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      flags.push({
        vendorId: windowPos[0].vendorId, vendorName: windowPos[0].vendorName,
        category: windowPos[0].category,
        refs: windowPos.map((p) => p.ref), count: windowPos.length, totalKobo: total.toString(),
        windowStart: windowPos[0].issuedAt, windowEnd: windowPos[windowPos.length - 1].issuedAt,
      });
    }
  }
  return flags;
}

// ---------- PRC-01: vendor due-diligence status ----------

export type DueDiligence = { cacDocId?: string | null; taxClearanceDocId?: string | null; expiresAt?: string | null };
export type DueDiligenceStatus = 'COMPLETE' | 'EXPIRED' | 'INCOMPLETE';

export function dueDiligenceStatus(dd: unknown, now: Date): DueDiligenceStatus {
  const d = (dd ?? {}) as DueDiligence;
  const docsPresent = Boolean(d.cacDocId) && Boolean(d.taxClearanceDocId);
  if (!docsPresent) return 'INCOMPLETE';
  if (d.expiresAt && new Date(d.expiresAt).getTime() <= now.getTime()) return 'EXPIRED';
  return 'COMPLETE';
}

// ---------- AST: straight-line monthly depreciation ----------

/** Full calendar months elapsed between two instants (never negative). */
export function monthsBetween(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) return 0;
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

export type Depreciation = { monthlyKobo: bigint; accumulatedKobo: bigint; nbvKobo: bigint };

/**
 * Straight-line monthly: monthly = cost / life (integer kobo, floor); once the
 * asset's life is fully elapsed the whole cost is depreciated (the final month
 * absorbs the integer-division remainder), so NBV hits exactly zero.
 */
export function straightLine(costKobo: bigint, usefulLifeMonths: number, monthsElapsed: number): Depreciation {
  if (usefulLifeMonths <= 0 || costKobo <= 0n) {
    return { monthlyKobo: 0n, accumulatedKobo: 0n, nbvKobo: costKobo < 0n ? 0n : costKobo };
  }
  const monthlyKobo = costKobo / BigInt(usefulLifeMonths);
  const accumulatedKobo = monthsElapsed >= usefulLifeMonths ? costKobo : monthlyKobo * BigInt(Math.max(0, monthsElapsed));
  return { monthlyKobo, accumulatedKobo, nbvKobo: costKobo - accumulatedKobo };
}

/** Seed default useful lives per asset category (settings key 'assets.categories'). */
export const DEFAULT_ASSET_CATEGORIES: { category: string; usefulLifeMonths: number }[] = [
  { category: 'IT_EQUIPMENT', usefulLifeMonths: 36 },
  { category: 'FURNITURE', usefulLifeMonths: 60 },
  { category: 'VEHICLE', usefulLifeMonths: 60 },
  { category: 'GENERATOR', usefulLifeMonths: 48 },
  { category: 'OFFICE_EQUIPMENT', usefulLifeMonths: 48 },
  { category: 'OTHER', usefulLifeMonths: 36 },
];
