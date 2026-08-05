/**
 * NTF-01/02/03 — in-app notifications + email mirroring.
 *  - In-app rows for everything.
 *  - email_outbox rows mirror ACTION_REQUIRED (and ESCALATION) notifications.
 *  - Per-user digest preference (settings key notify.prefs.<userId>, 'instant'|'digest'):
 *    digest users still get notifications rows but outbox rows only for ESCALATION.
 */
import {
  Controller, Get, Injectable, NotFoundException, Param, Post, UseGuards,
} from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '../../db/client';
import { AuthGuard, CurrentUser, type AuthedUser } from '../../auth/auth';
import type { RoleCode } from '../../db/schema';
import { EmailService } from './email';
import { getSetting } from './settings';
import type { PlatformStageDef } from './sla.logic';
import { bus } from '../../events';

export type NotifyKind = 'ACTION_REQUIRED' | 'UPDATE' | 'ESCALATION' | 'FLAG';
export interface Recipient { id: string; email: string; name: string }

/** Deep link used in email bodies — the web app routes all transactions through this path. */
export const deepLink = (txId: string) => `/requisitions/${txId}`;

@Injectable()
export class NotificationsService {
  constructor(private readonly email: EmailService) {}

  /** All active users holding `role` for `departmentId` (org-wide grants always match; null dept = everyone with the role). */
  async roleHolders(role: RoleCode, departmentId: string | null): Promise<Recipient[]> {
    const rows = await db.select({
      id: schema.users.id, email: schema.users.email, name: schema.users.name,
      scopeDept: schema.userRoles.departmentId,
    })
      .from(schema.userRoles)
      .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
      .innerJoin(schema.users, eq(schema.userRoles.userId, schema.users.id))
      .where(and(eq(schema.roles.code, role), eq(schema.users.active, true)));
    const seen = new Set<string>();
    const out: Recipient[] = [];
    for (const r of rows) {
      const inScope = r.scopeDept === null || departmentId === null || r.scopeDept === departmentId;
      if (inScope && !seen.has(r.id)) { seen.add(r.id); out.push({ id: r.id, email: r.email, name: r.name }); }
    }
    return out;
  }

  private async digestPref(userId: string): Promise<'instant' | 'digest'> {
    const def = await getSetting<'instant' | 'digest'>('notify.defaultPref', 'instant');
    return getSetting<'instant' | 'digest'>(`notify.prefs.${userId}`, def);
  }

  /** Insert notifications rows; mirror ACTION_REQUIRED/ESCALATION to email_outbox per digest rules. */
  async notify(recipients: Recipient[], input: {
    kind: NotifyKind; title: string; body?: string;
    entityType?: string; entityId?: string; emailBody?: string;
  }): Promise<number> {
    let n = 0;
    for (const u of recipients) {
      await db.insert(schema.notifications).values({
        userId: u.id, kind: input.kind, title: input.title, body: input.body ?? null,
        entityType: input.entityType ?? null, entityId: input.entityId ?? null,
      });
      n += 1;
      if (input.kind === 'ACTION_REQUIRED' || input.kind === 'ESCALATION') {
        const pref = await this.digestPref(u.id);
        if (pref === 'instant' || input.kind === 'ESCALATION') {
          await this.email.enqueue(u.email, input.title, input.emailBody ?? input.body ?? input.title);
        }
      }
    }
    return n;
  }
}

/* ---------------- event-bus wiring (called from index.register()) ---------------- */

type SubmittedEvt = { txId: string; ref: string; typeCode: string; initiatorId: string; departmentId: string; amountKobo: string };
type StageEvt = { txId: string; ref: string; typeCode: string; verb: string; resulting: string; stageRole: RoleCode | null; actorId: string; initiatorId: string };

const chainOf = (tx: { payload: unknown; type: { stages: unknown } }): PlatformStageDef[] =>
  ((tx.payload as { chain?: PlatformStageDef[] } | null)?.chain ?? tx.type.stages) as PlatformStageDef[];

async function onTxSubmitted(svc: NotificationsService, e: SubmittedEvt): Promise<void> {
  const tx = await db.query.transactions.findFirst({ where: eq(schema.transactions.id, e.txId), with: { type: true } });
  if (!tx) return;
  const first = chainOf(tx)[0];
  if (!first) return; // fully auto-passed chain — nothing to route
  const holders = (await svc.roleHolders(first.role, tx.departmentId)).filter((u) => u.id !== tx.initiatorId);
  await svc.notify(holders, {
    kind: 'ACTION_REQUIRED',
    title: `Approval needed: ${tx.ref} — ${tx.title}`,
    body: `${tx.ref} was submitted and awaits your ${first.role} approval.`,
    entityType: 'transaction', entityId: tx.id,
    emailBody: `${tx.ref} — ${tx.title}\n\nThis transaction awaits your ${first.role} approval.\nOpen it in WEWE ERP: ${deepLink(tx.id)}\n`,
  });
}

async function onTxStage(svc: NotificationsService, e: StageEvt): Promise<void> {
  const past: Record<string, string> = { approve: 'approved', reject: 'rejected', return: 'returned for clarification' };
  const verb = past[e.verb] ?? e.verb;

  // NTF: the initiator always hears about movement on their transaction.
  if (e.initiatorId !== e.actorId) {
    const initiator = await db.query.users.findFirst({ where: eq(schema.users.id, e.initiatorId) });
    if (initiator && initiator.active) {
      await svc.notify([{ id: initiator.id, email: initiator.email, name: initiator.name }], {
        kind: 'UPDATE',
        title: `${e.ref} was ${verb}${e.stageRole ? ` at the ${e.stageRole} stage` : ''}`,
        body: `Your transaction ${e.ref} is now ${e.resulting}.`,
        entityType: 'transaction', entityId: e.txId,
      });
    }
  }

  // Still pending → the next stage's role holders have work to do.
  if (e.resulting === 'PENDING') {
    const tx = await db.query.transactions.findFirst({
      where: eq(schema.transactions.id, e.txId), with: { type: true, stageEvents: true },
    });
    if (!tx || tx.status !== 'PENDING') return;
    const stage = chainOf(tx)[tx.currentStage];
    if (!stage) return;
    const acted = new Set(tx.stageEvents.filter((s) => s.action === 'APPROVED').map((s) => s.actorId));
    const holders = (await svc.roleHolders(stage.role, tx.departmentId))
      .filter((u) => u.id !== tx.initiatorId && !acted.has(u.id)); // SoD: they could not act anyway
    await svc.notify(holders, {
      kind: 'ACTION_REQUIRED',
      title: `Approval needed: ${tx.ref} — ${tx.title}`,
      body: `${tx.ref} advanced to the ${stage.role} stage and awaits your approval.`,
      entityType: 'transaction', entityId: tx.id,
      emailBody: `${tx.ref} — ${tx.title}\n\nThis transaction awaits your ${stage.role} approval.\nOpen it in WEWE ERP: ${deepLink(tx.id)}\n`,
    });
  }
}

export function registerNotificationHandlers(svc: NotificationsService): void {
  bus.on('tx.submitted', (e: SubmittedEvt) => {
    void onTxSubmitted(svc, e).catch((err) => console.error('[platform] tx.submitted notification failed', err));
  });
  bus.on('tx.stage', (e: StageEvt) => {
    void onTxStage(svc, e).catch((err) => console.error('[platform] tx.stage notification failed', err));
  });
}

/* ---------------- endpoints ---------------- */

@Controller('v1/notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  /** NTF-02: my notifications — unread first, split into needs-action vs updates. */
  @Get()
  async list(@CurrentUser() user: AuthedUser) {
    const rows = await db.select().from(schema.notifications)
      .where(eq(schema.notifications.userId, user.id))
      .orderBy(desc(schema.notifications.createdAt)).limit(200);
    const unreadFirst = [...rows].sort((a, b) =>
      Number(a.readAt !== null) - Number(b.readAt !== null) || b.createdAt.getTime() - a.createdAt.getTime());
    const needsAction = unreadFirst.filter((r) => r.kind === 'ACTION_REQUIRED' || r.kind === 'ESCALATION');
    const updates = unreadFirst.filter((r) => r.kind !== 'ACTION_REQUIRED' && r.kind !== 'ESCALATION');
    return { needsAction, updates };
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthedUser) {
    const [row] = await db.select({ n: sql<number>`count(*)` }).from(schema.notifications)
      .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)));
    return { count: Number(row?.n ?? 0) };
  }

  @Post(':id/read')
  async markRead(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    const [row] = await db.update(schema.notifications).set({ readAt: new Date() })
      .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)))
      .returning();
    const exists = row ?? await db.query.notifications.findFirst({
      where: and(eq(schema.notifications.id, id), eq(schema.notifications.userId, user.id)),
    });
    if (!exists) throw new NotFoundException('Notification not found');
    return { ok: true };
  }

  @Post('read-all')
  async markAllRead(@CurrentUser() user: AuthedUser) {
    const rows = await db.update(schema.notifications).set({ readAt: new Date() })
      .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)))
      .returning({ id: schema.notifications.id });
    return { ok: true, marked: rows.length };
  }
}
