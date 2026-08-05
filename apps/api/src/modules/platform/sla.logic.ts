/**
 * WFE-06 — pure SLA threshold math. No I/O; unit-tested in sla.logic.spec.ts.
 */
import type { RoleCode } from '../../db/schema';

/** Stage def as stored on transaction_types.stages / frozen chains; slaHours is optional per stage. */
export type PlatformStageDef = { role: RoleCode; minAmountKobo?: string; slaHours?: number };

export type SlaState = 'ok' | 'remind' | 'escalate';
export type SlaMark = 'reminded' | 'escalated';

export const REMINDER_FRACTION = 0.75;

/** Effective SLA hours for a stage: its own slaHours, else the platform default ('sla.defaultHours'). */
export function stageSlaHours(stage: PlatformStageDef | undefined, defaultHours: number): number {
  return stage?.slaHours ?? defaultHours;
}

/** Where elapsed time sits against the stage SLA: >=100% escalate, >=75% remind, else ok. */
export function slaState(elapsedMs: number, slaHours: number): SlaState {
  const totalMs = slaHours * 3600_000;
  if (totalMs <= 0) return 'ok';
  if (elapsedMs >= totalMs) return 'escalate';
  if (elapsedMs >= totalMs * REMINDER_FRACTION) return 'remind';
  return 'ok';
}

/**
 * Dedupe: what (if anything) to send now, given what was already sent for this stage
 * (transactions.payload.slaSent[stageIndex]). Each stage of each transaction gets at most
 * one reminder and one escalation; escalation still fires if the reminder window was skipped.
 */
export function nextSlaAction(prev: SlaMark | undefined, state: SlaState): 'remind' | 'escalate' | null {
  if (state === 'escalate' && prev !== 'escalated') return 'escalate';
  if (state === 'remind' && prev === undefined) return 'remind';
  return null;
}
