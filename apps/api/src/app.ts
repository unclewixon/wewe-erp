import {
  Body, Controller, Get, Module, Post, Query, Req, Res, UseGuards, UnauthorizedException,
} from '@nestjs/common';
import { desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from './db/client';
import { AuditService } from './audit/audit.service';
import { AuthGuard, AuthService, CurrentUser, RequireRoles, SESSION_COOKIE, type AuthedUser } from './auth/auth';
import { WorkflowService } from './workflow/workflow.service';
import { RequisitionsController, RequisitionsService } from './requisitions/requisitions';
import { canAct, type StageDef } from './workflow/engine.logic';

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

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

@Module({
  controllers: [AuthController, MetaController, DashboardController, AuditController, RequisitionsController],
  providers: [AuditService, AuthService, AuthGuard, WorkflowService, RequisitionsService],
})
export class AppModule {}
