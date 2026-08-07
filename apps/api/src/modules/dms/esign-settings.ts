/**
 * DMS-08: e-signature policy — how long a request stays open, when signatories are
 * chased, whether a second factor is demanded before signing, whether externals get a
 * watermark, and whether a typed signature is acceptable at all.
 *
 * Policy that cannot be saved is not policy, so this persists to settings and every
 * change is audited with what it was before. Reads are open to any signed-in user
 * because the ceremony needs them; writing is an administrative act.
 */
import { Body, Controller, Get, Injectable, Put, Req, UseGuards } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';

export const ESIGN_SETTINGS_KEY = 'esign.policy';
export const ESIGN_DEFAULTS = {
  defaultExpiryDays: 30,
  remindAfterDays: 3,
  requireTwoFactor: true,
  watermarkExternal: true,
  allowTyped: true,
};

const SettingsSchema = z.object({
  defaultExpiryDays: z.number().int().min(1).max(365),
  remindAfterDays: z.number().int().min(0).max(90),
  requireTwoFactor: z.boolean(),
  watermarkExternal: z.boolean(),
  allowTyped: z.boolean(),
}).refine((s) => s.remindAfterDays === 0 || s.remindAfterDays < s.defaultExpiryDays, {
  message: 'A reminder after the request has already expired would never be sent',
});

@Injectable()
export class EsignSettingsService {
  constructor(private readonly audit: AuditService) {}

  async read() {
    const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, ESIGN_SETTINGS_KEY) });
    return { ...ESIGN_DEFAULTS, ...((row?.value as object) ?? {}) };
  }

  async write(user: AuthedUser, dto: z.infer<typeof SettingsSchema>, ip?: string) {
    const before = await this.read();
    const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, ESIGN_SETTINGS_KEY) });
    if (row) {
      await db.update(schema.settings).set({ value: dto, updatedById: user.id, updatedAt: new Date() })
        .where(eq(schema.settings.key, ESIGN_SETTINGS_KEY));
    } else {
      await db.insert(schema.settings).values({ key: ESIGN_SETTINGS_KEY, value: dto, updatedById: user.id });
    }
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'ESIGN_POLICY_UPDATED',
      entityType: 'settings', entityId: ESIGN_SETTINGS_KEY,
      // before and after together: a policy change is only meaningful against what it replaced.
      data: { before, after: dto }, ip,
    });
    return this.read();
  }
}

@Controller('v1/esign/settings')
@UseGuards(AuthGuard)
export class EsignSettingsController {
  constructor(private readonly svc: EsignSettingsService) {}

  @Get()
  read() { return this.svc.read(); }

  @Put()
  @RequireRoles('SYSTEM_ADMIN')
  write(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    return this.svc.write(user, SettingsSchema.parse(body), req.ip);
  }
}
