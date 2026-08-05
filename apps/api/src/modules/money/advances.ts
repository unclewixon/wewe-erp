import {
  BadRequestException, Body, Controller, Get, Injectable, NotFoundException,
  Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';
import { WorkflowService } from '../../workflow/workflow.service';
import {
  advanceAging, computeNights, perDiemFor, retirementDeadline, travelPerDiemTotal,
} from './money.logic';
import { evaluateBudgetCheck } from './budgets';
import { getSetting } from './settings.util';
import { queueJournalAndProcess } from './qb';

const TravelSchema = z.object({
  destination: z.string().min(1).max(200),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  locationCategory: z.string().max(40).optional(),
  /** Explicit nightly rate override; otherwise auto-calculated from settings 'travel.perDiemRates'. */
  perDiemKobo: z.string().regex(/^\d+$/).optional(),
});
const CreateAdvanceSchema = z.object({
  purpose: z.string().min(3).max(300),
  /** Non-travel portion (or whole amount when no travel block). */
  amountKobo: z.string().regex(/^\d+$/).optional(),
  budgetLineId: z.string().optional().nullable(),
  donorCode: z.string().max(40).optional().nullable(),
  travel: TravelSchema.optional(),
  submit: z.boolean().optional(),
});
const DisburseSchema = z.object({
  disbursedRef: z.string().min(1).max(120),
});

export interface AdvanceTravel {
  destination: string; startDate: string; endDate: string;
  nights: number; perDiemKobo: string; locationCategory?: string;
}

@Injectable()
export class AdvancesService {
  constructor(private readonly audit: AuditService, private readonly workflow: WorkflowService) {}

  /** ADV-01/02: request an advance (optionally a travel advance with per-diem auto-calc). */
  async create(user: AuthedUser, dto: z.infer<typeof CreateAdvanceSchema>, ip?: string) {
    // ADV-04 rule: an overdue unretired advance blocks (or warns on) new requests
    const overdue = await this.overdueAdvancesFor(user.id);
    const warnings: { kind: string; detail: unknown }[] = [];
    if (overdue.length > 0) {
      const block = await getSetting('advance.blockOnOverdue');
      const detail = overdue.map((a) => ({
        advanceId: a.id, balanceKobo: a.balanceKobo.toString(),
        retirementDeadline: a.retirementDeadline,
      }));
      if (block) {
        throw new BadRequestException({
          message: 'You have an overdue advance awaiting retirement; retire it before requesting a new one',
          overdueAdvances: detail,
        });
      }
      warnings.push({ kind: 'OVERDUE_ADVANCE', detail });
    }

    let travel: AdvanceTravel | null = null;
    let amount = BigInt(dto.amountKobo ?? '0');
    if (dto.travel) {
      if (dto.travel.endDate.getTime() < dto.travel.startDate.getTime())
        throw new BadRequestException('Travel end date must not be before its start date');
      const nights = computeNights(dto.travel.startDate, dto.travel.endDate);
      let perDiem: bigint;
      if (dto.travel.perDiemKobo !== undefined) {
        perDiem = BigInt(dto.travel.perDiemKobo);
      } else {
        const rates = await getSetting('travel.perDiemRates');
        const profile = await db.query.staffProfiles.findFirst({ where: eq(schema.staffProfiles.userId, user.id) });
        const resolved = perDiemFor(rates, profile?.grade ?? null, dto.travel.locationCategory ?? null);
        if (resolved === null)
          throw new BadRequestException('No per-diem rate configured for your grade/location; supply travel.perDiemKobo');
        perDiem = resolved;
      }
      travel = {
        destination: dto.travel.destination,
        startDate: dto.travel.startDate.toISOString(),
        endDate: dto.travel.endDate.toISOString(),
        nights, perDiemKobo: perDiem.toString(),
        ...(dto.travel.locationCategory ? { locationCategory: dto.travel.locationCategory } : {}),
      };
      amount += travelPerDiemTotal(nights, perDiem);
    }
    if (amount <= 0n) throw new BadRequestException('Advance amount must be positive');

    const budgetLineId = dto.budgetLineId ?? null;
    if (budgetLineId) {
      const line = await db.query.budgetLines.findFirst({ where: eq(schema.budgetLines.id, budgetLineId) });
      if (!line) throw new BadRequestException('Unknown budget line');
      // REQ-02 behaviour applies to advances against a budget line too
      const check = await evaluateBudgetCheck([{ budgetLineId, amountKobo: amount }]);
      if (check.violations.length > 0) {
        if (check.mode === 'block') {
          throw new BadRequestException({ message: 'Budget check failed', violations: check.violations });
        }
        warnings.push({ kind: 'BUDGET', detail: check.violations });
      }
    }

    const tx = await this.workflow.createTransaction(user, {
      typeCode: 'ADVANCE', title: dto.purpose, amountKobo: amount,
      donorCode: dto.donorCode ?? null,
      payload: { budgetLineId, ...(travel ? { travel } : {}) },
      submit: dto.submit, ip,
    });
    const [advance] = await db.insert(schema.advances).values({
      txId: tx.id, staffId: user.id, purpose: dto.purpose,
      travel: travel ?? null, status: 'REQUESTED', balanceKobo: 0n,
    }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'ADVANCE_REQUESTED',
      entityType: 'advance', entityId: advance.id,
      data: {
        txRef: tx.ref, amountKobo: amount.toString(), budgetLineId, travel,
        ...(warnings.length ? { warnings } : {}),
      }, ip,
    });
    const detail = await this.get(advance.id);
    return warnings.length ? { ...detail, warnings } : detail;
  }

  private async overdueAdvancesFor(staffId: string) {
    const now = new Date();
    const rows = await db.select().from(schema.advances).where(and(
      eq(schema.advances.staffId, staffId),
      inArray(schema.advances.status, ['DISBURSED', 'RETIRING']),
    ));
    return rows.filter((a) =>
      a.balanceKobo > 0n && a.retirementDeadline !== null && a.retirementDeadline.getTime() < now.getTime());
  }

  /** ADV-03: Finance records the actual disbursement; deadline is armed here. */
  async disburse(user: AuthedUser, advanceId: string, dto: z.infer<typeof DisburseSchema>, ip?: string) {
    const advance = await db.query.advances.findFirst({ where: eq(schema.advances.id, advanceId) });
    if (!advance) throw new NotFoundException('Advance not found');
    if (advance.status !== 'REQUESTED') throw new BadRequestException(`Advance is ${advance.status}, not awaiting disbursement`);
    const tx = await db.query.transactions.findFirst({ where: eq(schema.transactions.id, advance.txId) });
    if (!tx || tx.status !== 'APPROVED')
      throw new BadRequestException('The advance must be fully approved before disbursement');

    const disbursedAt = new Date();
    const travel = advance.travel as AdvanceTravel | null;
    const travelEnd = travel?.endDate ? new Date(travel.endDate) : null;
    const days = await getSetting('advance.retirementDays');
    const deadline = retirementDeadline(disbursedAt, travelEnd, days);
    await db.update(schema.advances).set({
      status: 'DISBURSED', disbursedAt, disbursedRef: dto.disbursedRef,
      balanceKobo: tx.amountKobo, retirementDeadline: deadline,
    }).where(eq(schema.advances.id, advanceId));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'ADVANCE_DISBURSED',
      entityType: 'advance', entityId: advanceId,
      data: {
        txRef: tx.ref, disbursedRef: dto.disbursedRef,
        amountKobo: tx.amountKobo.toString(), retirementDeadline: deadline.toISOString(),
      }, ip,
    });
    await queueJournalAndProcess(tx.id, {
      entry: 'ADVANCE_DISBURSEMENT', txRef: tx.ref, advanceId,
      staffId: advance.staffId, amountKobo: tx.amountKobo.toString(),
      donorCode: tx.donorCode, disbursedRef: dto.disbursedRef, disbursedAt: disbursedAt.toISOString(),
    });
    return this.get(advanceId);
  }

  async list(user: AuthedUser, scope: 'mine' | 'all') {
    const finance = user.roles.some((r) => ['FINANCE', 'SYSTEM_ADMIN', 'INTERNAL_AUDIT'].includes(r.code));
    const rows = await db.select({
      advance: schema.advances, tx: schema.transactions, staffName: schema.users.name,
    }).from(schema.advances)
      .innerJoin(schema.transactions, eq(schema.advances.txId, schema.transactions.id))
      .innerJoin(schema.users, eq(schema.advances.staffId, schema.users.id))
      .orderBy(desc(schema.transactions.updatedAt)).limit(200);
    const now = new Date();
    return rows
      .filter((r) => (scope === 'mine' || !finance ? r.advance.staffId === user.id : true))
      .map((r) => ({
        id: r.advance.id, txId: r.tx.id, ref: r.tx.ref, purpose: r.advance.purpose,
        staff: { id: r.advance.staffId, name: r.staffName },
        amountKobo: r.tx.amountKobo.toString(), balanceKobo: r.advance.balanceKobo.toString(),
        txStatus: r.tx.status, status: r.advance.status,
        travel: r.advance.travel, disbursedAt: r.advance.disbursedAt,
        retirementDeadline: r.advance.retirementDeadline,
        overdue: r.advance.retirementDeadline !== null && r.advance.balanceKobo > 0n
          && r.advance.retirementDeadline.getTime() < now.getTime(),
      }));
  }

  /** ADV-04: outstanding advances register — per staff, with aging and overdue flags. */
  async register() {
    const rows = await db.select({
      advance: schema.advances, tx: schema.transactions,
      staffName: schema.users.name, staffEmail: schema.users.email,
    }).from(schema.advances)
      .innerJoin(schema.transactions, eq(schema.advances.txId, schema.transactions.id))
      .innerJoin(schema.users, eq(schema.advances.staffId, schema.users.id))
      .where(inArray(schema.advances.status, ['DISBURSED', 'RETIRING']));
    const now = new Date();
    const byStaff = new Map<string, {
      staff: { id: string; name: string; email: string };
      outstandingKobo: bigint; overdueCount: number;
      advances: {
        id: string; ref: string; purpose: string; amountKobo: string; balanceKobo: string;
        disbursedAt: Date | null; retirementDeadline: Date | null; ageDays: number; overdue: boolean;
      }[];
    }>();
    for (const r of rows) {
      if (r.advance.balanceKobo <= 0n || !r.advance.disbursedAt) continue;
      const aging = advanceAging(r.advance.disbursedAt, r.advance.retirementDeadline, now);
      const entry = byStaff.get(r.advance.staffId) ?? {
        staff: { id: r.advance.staffId, name: r.staffName, email: r.staffEmail },
        outstandingKobo: 0n, overdueCount: 0, advances: [],
      };
      entry.outstandingKobo += r.advance.balanceKobo;
      if (aging.overdue) entry.overdueCount += 1;
      entry.advances.push({
        id: r.advance.id, ref: r.tx.ref, purpose: r.advance.purpose,
        amountKobo: r.tx.amountKobo.toString(), balanceKobo: r.advance.balanceKobo.toString(),
        disbursedAt: r.advance.disbursedAt, retirementDeadline: r.advance.retirementDeadline,
        ageDays: aging.ageDays, overdue: aging.overdue,
      });
      byStaff.set(r.advance.staffId, entry);
    }
    return [...byStaff.values()]
      .sort((a, b) => (a.outstandingKobo > b.outstandingKobo ? -1 : 1))
      .map((e) => ({ ...e, outstandingKobo: e.outstandingKobo.toString() }));
  }

  async get(advanceId: string) {
    const advance = await db.query.advances.findFirst({ where: eq(schema.advances.id, advanceId) });
    if (!advance) throw new NotFoundException('Advance not found');
    const tx = await db.query.transactions.findFirst({
      where: eq(schema.transactions.id, advance.txId),
      with: { initiator: { columns: { id: true, name: true } }, department: true },
    });
    if (!tx) throw new NotFoundException('Advance transaction not found');
    const payload = (tx.payload ?? {}) as { budgetLineId?: string | null };
    const budgetLine = payload.budgetLineId
      ? await db.query.budgetLines.findFirst({ where: eq(schema.budgetLines.id, payload.budgetLineId) })
      : undefined;
    const rets = await db.select().from(schema.retirements).where(eq(schema.retirements.advanceId, advanceId));
    const now = new Date();
    return {
      id: advance.id, txId: tx.id, ref: tx.ref, purpose: advance.purpose,
      staff: tx.initiator, department: tx.department.name,
      amountKobo: tx.amountKobo.toString(), balanceKobo: advance.balanceKobo.toString(),
      txStatus: tx.status, currentStage: tx.currentStage, status: advance.status,
      donorCode: tx.donorCode,
      budgetLine: budgetLine ? { id: budgetLine.id, code: budgetLine.code, name: budgetLine.name } : null,
      travel: advance.travel,
      disbursedAt: advance.disbursedAt, disbursedRef: advance.disbursedRef,
      retirementDeadline: advance.retirementDeadline,
      overdue: advance.retirementDeadline !== null && advance.balanceKobo > 0n
        && advance.retirementDeadline.getTime() < now.getTime(),
      retirements: rets.map((r) => ({
        id: r.id, txId: r.txId, totalKobo: r.totalKobo.toString(),
        varianceKobo: r.varianceKobo.toString(), refundDueKobo: r.refundDueKobo.toString(),
        refundSettledAt: r.refundSettledAt, refundSettledRef: r.refundSettledRef,
      })),
    };
  }
}

@Controller('v1/advances')
@UseGuards(AuthGuard)
export class AdvancesController {
  constructor(private readonly svc: AdvancesService) {}

  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    const dto = CreateAdvanceSchema.parse(body);
    return this.svc.create(user, dto, req.ip);
  }

  @Get()
  list(@CurrentUser() user: AuthedUser, @Query('scope') scope?: string) {
    return this.svc.list(user, scope === 'all' ? 'all' : 'mine');
  }

  /** ADV-04 outstanding register (declare before ':id' so the route matches). */
  @Get('register')
  @RequireRoles('FINANCE', 'SYSTEM_ADMIN', 'INTERNAL_AUDIT')
  register() {
    return this.svc.register();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post(':id/disburse')
  @RequireRoles('FINANCE')
  disburse(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = DisburseSchema.parse(body);
    return this.svc.disburse(user, id, dto, req.ip);
  }
}
