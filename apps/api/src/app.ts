import {
  Body, Controller, Get, Module, Param, Post, Query, Req, Res, UseGuards, UnauthorizedException,
} from '@nestjs/common';
import { and, desc, eq, gt, or } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from './db/client';
import { AuditService } from './audit/audit.service';
import { AuthGuard, AuthService, CurrentUser, RequireRoles, SESSION_COOKIE, type AuthedUser } from './auth/auth';
import { WorkflowService } from './workflow/workflow.service';
import { RequisitionsController, RequisitionsService } from './requisitions/requisitions';
import { canAct, type StageDef } from './workflow/engine.logic';

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const DelegationSchema = z.object({
  delegateId: z.string().min(1),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
});
const MAX_DELEGATION_DAYS = 30; // per SoD rules in the design's Roles & Permissions module

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(@Body() body: unknown, @Req() req: any, @Res({ passthrough: true }) res: any) {
    const dto = LoginSchema.parse(body);
    const { token, expiresAt } = await this.auth.login(dto.email, dto.password, req.ip);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: false /* true behind TLS in production */, expires: expiresAt, path: '/',
    });
    const user = await this.auth.resolveSession(token);
    return { user };
  }

  @Post('logout')
  async logout(@Req() req: any, @Res({ passthrough: true }) res: any) {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await this.auth.logout(token, req.user);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  async me(@Req() req: any) {
    const token = req.cookies?.[SESSION_COOKIE];
    const user = token ? await this.auth.resolveSession(token) : null;
    if (!user) throw new UnauthorizedException('Not signed in');
    return { user };
  }
}

@Controller('v1/meta')
@UseGuards(AuthGuard)
export class MetaController {
  @Get('departments')
  departments() {
    return db.select().from(schema.departments).orderBy(schema.departments.name);
  }

  @Get('budget-lines')
  budgetLines() {
    return db.query.budgetLines.findMany({ orderBy: [schema.budgetLines.code] })
      .then((rows) => rows.map((b) => ({ ...b, allocatedKobo: b.allocatedKobo.toString() })));
  }
}

@Controller('v1/dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  @Get()
  async summary(@CurrentUser() user: AuthedUser) {
    const rows = await db.query.transactions.findMany({
      with: { type: true, stageEvents: true, initiator: { columns: { name: true } }, department: true },
      orderBy: [desc(schema.transactions.updatedAt)], limit: 300,
    });
    const actor = { id: user.id, roles: user.roles };
    let queue = 0;
    const byStatus: Record<string, number> = {};
    for (const tx of rows) {
      byStatus[tx.status] = (byStatus[tx.status] ?? 0) + 1;
      const ctx = {
        id: tx.id, initiatorId: tx.initiatorId, departmentId: tx.departmentId,
        status: tx.status, currentStage: tx.currentStage, chain: tx.type.stages as StageDef[],
        priorApproverIds: tx.stageEvents.filter((e) => e.action === 'APPROVED').map((e) => e.actorId),
      };
      if (canAct(actor, ctx).ok) queue += 1;
    }
    const mine = rows.filter((t) => t.initiatorId === user.id);
    return {
      queueCount: queue,
      myOpen: mine.filter((t) => ['DRAFT', 'PENDING', 'RETURNED'].includes(t.status)).length,
      pipeline: byStatus,
      recent: rows.slice(0, 8).map((tx) => ({
        id: tx.id, ref: tx.ref, title: tx.title, status: tx.status,
        stageRole: tx.status === 'PENDING' ? (tx.type.stages as StageDef[])[tx.currentStage]?.role : null,
        currentStage: tx.currentStage, chainLength: (tx.type.stages as StageDef[]).length,
        amountKobo: tx.amountKobo.toString(), department: tx.department.name,
        initiator: tx.initiator.name, updatedAt: tx.updatedAt,
      })),
    };
  }
}

@Controller('v1/audit')
@UseGuards(AuthGuard)
@RequireRoles('SYSTEM_ADMIN', 'INTERNAL_AUDIT')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(@Query('limit') limit?: string) {
    const n = Math.min(Number(limit) || 100, 500);
    const rows = await db.select().from(schema.auditEvents).orderBy(desc(schema.auditEvents.id)).limit(n);
    return rows;
  }

  @Get('verify')
  verify() {
    return this.audit.verifyChain();
  }
}

@Controller('v1/delegations')
@UseGuards(AuthGuard)
export class DelegationsController {
  constructor(private readonly audit: AuditService) {}

  /** WFE-05: set a date-bounded delegate for my approval duties. */
  @Post()
  async create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    const dto = DelegationSchema.parse(body);
    if (dto.delegateId === user.id) throw new UnauthorizedException('You cannot delegate to yourself');
    if (dto.endsAt <= dto.startsAt) throw new UnauthorizedException('Delegation end must be after its start');
    const days = (dto.endsAt.getTime() - dto.startsAt.getTime()) / 86400_000;
    if (days > MAX_DELEGATION_DAYS) throw new UnauthorizedException(`Delegations are limited to ${MAX_DELEGATION_DAYS} days`);
    const delegate = await db.query.users.findFirst({ where: eq(schema.users.id, dto.delegateId) });
    if (!delegate || !delegate.active) throw new UnauthorizedException('Delegate not found or inactive');
    const [row] = await db.insert(schema.delegations).values({
      delegatorId: user.id, delegateId: dto.delegateId, startsAt: dto.startsAt, endsAt: dto.endsAt,
    }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'DELEGATION_SET', entityType: 'delegation', entityId: row.id,
      data: { delegate: delegate.name, startsAt: dto.startsAt.toISOString(), endsAt: dto.endsAt.toISOString() }, ip: req.ip,
    });
    return row;
  }

  /** My delegations — given and received, current or future. */
  @Get()
  async list(@CurrentUser() user: AuthedUser) {
    const now = new Date();
    const rows = await db.select().from(schema.delegations).where(and(
      or(eq(schema.delegations.delegatorId, user.id), eq(schema.delegations.delegateId, user.id)),
      gt(schema.delegations.endsAt, now),
    ));
    return rows;
  }

  @Post(':id/cancel')
  async cancel(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    const row = await db.query.delegations?.findFirst
      ? await db.query.delegations.findFirst({ where: eq(schema.delegations.id, id) })
      : (await db.select().from(schema.delegations).where(eq(schema.delegations.id, id)))[0];
    if (!row || row.delegatorId !== user.id) throw new UnauthorizedException('Only the delegator can cancel a delegation');
    await db.update(schema.delegations).set({ active: false }).where(eq(schema.delegations.id, id));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'DELEGATION_CANCELLED', entityType: 'delegation', entityId: id, ip: req.ip,
    });
    return { ok: true };
  }
}

@Module({
  controllers: [AuthController, MetaController, DashboardController, AuditController, RequisitionsController, DelegationsController],
  providers: [AuditService, AuthService, AuthGuard, WorkflowService, RequisitionsService],
})
export class AppModule {}
