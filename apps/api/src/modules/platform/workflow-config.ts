/**
 * WFE-10 (backend) — workflow configuration: transaction types and their stage chains.
 * SYSTEM_ADMIN only; every change audited as WORKFLOW_CONFIG_CHANGED with a diff.
 *
 * Publishing applies to NEW transactions only — already true by design: chains are
 * resolved and frozen into transactions.payload.chain at submission (WFE-03), so
 * in-flight approvals never re-route. The response says so explicitly.
 */
import {
  BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';

const StageSchema = z.object({
  role: z.enum(schema.roleCode.enumValues), // roles must be valid RoleCode values
  minAmountKobo: z.string().regex(/^\d+$/, 'minAmountKobo must be a digit string (kobo)').optional(),
  slaHours: z.number().int().positive().optional(),
});
const CreateTypeSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'code must be UPPER_SNAKE'),
  name: z.string().min(3).max(120),
  refPrefix: z.string().regex(/^[A-Z]{2,8}$/, 'refPrefix must be 2-8 capital letters'),
  stages: z.array(StageSchema).min(1, 'at least one approval stage is required').max(10),
});
const UpdateTypeSchema = z.object({
  name: z.string().min(3).max(120).optional(),
  refPrefix: z.string().regex(/^[A-Z]{2,8}$/).optional(),
  stages: z.array(StageSchema).min(1).max(10).optional(),
});

const PUBLISH_NOTE =
  'Applies to NEW transactions only: submitted transactions carry their approval chain frozen at submission (WFE-03), so in-flight approvals are unaffected.';

@Controller('v1/admin/transaction-types')
@UseGuards(AuthGuard)
@RequireRoles('SYSTEM_ADMIN')
export class WorkflowConfigController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list() {
    return db.select().from(schema.transactionTypes).orderBy(schema.transactionTypes.code);
  }

  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: AuthedUser, @Req() req: any) {
    const dto = CreateTypeSchema.parse(body);
    const existing = await db.query.transactionTypes.findFirst({ where: eq(schema.transactionTypes.code, dto.code) });
    if (existing) throw new BadRequestException(`Transaction type ${dto.code} already exists`);
    const [row] = await db.insert(schema.transactionTypes).values({
      code: dto.code, name: dto.name, refPrefix: dto.refPrefix, stages: dto.stages as any,
    }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'WORKFLOW_CONFIG_CHANGED',
      entityType: 'transaction_type', entityId: dto.code,
      data: { before: null, after: { name: dto.name, refPrefix: dto.refPrefix, stages: dto.stages } }, ip: req.ip,
    });
    return { type: row, note: PUBLISH_NOTE };
  }

  @Put(':code')
  async update(@Param('code') code: string, @Body() body: unknown, @CurrentUser() user: AuthedUser, @Req() req: any) {
    const dto = UpdateTypeSchema.parse(body);
    const existing = await db.query.transactionTypes.findFirst({ where: eq(schema.transactionTypes.code, code) });
    if (!existing) throw new NotFoundException(`Transaction type ${code} not found`);
    if (dto.name === undefined && dto.refPrefix === undefined && dto.stages === undefined) {
      throw new BadRequestException('Nothing to update');
    }
    const [row] = await db.update(schema.transactionTypes).set({
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.refPrefix !== undefined ? { refPrefix: dto.refPrefix } : {}),
      ...(dto.stages !== undefined ? { stages: dto.stages as any } : {}),
    }).where(eq(schema.transactionTypes.code, code)).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'WORKFLOW_CONFIG_CHANGED',
      entityType: 'transaction_type', entityId: code,
      data: {
        before: { name: existing.name, refPrefix: existing.refPrefix, stages: existing.stages },
        after: { name: row.name, refPrefix: row.refPrefix, stages: row.stages },
      }, ip: req.ip,
    });
    return { type: row, note: PUBLISH_NOTE };
  }
}
