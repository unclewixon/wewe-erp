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

const KoboString = z.string().regex(/^\d+$/, 'must be a non-negative integer kobo string');

/**
 * BUD-02: a line the budget is being built with, rather than one that already exists.
 * Building a budget means deciding what the lines ARE — so a version may define them.
 * Any line not already present for the fiscal year is created as part of the version.
 */
const LineDefinitionSchema = z.object({
  name: z.string().min(2).max(200),
  code: z.string().max(40).optional(),
  departmentId: z.string().optional(),
  department: z.string().max(120).optional(),   // by name, which is what a builder knows
  donorCode: z.string().max(40).optional().nullable(),
  category: z.string().max(120).optional(),
});
const AllocationSchema = z.object({
  budgetLineId: z.string().min(1).optional(),
  line: LineDefinitionSchema.optional(),
  amountKobo: KoboString,
  /** Q1–Q4 phasing; must sum to amountKobo when given. */
  quartersKobo: z.array(KoboString).length(4).optional(),
}).refine((a) => a.budgetLineId || a.line, {
  message: 'each allocation needs either a budgetLineId or a line definition',
}).refine((a) => !a.quartersKobo || a.quartersKobo.reduce((s, q) => s + BigInt(q), 0n) === BigInt(a.amountKobo), {
  message: 'quartersKobo must add up to amountKobo',
});
/**
 * BUD-04: import a budget from a spreadsheet export. Takes the file the way the uploader
 * already sends one — base64 with its name and type — and reads it as CSV, because that is
 * what every finance team can produce from Excel without a converter.
 *
 * The import creates a DRAFT version and nothing more. Nobody should be able to replace the
 * live budget by dropping a file on a page; activation stays a separate, deliberate act.
 */
const ImportBudgetSchema = z.object({
  fiscalYear: z.union([z.number().int().min(2000).max(2100), z.string()]),
  name: z.string().max(200).optional(),
  mime: z.string().max(120).optional(),
  dataBase64: z.string().min(1),
  note: z.string().max(500).optional(),
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
  /** Derive a stable, unique code from a line name: FIELD_MONITORING, then -2, -3 on collision. */
  private async codeForLine(name: string, fiscalYear: number): Promise<string> {
    const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 28)
      || 'LINE';
    const stem = `${base}-${String(fiscalYear).slice(-2)}`;
    const taken = await db.select({ code: schema.budgetLines.code }).from(schema.budgetLines);
    const used = new Set(taken.map((t) => t.code));
    if (!used.has(stem)) return stem;
    for (let n = 2; n < 500; n += 1) if (!used.has(`${stem}-${n}`)) return `${stem}-${n}`;
    throw new BadRequestException(`Cannot derive a unique code for budget line "${name}"`);
  }

  async createVersion(user: AuthedUser, dto: z.infer<typeof CreateVersionSchema>, ip?: string) {
    // Resolve every allocation to a real budget line id, creating lines the builder has
    // defined but the organisation does not have yet. A budget is the act of deciding what
    // the lines are, so refusing an unknown name would make the builder unusable.
    const byId = new Map((await db.select().from(schema.budgetLines)
      .where(inArray(schema.budgetLines.id, dto.allocations.map((a) => a.budgetLineId ?? '').filter(Boolean))))
      .map((l) => [l.id, l]));
    const yearLines = await db.select().from(schema.budgetLines)
      .where(eq(schema.budgetLines.fiscalYear, dto.fiscalYear));
    const byName = new Map(yearLines.map((l) => [l.name.trim().toLowerCase(), l]));
    const departments = await db.select().from(schema.departments);

    const resolved: { budgetLineId: string; amountKobo: bigint; quartersKobo: string[] | null }[] = [];
    const created: { code: string; name: string }[] = [];
    for (const a of dto.allocations) {
      let lineId: string;
      if (a.budgetLineId) {
        const line = byId.get(a.budgetLineId);
        if (!line) throw new BadRequestException(`Unknown budget line ${a.budgetLineId}`);
        if (line.fiscalYear !== dto.fiscalYear)
          throw new BadRequestException(`Budget line ${line.code} belongs to fiscal year ${line.fiscalYear}, not ${dto.fiscalYear}`);
        lineId = line.id;
      } else {
        const def = a.line!;
        const hit = byName.get(def.name.trim().toLowerCase());
        if (hit) {
          lineId = hit.id;
        } else {
          // A new line needs a home department. Take it from the definition when the builder
          // names one, otherwise from the person building the budget.
          const dept = def.departmentId
            ? departments.find((d) => d.id === def.departmentId)
            : def.department
              ? departments.find((d) => d.name.trim().toLowerCase() === def.department!.trim().toLowerCase())
              : departments.find((d) => d.id === user.departmentId);
          if (!dept) {
            throw new BadRequestException(
              `Budget line "${def.name}" needs a department — "${def.department ?? ''}" did not match one, and your profile has none`,
            );
          }
          const [made] = await db.insert(schema.budgetLines).values({
            code: def.code?.trim() || await this.codeForLine(def.name, dto.fiscalYear),
            name: def.name.trim(),
            departmentId: dept.id,
            fiscalYear: dto.fiscalYear,
            allocatedKobo: BigInt(a.amountKobo),
            donorCode: def.donorCode ?? null,
          }).returning();
          byName.set(made.name.trim().toLowerCase(), made);
          created.push({ code: made.code, name: made.name });
          lineId = made.id;
        }
      }
      if (resolved.some((r) => r.budgetLineId === lineId))
        throw new BadRequestException('The same budget line appears twice in this version');
      resolved.push({ budgetLineId: lineId, amountKobo: BigInt(a.amountKobo), quartersKobo: a.quartersKobo ?? null });
    }

    const existing = await db.select().from(schema.budgetVersions)
      .where(eq(schema.budgetVersions.fiscalYear, dto.fiscalYear));
    const versionNo = existing.reduce((m, v) => Math.max(m, v.versionNo), 0) + 1;
    const [version] = await db.insert(schema.budgetVersions).values({
      fiscalYear: dto.fiscalYear, versionNo, status: 'DRAFT', note: dto.note ?? null, createdById: user.id,
    }).returning();
    await db.insert(schema.budgetAllocations).values(resolved.map((r) => ({
      versionId: version.id, budgetLineId: r.budgetLineId, amountKobo: r.amountKobo,
      quartersKobo: r.quartersKobo,
    })));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'BUDGET_VERSION_CREATED',
      entityType: 'budget_version', entityId: version.id,
      data: {
        fiscalYear: dto.fiscalYear, versionNo, allocations: resolved.length,
        // Lines created by this version are recorded by name and code: a new line is a
        // decision about the shape of the budget, not a detail of one allocation.
        ...(created.length ? { linesCreated: created } : {}),
      }, ip,
    });
    return this.getVersion(version.id);
  }

  /**
   * Parse a CSV budget and create a draft version from it. Recognised headers, in any order
   * and case: line/name, department, donor, and either amount, or q1..q4 which are summed.
   * A row naming a line the year does not have is created, exactly as the builder does —
   * importing a budget is the same act as building one, only faster.
   */
  async importVersion(user: AuthedUser, dto: z.infer<typeof ImportBudgetSchema>, ip?: string) {
    const fiscalYear = typeof dto.fiscalYear === 'number'
      ? dto.fiscalYear
      : Number((String(dto.fiscalYear).match(/(\d{4})/) ?? [])[1]);
    if (!fiscalYear || fiscalYear < 2000 || fiscalYear > 2100)
      throw new BadRequestException('A four-digit fiscal year is required');

    let text: string;
    try { text = Buffer.from(dto.dataBase64, 'base64').toString('utf8'); }
    catch { throw new BadRequestException('The file could not be decoded'); }
    const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (rows.length < 2) throw new BadRequestException('The file needs a header row and at least one budget line');

    const split = (line: string) => line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const header = split(rows[0]).map((h) => h.toLowerCase());
    const at = (...names: string[]) => header.findIndex((h) => names.includes(h));
    const iName = at('line', 'name', 'budget line', 'description');
    const iDept = at('department', 'dept');
    const iDonor = at('donor', 'donorcode', 'donor code');
    const iAmount = at('amount', 'total', 'allocation');
    const qCols = ['q1', 'q2', 'q3', 'q4'].map((q) => at(q, q.toUpperCase()));
    if (iName === -1)
      throw new BadRequestException('No line-name column found — expected one of: line, name, budget line, description');
    if (iAmount === -1 && qCols.some((c) => c === -1))
      throw new BadRequestException('Provide either an amount column or all four of q1, q2, q3, q4');

    // Naira in the sheet, kobo on the wire. A finance team types 1,250,000 — not 125000000.
    const toKobo = (cell: string | undefined) => {
      const n = Number(String(cell ?? '').replace(/[^0-9.-]/g, ''));
      if (!isFinite(n) || n < 0) return null;
      return BigInt(Math.round(n * 100));
    };

    const allocations: z.infer<typeof AllocationSchema>[] = [];
    const rejected: { row: number; reason: string }[] = [];
    for (let r = 1; r < rows.length; r += 1) {
      const cells = split(rows[r]);
      const name = cells[iName];
      if (!name) { rejected.push({ row: r + 1, reason: 'no line name' }); continue; }
      let total: bigint | null;
      let quarters: string[] | undefined;
      if (iAmount !== -1) {
        total = toKobo(cells[iAmount]);
      } else {
        const qs = qCols.map((c) => toKobo(cells[c]));
        if (qs.some((q) => q === null)) { rejected.push({ row: r + 1, reason: 'a quarter is not a number' }); continue; }
        quarters = qs.map((q) => q!.toString());
        total = qs.reduce((s, q) => s! + q!, 0n);
      }
      if (total === null) { rejected.push({ row: r + 1, reason: 'amount is not a number' }); continue; }
      if (total <= 0n) { rejected.push({ row: r + 1, reason: 'amount is zero' }); continue; }
      allocations.push({
        line: {
          name,
          department: iDept === -1 ? undefined : cells[iDept] || undefined,
          donorCode: iDonor === -1 ? undefined : cells[iDonor] || undefined,
        },
        amountKobo: total.toString(),
        ...(quarters ? { quartersKobo: quarters } : {}),
      });
    }
    if (!allocations.length)
      throw new BadRequestException(`No usable budget lines in the file${rejected.length ? ` — ${rejected.length} row(s) rejected` : ''}`);

    const version = await this.createVersion(user, {
      fiscalYear,
      note: dto.note ?? `Imported from ${dto.name ?? 'a spreadsheet'}`,
      allocations,
    }, ip);
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'BUDGET_IMPORTED',
      entityType: 'budget_version', entityId: version.id,
      // Rejected rows are recorded, not silently skipped: a budget that imported 40 of 47
      // lines and said nothing is how a shortfall becomes a surprise in month three.
      data: { file: dto.name ?? null, fiscalYear, imported: allocations.length, rejected }, ip,
    });
    return { ...version, imported: allocations.length, rejected };
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
      quartersKobo: schema.budgetAllocations.quartersKobo,
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
        quartersKobo: (a.quartersKobo as string[] | null) ?? null,
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

  /** BUD-04: import a spreadsheet as a DRAFT version — never as the live budget. */
  @Post('import')
  @RequireRoles('FINANCE')
  importVersion(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    const dto = ImportBudgetSchema.parse(body);
    return this.svc.importVersion(user, dto, req.ip);
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
