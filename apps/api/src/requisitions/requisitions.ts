import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Injectable,
  NotFoundException, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { and, desc, eq, like, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../db/client';
import { AuditService } from '../audit/audit.service';
import { AuthGuard, CurrentUser, type AuthedUser } from '../auth/auth';
import { WorkflowService } from '../workflow/workflow.service';
import { canAct, canResubmit, canWithdraw, currentStageRole, type StageDef } from '../workflow/engine.logic';
import { evaluateBudgetCheck } from '../modules/money/budgets';

const LineSchema = z.object({
  description: z.string().min(1).max(300),
  qty: z.number().int().positive(),
  unitKobo: z.string().regex(/^\d+$/, 'unitKobo must be a non-negative integer string'),
  budgetLineId: z.string().optional().nullable(),
});
const CreateSchema = z.object({
  title: z.string().min(3).max(200),
  departmentId: z.string().optional(),
  donorCode: z.string().max(40).optional().nullable(),
  lines: z.array(LineSchema).min(1).max(50),
  submit: z.boolean().optional(),
});
const ActionSchema = z.object({
  verb: z.enum(['approve', 'reject', 'return']),
  comment: z.string().max(2000).optional(),
});

@Injectable()
export class RequisitionsService {
  constructor(private readonly audit: AuditService, private readonly workflow: WorkflowService) {}

  private async nextRef(prefix: string): Promise<string> {
    const year = new Date().getFullYear();
    const [row] = await db.select({ n: sql<number>`count(*)` })
      .from(schema.transactions).where(like(schema.transactions.ref, `${prefix}-${year}-%`));
    const seq = Number(row?.n ?? 0) + 1;
    return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
  }

  async create(user: AuthedUser, dto: z.infer<typeof CreateSchema>, ip?: string) {
    const departmentId = dto.departmentId ?? user.departmentId;
    if (!departmentId) throw new BadRequestException('No department: set one on the request or your profile');
    const type = await db.query.transactionTypes.findFirst({ where: eq(schema.transactionTypes.code, 'REQUISITION') });
    if (!type) throw new BadRequestException('REQUISITION transaction type is not configured');

    const amountKobo = dto.lines.reduce((sum, l) => sum + BigInt(l.qty) * BigInt(l.unitKobo), 0n);

    // REQ-02: check budgeted lines against available (allocated − committed − actual).
    // 'budget.checkMode' = 'block' rejects with per-line detail; 'warn' (default)
    // proceeds but surfaces warnings in the response and the audit trail.
    const budgetCheck = await evaluateBudgetCheck(dto.lines.map((l) => ({
      budgetLineId: l.budgetLineId ?? null,
      amountKobo: BigInt(l.qty) * BigInt(l.unitKobo),
    })));
    if (budgetCheck.violations.length > 0 && budgetCheck.mode === 'block') {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Budget check failed: one or more lines exceed the available budget',
        violations: budgetCheck.violations,
      });
    }

    const ref = await this.nextRef(type.refPrefix);
    const [tx] = await db.insert(schema.transactions).values({
      ref, typeCode: 'REQUISITION', title: dto.title, initiatorId: user.id,
      departmentId, amountKobo, donorCode: dto.donorCode ?? null, status: 'DRAFT',
    }).returning();
    await db.insert(schema.requisitionLines).values(dto.lines.map((l) => ({
      transactionId: tx.id, description: l.description, qty: l.qty,
      unitKobo: BigInt(l.unitKobo), budgetLineId: l.budgetLineId ?? null,
    })));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'TX_CREATED',
      entityType: 'transaction', entityId: ref,
      data: {
        title: dto.title, amountKobo: amountKobo.toString(), lines: dto.lines.length,
        ...(budgetCheck.violations.length > 0 ? { budgetWarnings: budgetCheck.violations } : {}),
      }, ip,
    });
    if (dto.submit) await this.workflow.submit(tx.id, user, ip);
    const detail = await this.get(tx.id, user);
    return budgetCheck.violations.length > 0
      ? { ...detail, budgetWarnings: budgetCheck.violations }
      : detail;
  }

  async list(user: AuthedUser, scope: 'mine' | 'queue' | 'all') {
    const rows = await db.query.transactions.findMany({
      where: eq(schema.transactions.typeCode, 'REQUISITION'),
      with: { initiator: { columns: { name: true } }, department: true, type: true, stageEvents: true },
      orderBy: [desc(schema.transactions.updatedAt)],
      limit: 200,
    });
    const actor = { id: user.id, roles: user.roles };
    const central = user.roles.some((r) =>
      ['INTERNAL_AUDIT', 'FINANCE', 'FINAL_APPROVER', 'SYSTEM_ADMIN'].includes(r.code));
    const filtered = rows.filter((tx) => {
      const chain = ((tx.payload as any)?.chain as StageDef[]) ?? (tx.type.stages as StageDef[]);
      const ctx = {
        id: tx.id, initiatorId: tx.initiatorId, departmentId: tx.departmentId,
        status: tx.status, currentStage: tx.currentStage,
        chain,
        priorApproverIds: tx.stageEvents.filter((e) => e.action === 'APPROVED').map((e) => e.actorId),
      };
      if (scope === 'mine') return tx.initiatorId === user.id;
      if (scope === 'queue') return canAct(actor, ctx).ok;
      // 'all': central roles see everything; others see their department's
      return central || tx.departmentId === user.departmentId || tx.initiatorId === user.id;
    });
    return filtered.map((tx) => {
      const chain = ((tx.payload as any)?.chain as StageDef[]) ?? (tx.type.stages as StageDef[]);
      return {
      id: tx.id, ref: tx.ref, title: tx.title, status: tx.status,
      currentStage: tx.currentStage, chain: chain.map((s) => s.role),
      stageRole: tx.status === 'PENDING' ? chain[tx.currentStage]?.role : null,
      amountKobo: tx.amountKobo.toString(), donorCode: tx.donorCode,
      department: tx.department.name, initiator: tx.initiator.name,
      submittedAt: tx.submittedAt, updatedAt: tx.updatedAt,
      };
    });
  }

  async get(txId: string, user: AuthedUser) {
    const tx = await db.query.transactions.findFirst({
      where: eq(schema.transactions.id, txId),
      with: {
        initiator: { columns: { id: true, name: true, title: true } },
        department: true, type: true,
        lines: { with: { budgetLine: true } },
        stageEvents: { with: { actor: { columns: { name: true } } } },
      },
    });
    if (!tx || tx.typeCode !== 'REQUISITION') throw new NotFoundException('Requisition not found');
    const payload = (tx.payload ?? {}) as { chain?: StageDef[]; autoPassed?: StageDef[] };
    const chain = payload.chain ?? (tx.type.stages as StageDef[]);
    const ctx = {
      id: tx.id, initiatorId: tx.initiatorId, departmentId: tx.departmentId,
      status: tx.status, currentStage: tx.currentStage, chain,
      priorApproverIds: tx.stageEvents.filter((e) => e.action === 'APPROVED').map((e) => e.actorId),
    };
    const actor = { id: user.id, roles: user.roles };
    return {
      id: tx.id, ref: tx.ref, title: tx.title, status: tx.status,
      currentStage: tx.currentStage, currentStageRole: currentStageRole(ctx),
      chain: chain.map((s) => s.role),
      // WFE-03: stages auto-passed under threshold, so the tracker never shows a silent gap
      autoPassed: (payload.autoPassed ?? []).map((s) => ({ role: s.role, minAmountKobo: s.minAmountKobo ?? null })),
      amountKobo: tx.amountKobo.toString(), currency: tx.currency, donorCode: tx.donorCode,
      department: { id: tx.departmentId, name: tx.department.name },
      initiator: tx.initiator, submittedAt: tx.submittedAt, createdAt: tx.createdAt,
      lines: tx.lines.map((l) => ({
        id: l.id, description: l.description, qty: l.qty, unitKobo: l.unitKobo.toString(),
        totalKobo: (BigInt(l.qty) * l.unitKobo).toString(),
        budgetLine: l.budgetLine ? { code: l.budgetLine.code, name: l.budgetLine.name } : null,
      })),
      history: tx.stageEvents
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((e) => ({
          action: e.action, stageIndex: e.stageIndex, role: e.role,
          actor: e.actor.name, comment: e.comment, at: e.createdAt,
        })),
      permissions: {
        canAct: canAct(actor, ctx).ok,
        canWithdraw: canWithdraw(actor, ctx).ok,
        canResubmit: canResubmit(actor, ctx).ok,
        canSubmit: tx.status === 'DRAFT' && tx.initiatorId === user.id,
      },
    };
  }
}

@Controller('v1/requisitions')
@UseGuards(AuthGuard)
export class RequisitionsController {
  constructor(private readonly svc: RequisitionsService, private readonly workflow: WorkflowService) {}

  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    const dto = CreateSchema.parse(body);
    return this.svc.create(user, dto, req.ip);
  }

  @Get()
  list(@CurrentUser() user: AuthedUser, @Query('scope') scope?: string) {
    const s = scope === 'queue' ? 'queue' : scope === 'all' ? 'all' : 'mine';
    return this.svc.list(user, s);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.svc.get(id, user);
  }

  @Post(':id/submit')
  async submit(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    await this.workflow.submit(id, user, req.ip);
    return this.svc.get(id, user);
  }

  @Post(':id/action')
  async action(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = ActionSchema.parse(body);
    await this.workflow.act(id, user, dto.verb, dto.comment, req.ip);
    return this.svc.get(id, user);
  }

  @Post(':id/resubmit')
  async resubmit(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    await this.workflow.resubmit(id, user, req.ip);
    return this.svc.get(id, user);
  }

  @Post(':id/withdraw')
  async withdraw(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    await this.workflow.withdraw(id, user, req.ip);
    return this.svc.get(id, user);
  }
}
