/**
 * PRC-02 — RFQ & quote management: create RFQ (optionally against an APPROVED
 * requisition), collect quotes, side-by-side comparison, select the winner with
 * mandatory justification under threshold rules (settings 'procurement.thresholds').
 */
import {
  BadRequestException, Body, Controller, Get, Injectable, NotFoundException,
  Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, type AuthedUser } from '../../auth/auth';
import { WorkflowService } from '../../workflow/workflow.service';
import { bandFor, quoteRequirement } from './ops.logic';
import { KoboString, loadThresholds, tableRef } from './shared';
import { VendorsService } from './vendors';

const QuoteLineSchema = z.object({
  description: z.string().min(1).max(300),
  qty: z.number().int().positive(),
  unitKobo: KoboString,
});
export type QuoteLine = z.infer<typeof QuoteLineSchema>;

const CreateSchema = z.object({
  title: z.string().min(3).max(200),
  deadline: z.coerce.date().optional().nullable(),
  requisitionTxId: z.string().optional().nullable(),
});
const AddQuoteSchema = z.object({
  vendorId: z.string().min(1),
  totalKobo: KoboString,
  lines: z.array(QuoteLineSchema).max(100).optional(),
  validityDays: z.number().int().positive().max(365).optional(),
});
const SelectSchema = z.object({
  quoteId: z.string().min(1),
  justification: z.string().min(10).max(2000),
  /** Sole-source path: written justification for selecting below the quote-count band. */
  soleSource: z.string().min(10).max(2000).optional(),
  /** Required by the top threshold band. */
  committeeNote: z.string().min(10).max(4000).optional(),
});

@Injectable()
export class RfqsService {
  constructor(
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly vendors: VendorsService,
  ) {}

  async byId(id: string) {
    const rfq = await db.query.rfqs.findFirst({ where: eq(schema.rfqs.id, id) });
    if (!rfq) throw new NotFoundException('RFQ not found');
    return rfq;
  }

  private async quotesFor(rfqId: string) {
    const quotes = await db.select().from(schema.rfqQuotes).where(eq(schema.rfqQuotes.rfqId, rfqId));
    const out = [];
    for (const q of quotes) {
      const vendor = await db.query.vendors.findFirst({ where: eq(schema.vendors.id, q.vendorId) });
      out.push({
        id: q.id, vendor: { id: q.vendorId, name: vendor?.name ?? '(deleted)', blacklisted: vendor?.blacklisted ?? false },
        totalKobo: q.totalKobo.toString(), lines: q.lines, validityDays: q.validityDays,
        selected: q.selected, receivedAt: q.receivedAt,
      });
    }
    return out.sort((a, b) => (BigInt(a.totalKobo) < BigInt(b.totalKobo) ? -1 : 1));
  }

  async create(user: AuthedUser, dto: z.infer<typeof CreateSchema>, ip?: string) {
    if (dto.requisitionTxId) {
      const tx = await db.query.transactions.findFirst({ where: eq(schema.transactions.id, dto.requisitionTxId) });
      if (!tx || tx.typeCode !== 'REQUISITION') throw new BadRequestException('Linked requisition not found');
      if (tx.status !== 'APPROVED') {
        throw new BadRequestException(`RFQs can only be raised against an APPROVED requisition (${tx.ref} is ${tx.status})`);
      }
    }
    const ref = await tableRef(this.workflow, 'RFQ',
      async (r) => Boolean(await db.query.rfqs.findFirst({ where: eq(schema.rfqs.ref, r) })));
    const [rfq] = await db.insert(schema.rfqs).values({
      ref, title: dto.title, deadline: dto.deadline ?? null,
      requisitionTxId: dto.requisitionTxId ?? null, createdById: user.id,
    }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'RFQ_CREATED',
      entityType: 'rfq', entityId: ref, data: { title: dto.title, requisitionTxId: dto.requisitionTxId ?? null }, ip,
    });
    return this.detail(rfq.id);
  }

  async list(status?: string) {
    const rows = await db.select().from(schema.rfqs).orderBy(desc(schema.rfqs.createdAt)).limit(200);
    const out = [];
    for (const r of rows.filter((r) => !status || r.status === status)) {
      const quotes = await db.select().from(schema.rfqQuotes).where(eq(schema.rfqQuotes.rfqId, r.id));
      out.push({
        id: r.id, ref: r.ref, title: r.title, status: r.status, deadline: r.deadline,
        quoteCount: quotes.length, createdAt: r.createdAt,
      });
    }
    return out;
  }

  async detail(id: string) {
    const rfq = await this.byId(id);
    const requisition = rfq.requisitionTxId
      ? await db.query.transactions.findFirst({ where: eq(schema.transactions.id, rfq.requisitionTxId) })
      : null;
    const creator = await db.query.users.findFirst({ where: eq(schema.users.id, rfq.createdById), columns: { name: true } });
    return {
      id: rfq.id, ref: rfq.ref, title: rfq.title, status: rfq.status, deadline: rfq.deadline,
      selectionJustification: rfq.selectionJustification,
      requisition: requisition
        ? { txId: requisition.id, ref: requisition.ref, title: requisition.title, amountKobo: requisition.amountKobo.toString(), status: requisition.status }
        : null,
      createdBy: creator?.name ?? null, createdAt: rfq.createdAt,
      quotes: await this.quotesFor(id),
    };
  }

  async addQuote(user: AuthedUser, rfqId: string, dto: z.infer<typeof AddQuoteSchema>, ip?: string) {
    const rfq = await this.byId(rfqId);
    if (rfq.status !== 'OPEN') throw new BadRequestException(`Quotes can only be added while the RFQ is OPEN (currently ${rfq.status})`);
    const vendor = await this.vendors.byId(dto.vendorId);
    this.vendors.assertNotBlacklisted(vendor, 'quoting on RFQs');
    if (dto.lines?.length) {
      const linesTotal = dto.lines.reduce((s, l) => s + BigInt(l.qty) * BigInt(l.unitKobo), 0n);
      if (linesTotal !== BigInt(dto.totalKobo)) {
        throw new BadRequestException(`Quote lines total ${linesTotal} does not match totalKobo ${dto.totalKobo}`);
      }
    }
    const [quote] = await db.insert(schema.rfqQuotes).values({
      rfqId, vendorId: dto.vendorId, totalKobo: BigInt(dto.totalKobo),
      lines: dto.lines ?? null, validityDays: dto.validityDays ?? null,
    }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'RFQ_QUOTE_ADDED',
      entityType: 'rfq', entityId: rfq.ref,
      data: { quoteId: quote.id, vendor: vendor.name, totalKobo: dto.totalKobo }, ip,
    });
    return this.detail(rfqId);
  }

  /** Side-by-side comparison, incl. per-line matrix where quotes carry lines. */
  async comparison(id: string) {
    const rfq = await this.byId(id);
    const quotes = await this.quotesFor(id);
    const thresholds = await loadThresholds();
    const lowest = quotes[0] ?? null;
    const band = lowest ? bandFor(thresholds, BigInt(lowest.totalKobo)) : null;

    // Per-line matrix keyed by line description.
    const byDescription = new Map<string, { description: string; byQuote: Record<string, { qty: number; unitKobo: string; lineTotalKobo: string }> }>();
    for (const q of quotes) {
      const lines = Array.isArray(q.lines) ? (q.lines as QuoteLine[]) : [];
      for (const l of lines) {
        if (!l || typeof l.description !== 'string') continue;
        const row = byDescription.get(l.description) ?? { description: l.description, byQuote: {} };
        row.byQuote[q.id] = {
          qty: l.qty, unitKobo: l.unitKobo,
          lineTotalKobo: (BigInt(l.qty) * BigInt(l.unitKobo)).toString(),
        };
        byDescription.set(l.description, row);
      }
    }
    return {
      rfq: { id: rfq.id, ref: rfq.ref, title: rfq.title, status: rfq.status },
      quotes,
      lowestQuoteId: lowest?.id ?? null,
      quoteCount: quotes.length,
      requirement: band ? { minQuotes: band.minQuotes, committeeNoteRequired: Boolean(band.committeeNote) } : null,
      lineComparison: [...byDescription.values()],
    };
  }

  async select(user: AuthedUser, rfqId: string, dto: z.infer<typeof SelectSchema>, ip?: string) {
    const rfq = await this.byId(rfqId);
    if (rfq.status !== 'OPEN') throw new BadRequestException(`RFQ is ${rfq.status} — only OPEN RFQs can be selected`);
    const quotes = await db.select().from(schema.rfqQuotes).where(eq(schema.rfqQuotes.rfqId, rfqId));
    const quote = quotes.find((q) => q.id === dto.quoteId);
    if (!quote) throw new NotFoundException('Quote not found on this RFQ');
    const vendor = await this.vendors.byId(quote.vendorId);
    this.vendors.assertNotBlacklisted(vendor, 'winning-quote selection');

    const thresholds = await loadThresholds();
    const check = quoteRequirement(thresholds, quote.totalKobo, quotes.length, {
      soleSource: Boolean(dto.soleSource), committeeNote: Boolean(dto.committeeNote),
    });
    if (!check.ok) throw new BadRequestException(check.reason);

    await db.update(schema.rfqQuotes).set({ selected: true }).where(eq(schema.rfqQuotes.id, quote.id));
    await db.update(schema.rfqs)
      .set({ status: 'SELECTED', selectionJustification: dto.justification })
      .where(eq(schema.rfqs.id, rfqId));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'RFQ_QUOTE_SELECTED',
      entityType: 'rfq', entityId: rfq.ref,
      data: {
        quoteId: quote.id, vendor: vendor.name, totalKobo: quote.totalKobo.toString(),
        quoteCount: quotes.length, justification: dto.justification,
        soleSource: dto.soleSource ?? null, committeeNote: dto.committeeNote ?? null,
      }, ip,
    });
    return this.detail(rfqId);
  }

  async cancel(user: AuthedUser, rfqId: string, reason: string, ip?: string) {
    const rfq = await this.byId(rfqId);
    if (rfq.status !== 'OPEN') throw new BadRequestException('Only OPEN RFQs can be cancelled');
    await db.update(schema.rfqs).set({ status: 'CANCELLED' }).where(eq(schema.rfqs.id, rfqId));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'RFQ_CANCELLED',
      entityType: 'rfq', entityId: rfq.ref, data: { reason }, ip,
    });
    return this.detail(rfqId);
  }
}

@Controller('v1/rfqs')
@UseGuards(AuthGuard)
export class RfqsController {
  constructor(private readonly svc: RfqsService) {}

  @Post()
  create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    return this.svc.create(user, CreateSchema.parse(body), req.ip);
  }

  @Get()
  list(@Query('status') status?: string) {
    return this.svc.list(status);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Get(':id/comparison')
  comparison(@Param('id') id: string) {
    return this.svc.comparison(id);
  }

  @Post(':id/quotes')
  addQuote(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.addQuote(user, id, AddQuoteSchema.parse(body), req.ip);
  }

  @Post(':id/select')
  select(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.select(user, id, SelectSchema.parse(body), req.ip);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    const dto = z.object({ reason: z.string().min(5).max(1000) }).parse(body);
    return this.svc.cancel(user, id, dto.reason, req.ip);
  }
}
