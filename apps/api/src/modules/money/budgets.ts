import {
  BadRequestException, Body, Controller, Get, Injectable, NotFoundException,
  Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';
import {
  accumulateUsage, budgetPosition, checkAgainstAvailable,
  type BudgetPosition, type UsageEntry,
} from './money.logic';
import { getSetting } from './settings.util';

const AllocationSchema = z.object({
  budgetLineId: z.string().min(1),
  amountKobo: z.string().regex(/^\d+$/, 'amountKobo must be a non-negative integer kobo string'),
});
const CreateVersionSchema = z.object({
  fiscalYear: z.number().int().min(2000).max(2100),
  note: z.string().max(500).optional(),
  allocations: z.array(AllocationSchema).min(1).max(500),
});

/* ------------------------------------------------------------------------ *
 * Shared computation (also used by requisitions' REQ-02 check and the
 * virement hook) — plain functions, no DI needed.
 * ------------------------------------------------------------------------ */

/**
 * BUD-03: committed (PENDING) / actual (APPROVED) usage per budget line, from
 * requisition lines plus advance transactions carrying a payload.budgetLineId.
 */
export async function collectUsageEntries(): Promise<UsageEntry[]> {
  const reqLines = await db
    .select({
      budgetLineId: schema.requisitionLines.budgetLineId,
      qty: schema.requisitionLines.qty,
      unitKobo: schema.requisitionLines.unitKobo,
      status: schema.transactions.status,
    })
    .from(schema.requisitionLines)
    .innerJoin(schema.transactions, eq(schema.requisitionLines.transactionId, schema.transactions.id))
    .where(inArray(schema.transactions.status, ['PENDING', 'APPROVED']));
  const entries: UsageEntry[] = reqLines.map((l) => ({
    budgetLineId: l.budgetLineId, status: l.status, amountKobo: BigInt(l.qty) * l.unitKobo,
  }));

  const advTxs = await db.select({
    status: schema.transactions.status,
    amountKobo: schema.transactions.amountKobo,
    payload: schema.transactions.payload,
  }).from(schema.transactions).where(and(
    eq(schema.transactions.typeCode, 'ADVANCE'),
    inArray(schema.transactions.status, ['PENDING', 'APPROVED']),
  ));
  for (const tx of advTxs) {
    const budgetLineId = (tx.payload as { budgetLineId?: string } | null)?.budgetLineId ?? null;
    entries.push({ budgetLineId, status: tx.status, amountKobo: tx.amountKobo });
  }
  return entries;
}

/**
 * BUD-01/03: allocated amount per budget line — from the ACTIVE budget version of
 * the line's fiscal year, falling back to budget_lines.allocatedKobo when no
 * version exists for that year. With an active version, a line missing from it
 * is allocated 0.
 */
export async function allocatedByLine(
  lines: { id: string; fiscalYear: number; allocatedKobo: bigint }[],
): Promise<Map<string, bigint>> {
  const years = [...new Set(lines.map((l) => l.fiscalYear))];
  const activeVersions = years.length === 0 ? [] : await db.select().from(schema.budgetVersions).where(and(
    inArray(schema.budgetVersions.fiscalYear, years),
    eq(schema.budgetVersions.status, 'ACTIVE'),
  ));
  const activeByYear = new Map(activeVersions.map((v) => [v.fiscalYear, v.id]));
  const versionIds = activeVersions.map((v) => v.id);
  const allocations = versionIds.length === 0 ? [] : await db.select().from(schema.budgetAllocations)
    .where(inArray(schema.budgetAllocations.versionId, versionIds));
  const allocByKey = new Map(allocations.map((a) => [`${a.versionId}:${a.budgetLineId}`, a.amountKobo]));

  const out = new Map<string, bigint>();
  for (const line of lines) {
    const versionId = activeByYear.get(line.fiscalYear);
    if (!versionId) out.set(line.id, line.allocatedKobo); // no version for the year → baseline
    else out.set(line.id, allocByKey.get(`${versionId}:${line.id}`) ?? 0n);
  }
  return out;
}

/** Full BUD-03 position for a set of budget lines (all lines when ids omitted). */
export async function computePositions(lineIds?: string[]): Promise<Map<string, BudgetPosition>> {
  const lines = await (lineIds
    ? db.select().from(schema.budgetLines).where(inArray(schema.budgetLines.id, lineIds))
    : db.select().from(schema.budgetLines));
  const allocated = await allocatedByLine(lines);
  const usage = accumulateUsage(await collectUsageEntries());
  const out = new Map<string, BudgetPosition>();
  for (const line of lines) out.set(line.id, budgetPosition(allocated.get(line.id) ?? 0n, usage.get(line.id)));
  return out;
}

export interface BudgetCheckResult {
  mode: 'block' | 'warn';
  violations: {
    lineIndex: number; budgetLineId: string; budgetLineCode: string | null;
    requestedKobo: string; availableKobo: string; shortfallKobo: string;
  }[];
}

/**
 * REQ-02: evaluate requisition/advance lines against available budget, applying
 * the 'budget.checkMode' setting ('block' | 'warn', default 'warn').
 * Amounts in the result are kobo strings, ready for responses and audit data.
 */
export async function evaluateBudgetCheck(
  requests: { budgetLineId: string | null; amountKobo: bigint }[],
): Promise<BudgetCheckResult> {
  const mode = await getSetting('budget.checkMode');
  const ids = [...new Set(requests.map((r) => r.budgetLineId).filter((v): v is string => !!v))];
  if (ids.length === 0) return { mode, violations: [] };
  const positions = await computePositions(ids);
  const available = new Map<string, bigint>();
  for (const [id, p] of positions) available.set(id, p.availableKobo);
  const raw = checkAgainstAvailable(
    requests.map((r, index) => ({ index, budgetLineId: r.budgetLineId, amountKobo: r.amountKobo })),
    available,
  );
  if (raw.length === 0) return { mode, violations: [] };
  const codeRows = await db.select({ id: schema.budgetLines.id, code: schema.budgetLines.code })
    .from(schema.budgetLines).where(inArray(schema.budgetLines.id, ids));
  const codes = new Map(codeRows.map((r) => [r.id, r.code]));
  return {
    mode,
    violations: raw.map((v) => ({
      lineIndex: v.index, budgetLineId: v.budgetLineId, budgetLineCode: codes.get(v.budgetLineId) ?? null,
      requestedKobo: v.requestedKobo.toString(), availableKobo: v.availableKobo.toString(),
      shortfallKobo: v.shortfallKobo.toString(),
    })),
  };
}

/* ---------------------------------------------------------------- service */

@Injectable()
export class BudgetsService {
  constructor(private readonly audit: AuditService) {}

  /** BUD-01: create a DRAFT budget version with its allocations (Finance). */
  async createVersion(user: AuthedUser, dto: z.infer<typeof CreateVersionSchema>, ip?: string) {
    const lineIds = dto.allocations.map((a) => a.budgetLineId);
    if (new Set(lineIds).size !== lineIds.length)
      throw new BadRequestException('Duplicate budgetLineId in allocations');
    const lines = await db.select().from(schema.budgetLines).where(inArray(schema.budgetLines.id, lineIds));
    const known = new Map(lines.map((l) => [l.id, l]));
    for (const a of dto.allocations) {
      const line = known.get(a.budgetLineId);
      if (!line) throw new BadRequestException(`Unknown budget line ${a.budgetLineId}`);
      if (line.fiscalYear !== dto.fiscalYear)
        throw new BadRequestException(`Budget line ${line.code} belongs to fiscal year ${line.fiscalYear}, not ${dto.fiscalYear}`);
    }
    const existing = await db.select().from(schema.budgetVersions)
      .where(eq(schema.budgetVersions.fiscalYear, dto.fiscalYear));
    const versionNo = existing.reduce((m, v) => Math.max(m, v.versionNo), 0) + 1;
    const [version] = await db.insert(schema.budgetVersions).values({
      fiscalYear: dto.fiscalYear, versionNo, status: 'DRAFT', note: dto.note ?? null, createdById: user.id,
    }).returning();
    await db.insert(schema.budgetAllocations).values(dto.allocations.map((a) => ({
      versionId: version.id, budgetLineId: a.budgetLineId, amountKobo: BigInt(a.amountKobo),
    })));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'BUDGET_VERSION_CREATED',
      entityType: 'budget_version', entityId: version.id,
      data: { fiscalYear: dto.fiscalYear, versionNo, allocations: dto.allocations.length }, ip,
    });
    return this.getVersion(version.id);
  }

  /** BUD-01: activate a version; any prior ACTIVE version of the year is SUPERSEDED. */
  async activateVersion(user: AuthedUser, versionId: string, ip?: string) {
    const version = await db.query.budgetVersions.findFirst({ where: eq(schema.budgetVersions.id, versionId) });
    if (!version) throw new NotFoundException('Budget version not found');
    if (version.status === 'ACTIVE') throw new BadRequestException('Version is already active');
    if (version.status === 'SUPERSEDED') throw new BadRequestException('A superseded version cannot be re-activated');
    const priorActive = await db.select().from(schema.budgetVersions).where(and(
      eq(schema.budgetVersions.fiscalYear, version.fiscalYear),
      eq(schema.budgetVersions.status, 'ACTIVE'),
    ));
    for (const prior of priorActive) {
      await db.update(schema.budgetVersions).set({ status: 'SUPERSEDED' })
        .where(eq(schema.budgetVersions.id, prior.id));
    }
    await db.update(schema.budgetVersions).set({ status: 'ACTIVE', activatedAt: new Date() })
      .where(eq(schema.budgetVersions.id, versionId));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'BUDGET_VERSION_ACTIVATED',
      entityType: 'budget_version', entityId: versionId,
      data: {
        fiscalYear: version.fiscalYear, versionNo: version.versionNo,
        superseded: priorActive.map((p) => ({ id: p.id, versionNo: p.versionNo })),
      }, ip,
    });
    return this.getVersion(versionId);
  }

  async listVersions(fiscalYear?: number) {
    const rows = await db.select().from(schema.budgetVersions)
      .where(fiscalYear ? eq(schema.budgetVersions.fiscalYear, fiscalYear) : undefined)
      .orderBy(desc(schema.budgetVersions.fiscalYear), desc(schema.budgetVersions.versionNo));
    const allocs = rows.length === 0 ? [] : await db.select().from(schema.budgetAllocations)
      .where(inArray(schema.budgetAllocations.versionId, rows.map((r) => r.id)));
    return rows.map((v) => {
      const mine = allocs.filter((a) => a.versionId === v.id);
      return {
        id: v.id, fiscalYear: v.fiscalYear, versionNo: v.versionNo, status: v.status, note: v.note,
        createdById: v.createdById, activatedAt: v.activatedAt, createdAt: v.createdAt,
        allocationCount: mine.length,
        totalKobo: mine.reduce((s, a) => s + a.amountKobo, 0n).toString(),
      };
    });
  }

  async getVersion(versionId: string) {
    const version = await db.query.budgetVersions.findFirst({ where: eq(schema.budgetVersions.id, versionId) });
    if (!version) throw new NotFoundException('Budget version not found');
    const allocs = await db.select({
      id: schema.budgetAllocations.id,
      budgetLineId: schema.budgetAllocations.budgetLineId,
      amountKobo: schema.budgetAllocations.amountKobo,
      code: schema.budgetLines.code,
      name: schema.budgetLines.name,
      departmentId: schema.budgetLines.departmentId,
    }).from(schema.budgetAllocations)
      .innerJoin(schema.budgetLines, eq(schema.budgetAllocations.budgetLineId, schema.budgetLines.id))
      .where(eq(schema.budgetAllocations.versionId, versionId));
    return {
      id: version.id, fiscalYear: version.fiscalYear, versionNo: version.versionNo,
      status: version.status, note: version.note, createdById: version.createdById,
      activatedAt: version.activatedAt, createdAt: version.createdAt,
      totalKobo: allocs.reduce((s, a) => s + a.amountKobo, 0n).toString(),
      allocations: allocs.map((a) => ({
        id: a.id, budgetLineId: a.budgetLineId, code: a.code, name: a.name,
        departmentId: a.departmentId, amountKobo: a.amountKobo.toString(),
      })),
    };
  }

  /** BUD-03: budget position per department and/or line. */
  async position(filter: { departmentId?: string; budgetLineId?: string; fiscalYear?: number }) {
    const conds = [
      filter.departmentId ? eq(schema.budgetLines.departmentId, filter.departmentId) : undefined,
      filter.budgetLineId ? eq(schema.budgetLines.id, filter.budgetLineId) : undefined,
      filter.fiscalYear ? eq(schema.budgetLines.fiscalYear, filter.fiscalYear) : undefined,
    ].filter((c): c is NonNullable<typeof c> => !!c);
    const lines = await db.select({
      line: schema.budgetLines,
      departmentName: schema.departments.name,
    }).from(schema.budgetLines)
      .innerJoin(schema.departments, eq(schema.budgetLines.departmentId, schema.departments.id))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(schema.budgetLines.code);
    if (filter.budgetLineId && lines.length === 0) throw new NotFoundException('Budget line not found');
    const positions = await computePositions(lines.map((l) => l.line.id));
    return lines.map(({ line, departmentName }) => {
      const p = positions.get(line.id)!;
      return {
        budgetLineId: line.id, code: line.code, name: line.name,
        department: { id: line.departmentId, name: departmentName },
        fiscalYear: line.fiscalYear, donorCode: line.donorCode,
        allocatedKobo: p.allocatedKobo.toString(),
        committedKobo: p.committedKobo.toString(),
        actualKobo: p.actualKobo.toString(),
        availableKobo: p.availableKobo.toString(),
      };
    });
  }
}

@Controller('v1/budgets')
@UseGuards(AuthGuard)
export class BudgetsController {
  constructor(private readonly svc: BudgetsService) {}

  @Post('versions')
  @RequireRoles('FINANCE')
  createVersion(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    const dto = CreateVersionSchema.parse(body);
    return this.svc.createVersion(user, dto, req.ip);
  }

  @Post('versions/:id/activate')
  @RequireRoles('FINANCE')
  activate(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: any) {
    return this.svc.activateVersion(user, id, req.ip);
  }

  @Get('versions')
  listVersions(@Query('fiscalYear') fiscalYear?: string) {
    return this.svc.listVersions(fiscalYear ? Number(fiscalYear) : undefined);
  }

  @Get('versions/:id')
  getVersion(@Param('id') id: string) {
    return this.svc.getVersion(id);
  }

  @Get('position')
  position(
    @Query('departmentId') departmentId?: string,
    @Query('budgetLineId') budgetLineId?: string,
    @Query('fiscalYear') fiscalYear?: string,
  ) {
    return this.svc.position({
      departmentId: departmentId || undefined,
      budgetLineId: budgetLineId || undefined,
      fiscalYear: fiscalYear ? Number(fiscalYear) : undefined,
    });
  }
}
