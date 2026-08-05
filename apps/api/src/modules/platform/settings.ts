/**
 * ADM-04 — Platform settings. Key/value (jsonb) store with audit-logged changes.
 * SYSTEM_ADMIN writes; FINANCE may read (finance cares about sla/budget knobs).
 */
import {
  Body, Controller, Get, Injectable, NotFoundException, Param, Put, Req, UseGuards,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';

/** Platform defaults seeded once; admin-changed values are never overwritten by reseeds. */
export const PLATFORM_SETTING_DEFAULTS: Record<string, unknown> = {
  'sla.defaultHours': 24, // WFE-06: stage SLA when the stage def carries none
  'budget.checkMode': 'warn', // warn | block — budget module reads this
  'notify.defaultPref': 'instant', // instant | digest — per-user override at notify.prefs.<userId>
};

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
  return row ? (row.value as T) : fallback;
}

export async function seedSettings(): Promise<void> {
  for (const [key, value] of Object.entries(PLATFORM_SETTING_DEFAULTS)) {
    await db.insert(schema.settings).values({ key, value }).onConflictDoNothing();
  }
}

const SetSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.unknown()), z.array(z.unknown())]),
});

@Controller('v1/admin/settings')
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequireRoles('SYSTEM_ADMIN', 'FINANCE')
  list() {
    return db.select().from(schema.settings).orderBy(schema.settings.key);
  }

  @Get(':key')
  @RequireRoles('SYSTEM_ADMIN', 'FINANCE')
  async get(@Param('key') key: string) {
    const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
    if (!row) throw new NotFoundException(`No setting named ${key}`);
    return row;
  }

  /** Every change is audit-logged with old → new (ADM-04). */
  @Put(':key')
  @RequireRoles('SYSTEM_ADMIN')
  async set(@Param('key') key: string, @Body() body: unknown, @CurrentUser() user: AuthedUser, @Req() req: any) {
    const dto = SetSchema.parse(body);
    const existing = await db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
    let row;
    if (existing) {
      [row] = await db.update(schema.settings)
        .set({ value: dto.value as any, updatedById: user.id, updatedAt: new Date() })
        .where(eq(schema.settings.key, key)).returning();
    } else {
      [row] = await db.insert(schema.settings)
        .values({ key, value: dto.value as any, updatedById: user.id }).returning();
    }
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'SETTING_CHANGED',
      entityType: 'setting', entityId: key,
      data: { old: existing?.value ?? null, new: dto.value }, ip: req.ip,
    });
    return row;
  }
}
