/**
 * Roles & Permissions — pure catalog + segregation-of-duties logic. No I/O; tested
 * in permissions.logic.spec.ts.
 */
import type { RoleCode } from '../../db/schema';

export const PERMISSION_MODULES = [
  'requisitions', 'advances', 'retirements', 'budgets', 'payroll', 'quickbooks',
  'procurement', 'inventory', 'assets', 'documents', 'esign', 'hr', 'timesheets',
  'grants', 'audit', 'reports', 'admin',
] as const;

export const PERMISSION_ACTIONS = ['VIEW', 'CREATE', 'EDIT', 'SUBMIT', 'APPROVE', 'EXPORT', 'CONFIGURE'] as const;

export const PERMISSION_SCOPES = ['own', 'department', 'organisation'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];
export const isKnownScope = (s: string): s is PermissionScope => (PERMISSION_SCOPES as readonly string[]).includes(s);

export interface PermGrant { module: string; action: string; scope: PermissionScope }

const SCOPE_RANK: Record<PermissionScope, number> = { own: 0, department: 1, organisation: 2 };
export const widerScope = (a: PermissionScope, b: PermissionScope): PermissionScope =>
  SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;

/** Modules whose records flow through the approval workflow — where SUBMIT vs APPROVE must separate. */
const WORKFLOW_MODULES = ['requisitions', 'advances', 'retirements', 'payroll', 'procurement', 'timesheets'];

/**
 * SoD-conflicting action pairs, defined in code (Roles & Permissions module).
 * A conflict exists when ONE role holds BOTH actions on the SAME module at organisation scope.
 */
export const SOD_CONFLICT_PAIRS: { a: string; b: string; modules: string[]; why: string }[] = [
  {
    a: 'SUBMIT', b: 'APPROVE', modules: WORKFLOW_MODULES,
    why: 'a role that submits these transactions organisation-wide cannot also approve them — submitters and approvers must be different hands',
  },
  {
    a: 'EDIT', b: 'APPROVE', modules: WORKFLOW_MODULES,
    why: 'approvers never edit the values they approve (ground rule: SoD lives in the platform, not in trust)',
  },
];

/** Human-readable violations for a proposed grant set; empty array = acceptable. */
export function sodViolations(grants: PermGrant[]): string[] {
  const holdsAtOrg = (module: string, action: string) =>
    grants.some((g) => g.module === module && g.action === action && g.scope === 'organisation');
  const out: string[] = [];
  for (const pair of SOD_CONFLICT_PAIRS) {
    for (const m of pair.modules) {
      if (holdsAtOrg(m, pair.a) && holdsAtOrg(m, pair.b)) {
        out.push(`${m}: ${pair.a} + ${pair.b} at organisation scope is a segregation-of-duties conflict — ${pair.why}.`);
      }
    }
  }
  return out;
}

const TX_MODULES = ['requisitions', 'advances', 'retirements', 'timesheets'];
const grant = (modules: string[], actions: string[], scope: PermissionScope): PermGrant[] =>
  modules.flatMap((module) => actions.map((action) => ({ module, action, scope })));

/** Default grants per system role — seeded once, then admin-managed via the matrix. SoD-clean (tested). */
export const DEFAULT_ROLE_GRANTS: Record<RoleCode, PermGrant[]> = {
  INITIATOR: [
    ...grant(TX_MODULES, ['VIEW', 'CREATE', 'EDIT', 'SUBMIT'], 'own'),
    ...grant(['documents'], ['VIEW', 'CREATE'], 'own'),
    ...grant(['reports'], ['VIEW'], 'own'),
  ],
  SUPERVISOR: [
    ...grant(TX_MODULES, ['VIEW', 'APPROVE'], 'department'),
    ...grant(['budgets', 'reports', 'documents'], ['VIEW'], 'department'),
  ],
  INTERNAL_AUDIT: [
    ...grant([...PERMISSION_MODULES], ['VIEW'], 'organisation'),
    ...grant(['audit'], ['EXPORT'], 'organisation'),
  ],
  FINANCE: [
    ...grant(['budgets'], ['VIEW', 'CREATE', 'EDIT', 'EXPORT', 'CONFIGURE'], 'organisation'),
    ...grant(['quickbooks'], ['VIEW', 'EXPORT', 'CONFIGURE'], 'organisation'),
    ...grant(TX_MODULES, ['VIEW', 'APPROVE'], 'organisation'),
    ...grant(['payroll'], ['VIEW', 'APPROVE', 'EXPORT'], 'organisation'),
    ...grant(['procurement', 'grants'], ['VIEW'], 'organisation'),
    ...grant(['reports'], ['VIEW', 'EXPORT'], 'organisation'),
  ],
  FINAL_APPROVER: [
    ...grant([...TX_MODULES, 'payroll', 'procurement', 'budgets'], ['VIEW', 'APPROVE'], 'organisation'),
    ...grant(['reports', 'grants'], ['VIEW'], 'organisation'),
  ],
  HR_OFFICER: [
    ...grant(['hr'], ['VIEW', 'CREATE', 'EDIT', 'CONFIGURE'], 'organisation'),
    ...grant(['payroll'], ['VIEW', 'CREATE', 'EDIT'], 'organisation'),
    ...grant(['timesheets'], ['VIEW'], 'organisation'),
    ...grant(['documents'], ['VIEW'], 'department'),
  ],
  SYSTEM_ADMIN: [
    ...grant(['admin'], [...PERMISSION_ACTIONS], 'organisation'),
    ...grant([...PERMISSION_MODULES], ['VIEW', 'CONFIGURE'], 'organisation'),
  ],
};
