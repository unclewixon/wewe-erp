import { eq } from 'drizzle-orm';
import { db, schema } from '../../db/client';

/** Read a settings row's jsonb value, or null when unset. */
export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
  return row ? (row.value as T) : null;
}

/** Idempotent seed: insert only if the key is not already configured (never clobbers admin edits). */
export async function seedSetting(key: string, value: unknown): Promise<void> {
  await db.insert(schema.settings).values({ key, value: value as object })
    .onConflictDoNothing({ target: schema.settings.key });
}
