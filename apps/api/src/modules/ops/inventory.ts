/**
 * INV-01..04 — Store/inventory: items CRUD, stock moves (GRN / ISSUE / ADJUST /
 * COUNT) with qtyOnHand maintained transactionally (row lock, never below zero),
 * and a low-stock endpoint that notifies Finance users.
 */
import {
  BadRequestException, Body, Controller, Get, Injectable, NotFoundException,
  Param, Patch, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, CurrentUser, type AuthedUser } from '../../auth/auth';

const CreateSchema = z.object({
  code: z.string().min(1).max(60),
  name: z.string().min(2).max(200),
  unit: z.string().min(1).max(30).optional(),
  reorderLevel: z.number().int().min(0).optional(),
  /** Opening balance — recorded as an ADJUST move so the ledger starts explicit. */
  openingQty: z.number().int().min(0).optional(),
});
const UpdateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  unit: z.string().min(1).max(30).optional(),
  reorderLevel: z.number().int().min(0).optional(),
});
const MoveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('GRN'), qty: z.number().int().positive(), refText: z.string().max(200).optional() }),
  z.object({ kind: z.literal('ISSUE'), qty: z.number().int().positive(), refText: z.string().max(200).optional() }),
  z.object({ kind: z.literal('ADJUST'), qty: z.number().int().refine((n) => n !== 0, 'Adjustment qty cannot be zero'), reason: z.string().min(5).max(500) }),
  z.object({ kind: z.literal('COUNT'), countedQty: z.number().int().min(0), refText: z.string().max(200).optional() }),
]);

@Injectable()
export class InventoryService {
  constructor(private readonly audit: AuditService) {}

  private async byId(id: string) {
    const item = await db.query.inventoryItems.findFirst({ where: eq(schema.inventoryItems.id, id) });
    if (!item) throw new NotFoundException('Inventory item not found');
    return item;
  }

  async create(user: AuthedUser, dto: z.infer<typeof CreateSchema>, ip?: string) {
    const existing = await db.query.inventoryItems.findFirst({ where: eq(schema.inventoryItems.code, dto.code) });
    if (existing) throw new BadRequestException(`Item code ${dto.code} already exists`);
    const [item] = await db.insert(schema.inventoryItems).values({
      code: dto.code, name: dto.name, unit: dto.unit ?? 'unit',
      reorderLevel: dto.reorderLevel ?? 0, qtyOnHand: dto.openingQty ?? 0,
    }).returning();
    if (dto.openingQty) {
      await db.insert(schema.inventoryMoves).values({
        itemId: item.id, kind: 'ADJUST', qty: dto.openingQty, refText: 'Opening balance', actorId: user.id,
      });
    }
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'INVENTORY_ITEM_CREATED',
      entityType: 'inventory_item', entityId: item.code,
      data: { name: dto.name, openingQty: dto.openingQty ?? 0 }, ip,
    });
    return item;
  }

  async list(q?: string) {
    const rows = await db.select().from(schema.inventoryItems).orderBy(asc(schema.inventoryItems.code));
    const filtered = q
      ? rows.filter((i) => i.code.toLowerCase().includes(q.toLowerCase()) || i.name.toLowerCase().includes(q.toLowerCase()))
      : rows;
    return filtered.map((i) => ({ ...i, lowStock: i.qtyOnHand <= i.reorderLevel }));
  }

  async detail(id: string) {
    const item = await this.byId(id);
    const moves = await db.select().from(schema.inventoryMoves)
      .where(eq(schema.inventoryMoves.itemId, id)).orderBy(desc(schema.inventoryMoves.createdAt)).limit(100);
    const history = [];
    for (const m of moves) {
      const actor = await db.query.users.findFirst({ where: eq(schema.users.id, m.actorId), columns: { name: true } });
      history.push({ id: m.id, kind: m.kind, qty: m.qty, refText: m.refText, actor: actor?.name ?? null, at: m.createdAt });
    }
    return { ...item, lowStock: item.qtyOnHand <= item.reorderLevel, moves: history };
  }

  async update(user: AuthedUser, id: string, dto: z.infer<typeof UpdateSchema>, ip?: string) {
    const item = await this.byId(id);
    const [next] = await db.update(schema.inventoryItems).set({
      name: dto.name ?? item.name, unit: dto.unit ?? item.unit,
      reorderLevel: dto.reorderLevel ?? item.reorderLevel,
    }).where(eq(schema.inventoryItems.id, id)).returning();
    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: 'INVENTORY_ITEM_UPDATED',
      entityType: 'inventory_item', entityId: item.code, data: { fields: Object.keys(dto) }, ip,
    });
    return next;
  }

  /**
   * Record a stock move. qtyOnHand is maintained inside one DB transaction with
   * the item row locked, so concurrent moves can never drive stock negative.
   */
  async recordMove(user: AuthedUser, id: string, dto: z.infer<typeof MoveSchema>, ip?: string) {
    const applied = await db.transaction(async (trx) => {
      const [item] = await trx.select().from(schema.inventoryItems)
        .where(eq(schema.inventoryItems.id, id)).for('update');
      if (!item) throw new NotFoundException('Inventory item not found');

      let delta: number;
      let moveKind: string;
      let refText: string | null;
      switch (dto.kind) {
        case 'GRN':
          delta = dto.qty; moveKind = 'GRN'; refText = dto.refText ?? null;
          break;
        case 'ISSUE':
          delta = -dto.qty; moveKind = 'ISSUE'; refText = dto.refText ?? null;
          break;
        case 'ADJUST':
          delta = dto.qty; moveKind = 'ADJUST'; refText = dto.reason;
          break;
        case 'COUNT': {
          // COUNT sets the quantity; the variance is recorded as an ADJUST move
          // (a zero-variance count still leaves a COUNT evidence row).
          delta = dto.countedQty - item.qtyOnHand;
          moveKind = delta === 0 ? 'COUNT' : 'ADJUST';
          refText = `Stock count: counted ${dto.countedQty}, system ${item.qtyOnHand}` +
            (dto.refText ? ` — ${dto.refText}` : '');
          break;
        }
      }
      const newQty = item.qtyOnHand + delta;
      if (newQty < 0) {
        throw new BadRequestException(
          `Insufficient stock: ${item.qtyOnHand} ${item.unit} on hand, move would take it to ${newQty}`,
        );
      }
      const [move] = await trx.insert(schema.inventoryMoves).values({
        itemId: id, kind: moveKind, qty: delta, refText, actorId: user.id,
      }).returning();
      await trx.update(schema.inventoryItems).set({ qtyOnHand: newQty }).where(eq(schema.inventoryItems.id, id));
      return { item, move, newQty, delta };
    });

    await this.audit.log({
      actorId: user.id, actorEmail: user.email, action: `INVENTORY_${dto.kind}`,
      entityType: 'inventory_item', entityId: applied.item.code,
      data: { moveId: applied.move.id, delta: applied.delta, qtyAfter: applied.newQty, refText: applied.move.refText }, ip,
    });
    return this.detail(id);
  }

  /**
   * Items at/below their reorder level. Also drops an UPDATE notification for
   * every Finance user (deduped: skipped while an unread one exists per item).
   */
  async lowStock() {
    const items = await db.select().from(schema.inventoryItems)
      .where(sql`${schema.inventoryItems.qtyOnHand} <= ${schema.inventoryItems.reorderLevel}`);
    let notified = 0;
    if (items.length) {
      const financeUsers = await db.select({ userId: schema.userRoles.userId })
        .from(schema.userRoles)
        .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
        .where(eq(schema.roles.code, 'FINANCE'));
      const userIds = [...new Set(financeUsers.map((r) => r.userId))];
      for (const item of items) {
        for (const userId of userIds) {
          const unread = await db.query.notifications.findFirst({
            where: and(
              eq(schema.notifications.userId, userId),
              eq(schema.notifications.kind, 'UPDATE'),
              eq(schema.notifications.entityType, 'inventory_item'),
              eq(schema.notifications.entityId, item.id),
              isNull(schema.notifications.readAt),
            ),
          });
          if (unread) continue;
          await db.insert(schema.notifications).values({
            userId, kind: 'UPDATE',
            title: `Low stock: ${item.name}`,
            body: `${item.code} is at ${item.qtyOnHand} ${item.unit} (reorder level ${item.reorderLevel}).`,
            entityType: 'inventory_item', entityId: item.id,
          });
          notified += 1;
        }
      }
    }
    return {
      items: items.map((i) => ({ ...i, lowStock: true })),
      notificationsSent: notified,
    };
  }
}

@Controller('v1/inventory')
@UseGuards(AuthGuard)
export class InventoryController {
  constructor(private readonly svc: InventoryService) {}

  @Get('low-stock')
  lowStock() {
    return this.svc.lowStock();
  }

  @Post('items')
  create(@CurrentUser() user: AuthedUser, @Body() body: unknown, @Req() req: any) {
    return this.svc.create(user, CreateSchema.parse(body), req.ip);
  }

  @Get('items')
  list(@Query('q') q?: string) {
    return this.svc.list(q);
  }

  @Get('items/:id')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Patch('items/:id')
  update(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.update(user, id, UpdateSchema.parse(body), req.ip);
  }

  @Post('items/:id/moves')
  move(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.recordMove(user, id, MoveSchema.parse(body), req.ip);
  }
}
