import { describe, expect, it } from 'vitest';
import { nextSlaAction, slaState, stageSlaHours } from './sla.logic';

const H = 3600_000;

describe('WFE-06 SLA threshold math', () => {
  it('is ok below 75% of the stage SLA', () => {
    expect(slaState(0, 24)).toBe('ok');
    expect(slaState(17 * H, 24)).toBe('ok');
    expect(slaState(18 * H - 1, 24)).toBe('ok'); // 75% of 24h = 18h
  });

  it('reminds from exactly 75% up to (not including) 100%', () => {
    expect(slaState(18 * H, 24)).toBe('remind');
    expect(slaState(23 * H, 24)).toBe('remind');
    expect(slaState(24 * H - 1, 24)).toBe('remind');
  });

  it('escalates at and beyond 100%', () => {
    expect(slaState(24 * H, 24)).toBe('escalate');
    expect(slaState(100 * H, 24)).toBe('escalate');
  });

  it('honours per-stage slaHours over the platform default', () => {
    expect(stageSlaHours({ role: 'SUPERVISOR', slaHours: 4 }, 24)).toBe(4);
    expect(stageSlaHours({ role: 'SUPERVISOR' }, 24)).toBe(24);
    expect(slaState(3 * H, 4)).toBe('remind'); // 75% of 4h
    expect(slaState(4 * H, 4)).toBe('escalate');
  });

  it('never fires on a non-positive SLA', () => {
    expect(slaState(50 * H, 0)).toBe('ok');
  });

  describe('dedupe: once per stage per transaction', () => {
    it('sends the reminder only when nothing was sent for the stage', () => {
      expect(nextSlaAction(undefined, 'remind')).toBe('remind');
      expect(nextSlaAction('reminded', 'remind')).toBeNull();
      expect(nextSlaAction('escalated', 'remind')).toBeNull();
    });

    it('escalates once, even if the reminder window was skipped', () => {
      expect(nextSlaAction(undefined, 'escalate')).toBe('escalate'); // overshoot straight past 75%
      expect(nextSlaAction('reminded', 'escalate')).toBe('escalate');
      expect(nextSlaAction('escalated', 'escalate')).toBeNull();
    });

    it('does nothing while within SLA', () => {
      expect(nextSlaAction(undefined, 'ok')).toBeNull();
      expect(nextSlaAction('reminded', 'ok')).toBeNull();
    });
  });
});
