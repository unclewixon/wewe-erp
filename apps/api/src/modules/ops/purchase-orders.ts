/**
 * PRC-03 — Purchase orders: generate from the selected RFQ quote, goods receipt
 * (partial, per line, OPEN→PARTIAL→CLOSED), printable-data endpoint, and the
 * order-splitting report (rolling 30-day vendor+category aggregation over the
 * single-quote threshold).
 */
import {
  BadRequestException, Body, Controller, Get, Injectable, NotFoundException,
  Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, RequireRoles, type AuthedUser } from '../../auth/auth';
import { WorkflowService } from '../../workflow/workflow.service';
import { applyReceipt, orderSplittingFlags, type PoLine } from './ops.logic';
import { loadThresholds, tableRef } from './shared';
import { VendorsService } from './vendors';
import type { QuoteLine } from './rfqs';

/** WEWE organisation block for the printable PO (rendered by the design bundle, not here). */
const WEWE_ORG_BLOCK = {
  name: 'Widows and Orphans Empowerment Organisation (WEWE)',
  shortName: 'WEWE',
  address: 'Abuja, Federal Capital Territory, Nigeria',
  country: 'Nigeria',
};

const CreateSchema = z.object({ rfqId: z.string().min(1) });
const ReceiptSchema = z.object({
  lines: z.array(z.object({ lineIndex: z.number().int().min(0), qty: z.number().int() })).min(1).max(100),
  note: z.string().max(1000).optional(),
});

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly vendors: VendorsService,
  ) {}

  async byId(id: string) {
    const po = await db.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.id, id) });
    if (!po) throw new NotFoundException('Purchase order not found');
    return po;
  }

  private out(po: typeof schema.purchaseOrders.$inferSelect) {
    return {
      id: po.id, ref: po.ref, rfqId: po.rfqId, requisitionTxId: po.requisitionTxId,
      vendorId: po.vendorId, totalKobo: po.totalKobo.toString(),
      lines: (po.lines as PoLine[]).map((l) => ({ ...l, receivedQty: l.receivedQty ?? 0 })),
      status: po.status, issuedAt: po.issuedAt,
    };
  }

  /** Generate a PO from an RFQ's selected quote. */
  async createFromRfq(user: AuthedUser, rfqId: string, ip?: string) {
    const rfq = await db.query.rfqs.findFirst({ where: eq(schema.rfqs.id, rfqId) });
    if (!rfq) throw new NotFoundException('RFQ not found');
    if (rfq.status !== 'SELECTED') throw new BadRequestException('Select a winning quote before generating a PO');
    const existing = await db.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.rfqId, rfqId) });
    if (existing) throw new BadRequestException(`A PO already exists for this RFQ (${existing.ref})`);
    const quotes = await db.select().from(schema.rfqQuotes).where(eq(schema.rfqQuotes.rfqId, rfqId));
    const quote = quotes.find((q) => q.selected);
    if (!quote) throw new BadRequestException('This RFQ has no selected quote');

    const vendor = await this.vendors.byId(quote.vendorId);
    this.vendors.assertNotBlacklisted(vendor, 'raising a purchase order');

    // Copy quote lines; a lines-free quote becomes a single lump-sum line.
    const quoteLines = Array.isArray(quote.lines) ? (quote.lines as QuoteLine[]) : [];
    const lines: PoLine[] = quoteLines.length
      ? quoteLines.map((l) => ({ description: l.description, qty: l.qty, unitKobo: l.unitKobo, receivedQty: 0 }))
      : [{ description: rfq.title, qty: 1, unitKobo: quote.totalKobo.toString(), receivedQty: 0 }];

    // A PO raised against a requisition may never exceed the approved amount.
    if (rfq.requisitionTxId) {
      const reqTx = await db.query.transactions.findFirst({ where: eq(schema.transactions.id, rfq.requisitionTxId) });
      if (reqTx && quote.totalKobo > reqTx.amountKobo) {
        throw new BadRequestException(
          `PO total ${quote.totalKobo} kobo exceeds the approved requisition ${reqTx.ref} amount ${reqTx.amountKobo} kobo`,
        );
      }
    }

    const ref = await tableRef(this.workflow, 'PO',
      async (r) => Boolean(await db.query.purchaseOrders.findFirst({ where: eq(schema.purchaseOrders.ref, r) })));
    const [po] = await db.insert(schema.purchaseOrders).values({
      ref, requisitionTxId: rfq.requisitionTxId, rfqId, vendorId: quote.vendorId,
      totalKobo: quote.totalKobo, lines,
    }).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'PO_CREATED',
      entityType: 'purchase_order', entityId: ref,
      data: { rfqRef: rfq.ref, vendor: vendor.name, totalKobo: quote.totalKobo.toString(), lines: lines.length }, ip,
    });
    return this.detail(po.id);
  }

  async list(vendorId?: string, status?: string) {
    const rows = await db.select().from(schema.purchaseOrders).orderBy(desc(schema.purchaseOrders.issuedAt)).limit(300);
    const out = [];
    for (const po of rows) {
      if (vendorId && po.vendorId !== vendorId) continue;
      if (status && po.status !== status) continue;
      const vendor = await db.query.vendors.findFirst({ where: eq(schema.vendors.id, po.vendorId), columns: { name: true } });
      out.push({ ...this.out(po), vendorName: vendor?.name ?? null });
    }
    return out;
  }

  async detail(id: string) {
    const po = await this.byId(id);
    const vendor = await db.query.vendors.findFirst({ where: eq(schema.vendors.id, po.vendorId) });
    const receipts = await db.select().from(schema.poReceipts).where(eq(schema.poReceipts.poId, id));
    const receiptRows = [];
    for (const r of receipts) {
      const by = await db.query.users.findFirst({ where: eq(schema.users.id, r.receivedById), columns: { name: true } });
      receiptRows.push({ id: r.id, lines: r.lines, note: r.note, receivedBy: by?.name ?? null, receivedAt: r.receivedAt });
    }
    const requisition = po.requisitionTxId
      ? await db.query.transactions.findFirst({ where: eq(schema.transactions.id, po.requisitionTxId) })
      : null;
    const rfq = po.rfqId ? await db.query.rfqs.findFirst({ where: eq(schema.rfqs.id, po.rfqId) }) : null;
    return {
      ...this.out(po),
      vendor: vendor ? { id: vendor.id, name: vendor.name, blacklisted: vendor.blacklisted } : null,
      requisition: requisition ? { txId: requisition.id, ref: requisition.ref, amountKobo: requisition.amountKobo.toString() } : null,
      rfqRef: rfq?.ref ?? null,
      receipts: receiptRows.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()),
    };
  }

  /** Record a (possibly partial) goods receipt; PO status follows OPEN→PARTIAL→CLOSED. */
  async recordReceipt(user: AuthedUser, poId: string, dto: z.infer<typeof ReceiptSchema>, ip?: string) {
    const po = await this.byId(poId);
    if (po.status === 'CLOSED' || po.status === 'CANCELLED') {
      throw new BadRequestException(`PO ${po.ref} is ${po.status} — no further receipts can be recorded`);
    }
    let applied;
    try {
      applied = applyReceipt(po.lines as PoLine[], dto.lines);
    } catch (e: any) {
      throw new BadRequestException(String(e?.message ?? e));
    }
    await db.insert(schema.poReceipts).values({
      poId, lines: dto.lines, note: dto.note ?? null, receivedById: user.id,
    });
    await db.update(schema.purchaseOrders)
      .set({ lines: applied.lines, status: applied.status })
      .where(eq(schema.purchaseOrders.id, poId));
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'PO_RECEIPT_RECORDED',
      entityType: 'purchase_order', entityId: po.ref,
      data: { lines: dto.lines, note: dto.note ?? null, resultingStatus: applied.status }, ip,
    });
    return this.detail(poId);
  }

  /** All fields needed by the front end to render the printable PO — no markup here. */
  async printable(id: string) {
    const po = await this.byId(id);
    const vendor = await db.query.vendors.findFirst({ where: eq(schema.vendors.id, po.vendorId) });
    const requisition = po.requisitionTxId
      ? await db.query.transactions.findFirst({ where: eq(schema.transactions.id, po.requisitionTxId) })
      : null;
    const rfq = po.rfqId ? await db.query.rfqs.findFirst({ where: eq(schema.rfqs.id, po.rfqId) }) : null;
    const lines = (po.lines as PoLine[]).map((l, i) => ({
      lineNo: i + 1, description: l.description, qty: l.qty, unitKobo: l.unitKobo,
      lineTotalKobo: (BigInt(l.qty) * BigInt(l.unitKobo)).toString(),
      receivedQty: l.receivedQty ?? 0,
    }));
    const { pendingBankDetails: _omit, ...vendorContact } = ((vendor?.contact ?? {}) as Record<string, unknown>);
    return {
      org: WEWE_ORG_BLOCK,
      po: { id: po.id, ref: po.ref, status: po.status, issuedAt: po.issuedAt, totalKobo: po.totalKobo.toString(), currency: 'NGN' },
      vendor: vendor
        ? { id: vendor.id, name: vendor.name, tin: vendor.tin, contact: vendorContact, bankDetails: vendor.bankDetails }
        : null,
      requisitionRef: requisition?.ref ?? null,
      rfqRef: rfq?.ref ?? null,
      lines,
    };
  }

  /**
   * Order-splitting report: same vendor + category purchases inside a rolling
   * 30-day window whose aggregate exceeds the single-quote threshold. The PO row
   * carries no category, so the vendor's primary category stands in for it.
   */
  async orderSplittingReport() {
    const thresholds = await loadThresholds();
    const singleQuoteMax = BigInt(thresholds[0]?.maxKobo ?? '10000000');
    const pos = await db.select().from(schema.purchaseOrders)
      .where(ne(schema.purchaseOrders.status, 'CANCELLED'));
    const vendorsById = new Map<string, { name: string; category: string }>();
    for (const po of pos) {
      if (vendorsById.has(po.vendorId)) continue;
      const v = await db.query.vendors.findFirst({ where: eq(schema.vendors.id, po.vendorId) });
      const category = Array.isArray(v?.categories) && (v.categories as string[]).length
        ? (v.categories as string[])[0] : 'UNCATEGORISED';
      vendorsById.set(po.vendorId, { name: v?.name ?? '(deleted)', category });
    }
    const flags = orderSplittingFlags(
      pos.map((po) => ({
        ref: po.ref, vendorId: po.vendorId,
        vendorName: vendorsById.get(po.vendorId)?.name,
        category: vendorsById.get(po.vendorId)?.category ?? 'UNCATEGORISED',
        totalKobo: po.totalKobo, issuedAt: po.issuedAt,
      })),
      singleQuoteMax, 30,
    );
    return { windowDays: 30, singleQuoteThresholdKobo: singleQuoteMax.toString(), flags };
  }
}

@Controller('v1/purchase-orders')
@UseGuards(AuthGuard)
export class PurchaseOrdersController {
  constructor(private readonly svc: PurchaseOrdersService) {}

  // Static routes before ':id' so Nest matches them first.
  @Get('reports/order-splitting')
  orderSplitting() {
    return this.svc.orderSplittingReport();
  }

  /** PROC-01: raising a purchase order commits the organisation to pay. Not open to anyone
   *  with a login, and not to Finance, who release the payment against it. */
  @Post()
  @RequireRoles('PROCUREMENT_OFFICER', 'SYSTEM_ADMIN')
  create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    const dto = CreateSchema.parse(body);
    return this.svc.createFromRfq(user, dto.rfqId, req.ip);
  }

  @Get()
  list(@Query('vendorId') vendorId?: string, @Query('status') status?: string) {
    return this.svc.list(vendorId, status);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Get(':id/printable')
  printable(@Param('id') id: string) {
    return this.svc.printable(id);
  }

  /**
   * Goods receipt. Guarded because it was open to any login, but note the residual weakness:
   * the officer who raised the PO can still sign for its delivery. Properly this belongs to
   * whoever runs the store, and there is no stores role yet — recorded rather than papered
   * over with a guard that only looks like separation.
   */
  @Post(':id/receipts')
  @RequireRoles('PROCUREMENT_OFFICER', 'SYSTEM_ADMIN')
  receipt(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.recordReceipt(user, id, ReceiptSchema.parse(body), req.ip);
  }
}
