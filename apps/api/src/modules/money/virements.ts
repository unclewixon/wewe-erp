import {
  BadRequestException, Body, Controller, Get, Injectable, NotFoundException,
  Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, type AuthedUser } from '../../auth/auth';
import { WorkflowService, type ApprovalHook } from '../../workflow/workflow.service';
import { accumulateUsage, virementCheck } from './money.logic';
import { collectUsageEntries, computePositions } from './budgets';

const CreateVirementSchema = z.object({
  sourceLineId: z.string().min(1),
  destLineId: z.string().min(1),
  amountKobo: z.string().regex(/^[1-9]\d*$/, 'amountKobo must be a positive integer kobo string'),
  reason: z.string().max(500).optional(),
  submit: z.boolean().optional(),
});

interface VirementPayload {
  sourceLineId: string; destLineId: string; amountKobo: string;
  reason?: string; virementApplied?: boolean;
}

@Injectable()
export class VirementsService {
  constructor(private readonly audit: AuditService, private readonly workflow: WorkflowService) {}

  /** BUD-02: a virement is an approval-routed transaction (FINANCE → FINAL_APPROVER). */
  async create(user: AuthedUser, dto: z.infer<typeof CreateVirementSchema>, ip?: string) {
    if (dto.sourceLineId === dto.destLineId)
      throw new BadRequestException('Source and destination budget lines must differ');
    const source = await db.query.budgetLines.findFirst({ where: eq(schema.budgetLines.id, dto.sourceLineId) });
    const dest = await db.query.budgetLines.findFirst({ where: eq(schema.budgetLines.id, dto.destLineId) });
    if (!source) throw new BadRequestException('Source budget line not found');
    if (!dest) throw new BadRequestException('Destination budget line not found');
    if (source.fiscalYear !== dest.fiscalYear)
      throw new BadRequestException('Virements must stay within one fiscal year');
    const amount = BigInt(dto.amountKobo);
    // Early feasibility check (the hook re-checks at approval time, when it matters)
    const position = (await computePositions([source.id])).get(source.id)!;
    if (amount > position.availableKobo) {
      throw new BadRequestException({
        message: 'Virement exceeds the source line\'s available budget',
        sourceLineId: source.id, code: source.code,
        requestedKobo: amount.toString(), availableKobo: position.availableKobo.toString(),
      });
    }
    const payload: VirementPayload = {
      sourceLineId: source.id, destLineId: dest.id, amountKobo: dto.amountKobo,
      ...(dto.reason ? { reason: dto.reason } : {}),
    };
    const tx = await this.workflow.createTransaction(user, {
      typeCode: 'VIREMENT',
      title: `Virement ${source.code} → ${dest.code}`,
      amountKobo: amount,
      departmentId: source.departmentId,
      donorCode: source.donorCode,
      payload,
      submit: dto.submit,
      ip,
    });
    return this.get(tx.id);
  }

  async list(fiscalYear?: number) {
    const rows = await db.query.transactions.findMany({
      where: eq(schema.transactions.typeCode, 'VIREMENT'),
      with: { initiator: { columns: { name: true } }, department: true },
      orderBy: [desc(schema.transactions.updatedAt)],
      limit: 200,
    });
    const out = [];
    for (const tx of rows) {
      const p = (tx.payload ?? {}) as VirementPayload;
      const source = p.sourceLineId
        ? await db.query.budgetLines.findFirst({ where: eq(schema.budgetLines.id, p.sourceLineId) }) : undefined;
      if (fiscalYear && source && source.fiscalYear !== fiscalYear) continue;
      const dest = p.destLineId
        ? await db.query.budgetLines.findFirst({ where: eq(schema.budgetLines.id, p.destLineId) }) : undefined;
      out.push({
        id: tx.id, ref: tx.ref, title: tx.title, status: tx.status,
        amountKobo: tx.amountKobo.toString(),
        sourceLine: source ? { id: source.id, code: source.code, name: source.name } : null,
        destLine: dest ? { id: dest.id, code: dest.code, name: dest.name } : null,
        applied: p.virementApplied === true,
        initiator: tx.initiator.name, department: tx.department.name,
        submittedAt: tx.submittedAt, updatedAt: tx.updatedAt,
      });
    }
    return out;
  }

  async get(txId: string) {
    const tx = await db.query.transactions.findFirst({
      where: and(eq(schema.transactions.id, txId), eq(schema.transactions.typeCode, 'VIREMENT')),
      with: { initiator: { columns: { id: true, name: true } }, department: true },
    });
    if (!tx) throw new NotFoundException('Virement not found');
    const p = (tx.payload ?? {}) as VirementPayload;
    const source = p.sourceLineId
      ? await db.query.budgetLines.findFirst({ where: eq(schema.budgetLines.id, p.sourceLineId) }) : undefined;
    const dest = p.destLineId
      ? await db.query.budgetLines.findFirst({ where: eq(schema.budgetLines.id, p.destLineId) }) : undefined;
    return {
      id: tx.id, ref: tx.ref, title: tx.title, status: tx.status, currentStage: tx.currentStage,
      amountKobo: tx.amountKobo.toString(), reason: p.reason ?? null,
      sourceLine: source ? { id: source.id, code: source.code, name: source.name } : null,
      destLine: dest ? { id: dest.id, code: dest.code, name: dest.name } : null,
      applied: p.virementApplied === true,
      initiator: tx.initiator, department: tx.department.name,
      submittedAt: tx.submittedAt, createdAt: tx.createdAt,
    };
  }
}

@Controller('v1/virements')
@UseGuards(AuthGuard)
export class VirementsController {
  constructor(private readonly svc: VirementsService) {}

  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    const dto = CreateVirementSchema.parse(body);
    return this.svc.create(user, dto, req.ip);
  }

  @Get()
  list(@Query('fiscalYear') fiscalYear?: string) {
    return this.svc.list(fiscalYear ? Number(fiscalYear) : undefined);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }
}

const audit = new AuditService();

/**
 * BUD-02 final-approval hook: apply the transfer to the ACTIVE version's
 * allocations for the source line's fiscal year, creating an ACTIVE version
 * (baselined from budget_lines.allocatedKobo) when none exists. Blocks if the
 * transfer would take the source line below its committed + actual spend.
 * Idempotent via the payload's virementApplied marker.
 */
export const applyVirementHook: ApprovalHook = async (tx) => {
  const payload = (tx.payload ?? {}) as VirementPayload & Record<string, unknown>;
  if (payload.virementApplied) return; // already applied (idempotency guard)
  const amount = BigInt(payload.amountKobo);
  const source = await db.query.budgetLines.findFirst({ where: eq(schema.budgetLines.id, payload.sourceLineId) });
  const dest = await db.query.budgetLines.findFirst({ where: eq(schema.budgetLines.id, payload.destLineId) });
  if (!source || !dest) throw new Error(`Virement ${tx.ref}: source or destination budget line no longer exists`);

  // Find or create the ACTIVE version for the fiscal year
  let active = await db.query.budgetVersions.findFirst({
    where: and(
      eq(schema.budgetVersions.fiscalYear, source.fiscalYear),
      eq(schema.budgetVersions.status, 'ACTIVE'),
    ),
  });
  if (!active) {
    const existing = await db.select().from(schema.budgetVersions)
      .where(eq(schema.budgetVersions.fiscalYear, source.fiscalYear));
    const versionNo = existing.reduce((m, v) => Math.max(m, v.versionNo), 0) + 1;
    const [created] = await db.insert(schema.budgetVersions).values({
      fiscalYear: source.fiscalYear, versionNo, status: 'ACTIVE',
      note: `Auto-created to apply virement ${tx.ref}`, activatedAt: new Date(),
    }).returning();
    const lines = await db.select().from(schema.budgetLines)
      .where(eq(schema.budgetLines.fiscalYear, source.fiscalYear));
    if (lines.length) {
      await db.insert(schema.budgetAllocations).values(lines.map((l) => ({
        versionId: created.id, budgetLineId: l.id, amountKobo: l.allocatedKobo,
      })));
    }
    active = created;
    await audit.log({
      action: 'BUDGET_VERSION_CREATED', entityType: 'budget_version', entityId: created.id,
      data: { fiscalYear: source.fiscalYear, versionNo, auto: true, forVirement: tx.ref },
    });
  }

  const getAlloc = async (budgetLineId: string) =>
    db.query.budgetAllocations.findFirst({
      where: and(
        eq(schema.budgetAllocations.versionId, active!.id),
        eq(schema.budgetAllocations.budgetLineId, budgetLineId),
      ),
    });
  const sourceAlloc = await getAlloc(source.id);
  const sourceAllocated = sourceAlloc?.amountKobo ?? 0n;

  // Guard: never take the source below committed + actual
  const usage = accumulateUsage(await collectUsageEntries());
  const check = virementCheck(sourceAllocated, usage.get(source.id), amount);
  if (!check.ok) {
    await audit.log({
      action: 'VIREMENT_BLOCKED', entityType: 'transaction', entityId: tx.ref,
      data: {
        sourceLine: source.code, destLine: dest.code,
        amountKobo: amount.toString(), availableKobo: check.availableKobo.toString(), reason: check.reason,
      },
    });
    throw new Error(`Virement ${tx.ref} blocked: ${check.reason}`);
  }

  if (sourceAlloc) {
    await db.update(schema.budgetAllocations).set({ amountKobo: sourceAllocated - amount })
      .where(eq(schema.budgetAllocations.id, sourceAlloc.id));
  } else {
    await db.insert(schema.budgetAllocations).values({
      versionId: active.id, budgetLineId: source.id, amountKobo: 0n - amount,
    });
  }
  const destAlloc = await getAlloc(dest.id);
  if (destAlloc) {
    await db.update(schema.budgetAllocations).set({ amountKobo: destAlloc.amountKobo + amount })
      .where(eq(schema.budgetAllocations.id, destAlloc.id));
  } else {
    await db.insert(schema.budgetAllocations).values({
      versionId: active.id, budgetLineId: dest.id, amountKobo: amount,
    });
  }

  await db.update(schema.transactions)
    .set({ payload: { ...payload, virementApplied: true }, updatedAt: new Date() })
    .where(eq(schema.transactions.id, tx.id));
  await audit.log({
    action: 'VIREMENT_APPLIED', entityType: 'transaction', entityId: tx.ref,
    data: {
      versionId: active.id, sourceLine: source.code, destLine: dest.code,
      amountKobo: amount.toString(),
    },
  });
};
