import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_GRANTS, PERMISSION_ACTIONS, PERMISSION_MODULES, isKnownScope, sodViolations,
  widerScope, type PermGrant,
} from './permissions.logic';

const g = (module: string, action: string, scope: PermGrant['scope']): PermGrant => ({ module, action, scope });

describe('Roles & Permissions — SoD pair validation', () => {
  it('blocks SUBMIT + APPROVE on the same module at organisation scope, with an explanation', () => {
    const v = sodViolations([g('requisitions', 'SUBMIT', 'organisation'), g('requisitions', 'APPROVE', 'organisation')]);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('requisitions');
    expect(v[0]).toContain('SUBMIT + APPROVE');
    expect(v[0]).toContain('segregation-of-duties');
  });

  it('blocks EDIT + APPROVE at organisation scope (approvers never edit values)', () => {
    const v = sodViolations([g('advances', 'EDIT', 'organisation'), g('advances', 'APPROVE', 'organisation')]);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('advances');
  });

  it('does not flag the pair below organisation scope', () => {
    expect(sodViolations([g('requisitions', 'SUBMIT', 'own'), g('requisitions', 'APPROVE', 'department')])).toHaveLength(0);
    expect(sodViolations([g('requisitions', 'SUBMIT', 'department'), g('requisitions', 'APPROVE', 'department')])).toHaveLength(0);
  });

  it('does not flag the pair across different modules', () => {
    expect(sodViolations([g('requisitions', 'SUBMIT', 'organisation'), g('advances', 'APPROVE', 'organisation')])).toHaveLength(0);
  });

  it('does not flag non-workflow modules', () => {
    expect(sodViolations([g('reports', 'SUBMIT', 'organisation'), g('reports', 'APPROVE', 'organisation')])).toHaveLength(0);
  });

  it('reports every conflicting module in one pass', () => {
    const v = sodViolations([
      g('requisitions', 'SUBMIT', 'organisation'), g('requisitions', 'APPROVE', 'organisation'),
      g('payroll', 'SUBMIT', 'organisation'), g('payroll', 'APPROVE', 'organisation'),
    ]);
    expect(v).toHaveLength(2);
  });
});

describe('scope handling', () => {
  it('accepts only own | department | organisation', () => {
    expect(isKnownScope('own')).toBe(true);
    expect(isKnownScope('department')).toBe(true);
    expect(isKnownScope('organisation')).toBe(true);
    expect(isKnownScope('organization')).toBe(false);
    expect(isKnownScope('global')).toBe(false);
  });

  it('unions to the widest scope', () => {
    expect(widerScope('own', 'department')).toBe('department');
    expect(widerScope('organisation', 'department')).toBe('organisation');
    expect(widerScope('own', 'own')).toBe('own');
  });
});

describe('seeded defaults', () => {
  it('catalog axes are complete', () => {
    expect(PERMISSION_MODULES).toHaveLength(17);
    expect(PERMISSION_ACTIONS).toHaveLength(7);
  });

  it('every default role grant set is SoD-clean and uses known modules/actions', () => {
    for (const [role, grants] of Object.entries(DEFAULT_ROLE_GRANTS)) {
      expect(sodViolations(grants), `${role} defaults violate SoD`).toHaveLength(0);
      for (const grant of grants) {
        expect(PERMISSION_MODULES).toContain(grant.module);
        expect(PERMISSION_ACTIONS).toContain(grant.action);
        expect(isKnownScope(grant.scope)).toBe(true);
      }
    }
  });

  it('gives FINANCE budgets+quickbooks CONFIGURE and INTERNAL_AUDIT VIEW everywhere + audit EXPORT', () => {
    const fin = DEFAULT_ROLE_GRANTS.FINANCE;
    expect(fin).toContainEqual(g('budgets', 'CONFIGURE', 'organisation'));
    expect(fin).toContainEqual(g('quickbooks', 'CONFIGURE', 'organisation'));
    const ia = DEFAULT_ROLE_GRANTS.INTERNAL_AUDIT;
    for (const m of PERMISSION_MODULES) expect(ia).toContainEqual(g(m, 'VIEW', 'organisation'));
    expect(ia).toContainEqual(g('audit', 'EXPORT', 'organisation'));
  });

  it('keeps INITIATOR at own scope on transaction modules', () => {
    for (const grant of DEFAULT_ROLE_GRANTS.INITIATOR) expect(grant.scope).toBe('own');
  });
});
