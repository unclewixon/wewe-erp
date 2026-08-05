/**
 * WFE-06 — stage SLA scan: reminders at >=75% of the stage SLA, escalation at >=100%.
 * Dedupe state lives in transactions.payload.slaSent = { [stageIndex]: 'reminded'|'escalated' };
 * the scan merges into payload directly and never touches updatedAt (which anchors the clock).
 */
import { Controller, Injectable, Post, UseGuards } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { db, schema } from '../../db/client';
import { AuditService } from '../../audit/audit.service';
import { AuthGuard, RequireRoles } from '../../auth/auth';
import { NotificationsService, deepLink, type Recipient } from './notifications';
import { getSetting } from './settings';
import { nextSlaAction, slaState, stageSlaHours, type PlatformStageDef, type SlaMark } from './sla.logic';

@Injectable()
export class SlaService {
  constructor(private readonly notif: NotificationsService, private readonly audit: AuditService) {}

  async scan(now = new Date()): Promise<{ scanned: number; reminded: number; escalated: number }> {
    const defaultHours = await getSetting<number>('sla.defaultHours', 24);
    const pending = await db.query.transactions.findMany({
      where: eq(schema.transactions.status, 'PENDING'),
      with: { type: true, initiator: true },
    });
    let reminded = 0; let escalated = 0;
    for (const tx of pending) {
      const payload = (tx.payload ?? {}) as { chain?: PlatformStageDef[]; slaSent?: Record<string, SlaMark> };
      const chain = payload.chain ?? (tx.type.stages as PlatformStageDef[]);
      const stage = chain[tx.currentStage];
      if (!stage) continue;
      const hours = stageSlaHours(stage, defaultHours);
      const elapsedMs = now.getTime() - tx.updatedAt.getTime();
      const action = nextSlaAction(payload.slaSent?.[String(tx.currentStage)], slaState(elapsedMs, hours));
      if (!action) continue;

      if (action === 'remind') {
        const holders = (await this.notif.roleHolders(stage.role, tx.departmentId))
          .filter((u) => u.id !== tx.initiatorId);
        await this.notif.notify(holders, {
          kind: 'ACTION_REQUIRED',
          title: `Reminder: ${tx.ref} awaits your ${stage.role} approval`,
          body: `${tx.ref} — ${tx.title} has been at the ${stage.role} stage for most of its ${hours}h SLA.`,
          entityType: 'transaction', entityId: tx.id,
          emailBody: `${tx.ref} — ${tx.title}\n\nReminder: this transaction is nearing its ${hours}h SLA at the ${stage.role} stage.\nOpen it in WEWE ERP: ${deepLink(tx.id)}\n`,
        });
        await this.audit.log({
          action: 'SLA_REMINDER_SENT', entityType: 'transaction', entityId: tx.ref,
          data: { stageIndex: tx.currentStage, role: stage.role, slaHours: hours },
        });
        reminded += 1;
      } else {
        // Escalate to the NEXT stage's role holders + the initiator's department SUPERVISOR.
        const nextStage = chain[tx.currentStage + 1];
        const recipients = new Map<string, Recipient>();
        if (nextStage) {
          for (const u of await this.notif.roleHolders(nextStage.role, tx.departmentId)) recipients.set(u.id, u);
        }
        const supDept = tx.initiator.departmentId ?? tx.departmentId;
        for (const u of await this.notif.roleHolders('SUPERVISOR', supDept)) recipients.set(u.id, u);
        recipients.delete(tx.initiatorId);
        await this.notif.notify([...recipients.values()], {
          kind: 'ESCALATION', // ESCALATION always mirrors to email_outbox, digest preference or not
          title: `SLA breached: ${tx.ref} is stuck at the ${stage.role} stage`,
          body: `${tx.ref} — ${tx.title} exceeded its ${hours}h SLA at the ${stage.role} stage without action.`,
          entityType: 'transaction', entityId: tx.id,
          emailBody: `${tx.ref} — ${tx.title}\n\nThis transaction exceeded its ${hours}h SLA at the ${stage.role} stage and has been escalated.\nOpen it in WEWE ERP: ${deepLink(tx.id)}\n`,
        });
        await this.audit.log({
          action: 'SLA_ESCALATED', entityType: 'transaction', entityId: tx.ref,
          data: { stageIndex: tx.currentStage, role: stage.role, slaHours: hours, escalatedTo: [...recipients.values()].map((r) => r.name) },
        });
        escalated += 1;
      }

      const slaSent: Record<string, SlaMark> = {
        ...(payload.slaSent ?? {}),
        [String(tx.currentStage)]: action === 'remind' ? 'reminded' : 'escalated',
      };
      // Direct payload merge; deliberately no updatedAt change — it is the SLA clock's anchor.
      await db.update(schema.transactions)
        .set({ payload: { ...(tx.payload as object ?? {}), slaSent } })
        .where(eq(schema.transactions.id, tx.id));
    }
    return { scanned: pending.length, reminded, escalated };
  }
}

@Controller('v1/admin/sla')
@UseGuards(AuthGuard)
@RequireRoles('SYSTEM_ADMIN')
export class SlaAdminController {
  constructor(private readonly sla: SlaService) {}

  /** Manual scan trigger for testing; register() also runs scan() every 60s. */
  @Post('scan')
  scan() {
    return this.sla.scan();
  }
}
