/**
 * DSH-02 (backend): per-stage turnaround analytics from stage_events.
 * Median + p90 hours per stage role, volume, and the current bottleneck
 * (stage role holding the most PENDING items, with their average wait).
 * Pure computation lives in governance.logic.ts (vitest-covered).
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { db, schema } from '../../db/client';
import { AuthGuard } from '../../auth/auth';
import type { StageDef } from '../../workflow/engine.logic';
import {
  computeStageDurations, findBottleneck, pendingByRole, summariseStages,
} from './governance.logic';

@Controller('v1/analytics/pipeline')
@UseGuards(AuthGuard)
export class PipelineAnalyticsController {

  @Get()
  async stats() {
    const now = Date.now();

    const events = await db.select({
      transactionId: schema.stageEvents.transactionId,
      role: schema.stageEvents.role,
      action: schema.stageEvents.action,
      at: schema.stageEvents.createdAt,
    }).from(schema.stageEvents).orderBy(asc(schema.stageEvents.createdAt)).limit(20000);

    const stages = summariseStages(computeStageDurations(events));

    const pendingTxs = await db.query.transactions.findMany({
      where: eq(schema.transactions.status, 'PENDING'),
      with: { type: true, stageEvents: true },
    });
    const pending = pendingTxs.map((tx) => {
      const chain = ((tx.payload as any)?.chain as StageDef[] | undefined) ?? (tx.type.stages as StageDef[]);
      const role = chain[tx.currentStage]?.role ?? 'UNKNOWN';
      const times = tx.stageEvents.map((e) => e.createdAt.getTime());
      const waitingSince = times.length
        ? Math.max(...times)
        : (tx.submittedAt?.getTime() ?? tx.createdAt.getTime());
      return { role, waitingHours: (now - waitingSince) / 3600_000 };
    });

    return {
      stages,                                  // [{ role, volume, medianHours, p90Hours }]
      pendingByRole: pendingByRole(pending),   // [{ role, count, avgWaitHours }]
      bottleneck: findBottleneck(pending),     // { role, count, avgWaitHours } | null
      pendingTotal: pending.length,
      computedAt: new Date(now),
    };
  }
}
