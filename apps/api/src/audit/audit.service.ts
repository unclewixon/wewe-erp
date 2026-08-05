import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { desc } from 'drizzle-orm';
import { db, schema } from '../db/client';

export interface AuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string; // e.g. AUTH_LOGIN, TX_SUBMITTED, TX_APPROVED
  entityType: string; // e.g. transaction, user, session
  entityId: string;
  data?: unknown;
  ip?: string | null;
}

/** Deterministic serialisation: recursively sorted keys, so hashes survive jsonb round-trips. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value as object).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as any)[k])}`).join(',')}}`;
}

/**
 * AUD-01 core: the ONLY write path to audit_events. Append-only and hash-chained —
 * each event's hash covers the previous event's hash, so tampering breaks the chain verifiably.
 */
@Injectable()
export class AuditService {
  async log(e: AuditEntry): Promise<void> {
    const data = e.data === undefined ? null : JSON.parse(JSON.stringify(e.data));
    const [last] = await db.select({ hash: schema.auditEvents.hash })
      .from(schema.auditEvents).orderBy(desc(schema.auditEvents.id)).limit(1);
    const prevHash = last?.hash ?? 'GENESIS';
    const payload = canonical({
      prevHash, actorId: e.actorId ?? null, action: e.action,
      entityType: e.entityType, entityId: e.entityId, data,
    });
    const hash = createHash('sha256').update(payload).digest('hex');
    await db.insert(schema.auditEvents).values({
      actorId: e.actorId ?? null, actorEmail: e.actorEmail ?? null,
      action: e.action, entityType: e.entityType, entityId: e.entityId,
      data, ip: e.ip ?? null, prevHash, hash,
    });
  }

  /** Recompute the chain over the latest `limit` events (full verification is a batch job later). */
  async verifyChain(limit = 2000): Promise<{ ok: boolean; checked: number; brokenAtId?: number }> {
    const rows = await db.select().from(schema.auditEvents).orderBy(schema.auditEvents.id).limit(limit);
    let prev = 'GENESIS';
    for (const r of rows) {
      if (r.prevHash !== prev) return { ok: false, checked: rows.length, brokenAtId: r.id };
      const payload = canonical({
        prevHash: r.prevHash, actorId: r.actorId, action: r.action,
        entityType: r.entityType, entityId: r.entityId, data: r.data,
      });
      const expect = createHash('sha256').update(payload).digest('hex');
      if (expect !== r.hash) return { ok: false, checked: rows.length, brokenAtId: r.id };
      prev = r.hash;
    }
    return { ok: true, checked: rows.length };
  }
}
