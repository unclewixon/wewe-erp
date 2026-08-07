/**
 * DMS-09: a person's own signature — drawn on the pad, typed, or uploaded — stored once
 * and reused at each signing ceremony.
 *
 * Two things this deliberately does NOT do. It does not put the image bytes in the audit
 * log: the log records that a signature was set, by whom, in what form and how large,
 * because a 5KB base64 blob repeated on every change makes the chain unreadable and
 * copies the specimen into a second place. And it does not accept a typed signature when
 * policy has turned typed signatures off — a policy that only the UI enforces is not a
 * policy, since the UI is not the only caller.
 */
import { BadRequestException, Body, Controller, Get, Injectable, Put, Req, UseGuards } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, type AuthedUser } from '../../auth/auth';
import { EsignSettingsService } from './esign-settings';

/** ~200KB of base64 is a generous signature and a mean upload. */
const MAX_DATA = 280_000;

const SignatureSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('drawn'),
    mime: z.string().max(120).default('image/png'),
    dataBase64: z.string().min(1).max(MAX_DATA),
  }),
  z.object({
    method: z.literal('uploaded'),
    mime: z.string().max(120),
    dataBase64: z.string().min(1).max(MAX_DATA),
  }),
  z.object({
    method: z.literal('typed'),
    typed: z.string().min(1).max(120),
    font: z.string().max(40).optional(),
  }),
]);

@Injectable()
export class SignatureService {
  constructor(private readonly audit: AuditService, private readonly settings: EsignSettingsService) {}

  async read(user: AuthedUser) {
    const row = await db.query.users.findFirst({ where: eq(schema.users.id, user.id) });
    if (!row?.signatureMethod) return { method: null };
    return {
      method: row.signatureMethod,
      mime: row.signatureMime,
      dataBase64: row.signatureData,
      typed: row.signatureTyped,
      font: row.signatureFont,
      updatedAt: row.signatureUpdatedAt?.toISOString() ?? null,
    };
  }

  async write(user: AuthedUser, body: unknown, ip?: string) {
    const dto = SignatureSchema.parse(body);

    if (dto.method === 'typed') {
      const policy = await this.settings.read();
      if (!policy.allowTyped)
        throw new BadRequestException('Typed signatures are not accepted — draw or upload your signature instead.');
    }

    const before = await this.read(user);
    const isImage = dto.method !== 'typed';
    await db.update(schema.users).set({
      signatureMethod: dto.method,
      signatureMime: isImage ? dto.mime : null,
      signatureData: isImage ? dto.dataBase64 : null,
      signatureTyped: dto.method === 'typed' ? dto.typed : null,
      signatureFont: dto.method === 'typed' ? (dto.font ?? null) : null,
      signatureUpdatedAt: new Date(),
    }).where(eq(schema.users.id, user.id));

    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'SIGNATURE_SET',
      entityType: 'user', entityId: user.id,
      // Shape and size only — never the specimen itself.
      data: {
        method: dto.method,
        replaced: before.method ?? null,
        bytes: isImage ? dto.dataBase64.length : undefined,
        font: dto.method === 'typed' ? (dto.font ?? null) : undefined,
      },
      ip,
    });
    return this.read(user);
  }
}

@Controller('v1/esign/signature')
@UseGuards(AuthGuard)
export class SignatureController {
  constructor(private readonly svc: SignatureService) {}

  /** Your own signature only — there is no route to read anyone else's specimen. */
  @Get()
  read(@CurrentUser() user: AuthedUser) {
    return this.svc.read(user);
  }

  @Put()
  write(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    return this.svc.write(user, body, req.ip);
  }
}
