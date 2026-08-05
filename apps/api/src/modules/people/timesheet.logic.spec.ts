import { describe, it, expect } from 'vitest';
import { validateTimesheetRows } from './timesheet.logic';

describe('validateTimesheetRows — TLS-01 exact-100 rule', () => {
  it('accepts rows totalling exactly 100', () => {
    expect(validateTimesheetRows([
      { projectCode: 'USAID-01', percent: 60 }, { projectCode: 'ORG', percent: 40 },
    ])).toEqual({ ok: true });
    expect(validateTimesheetRows([{ projectCode: 'ORG', percent: 100 }])).toEqual({ ok: true });
  });

  it('rejects totals of 99 and 101', () => {
    expect(validateTimesheetRows([{ projectCode: 'A', percent: 60 }, { projectCode: 'B', percent: 39 }]).ok).toBe(false);
    expect(validateTimesheetRows([{ projectCode: 'A', percent: 60 }, { projectCode: 'B', percent: 41 }]).ok).toBe(false);
  });

  it('rejects empty rows, blank codes, duplicates and non-integer percents', () => {
    expect(validateTimesheetRows([]).ok).toBe(false);
    expect(validateTimesheetRows([{ projectCode: '  ', percent: 100 }]).ok).toBe(false);
    expect(validateTimesheetRows([{ projectCode: 'A', percent: 50 }, { projectCode: 'A', percent: 50 }]).ok).toBe(false);
    expect(validateTimesheetRows([{ projectCode: 'A', percent: 50.5 }, { projectCode: 'B', percent: 49.5 }]).ok).toBe(false);
    expect(validateTimesheetRows([{ projectCode: 'A', percent: 0 }, { projectCode: 'B', percent: 100 }]).ok).toBe(false);
  });
});
