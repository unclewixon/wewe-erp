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
const APPROVAL_MODULES = [...TX_MODULES, 'hr', 'budgets', 'documents', 'assets', 'payroll']; // everything routed through the engine
const grant = (modules: string[], actions: string[], scope: PermissionScope): PermGrant[] =>
  modules.flatMap((module) => actions.map((action) => ({ module, action, scope })));

/** Default grants per system role — seeded once, then admin-managed via the matrix. SoD-clean (tested). */
export const DEFAULT_ROLE_GRANTS: Record<RoleCode, PermGrant[]> = {
  INITIATOR: [
    ...grant(TX_MODULES, ['VIEW', 'CREATE', 'EDIT', 'SUBMIT'], 'own'),
    ...grant(['hr'], ['VIEW', 'CREATE', 'SUBMIT'], 'own'),          // leave requests, own profile
    ...grant(['documents', 'esign'], ['VIEW', 'CREATE'], 'own'),
    ...grant(['procurement'], ['VIEW', 'CREATE', 'EDIT'], 'own'),   // vendor proposals, receipts
    ...grant(['inventory'], ['VIEW', 'CREATE', 'EDIT'], 'own'),     // GRN/issue by store officers
    ...grant(['reports', 'payroll'], ['VIEW'], 'own'),              // own payslips
  ],
  SUPERVISOR: [
    ...grant([...TX_MODULES, 'hr'], ['VIEW', 'APPROVE'], 'department'), // stage 2 incl. leave
    ...grant(['hr'], ['EDIT'], 'department'),                            // checklist items they own
    ...grant(['budgets', 'reports', 'documents'], ['VIEW'], 'department'),
  ],
  INTERNAL_AUDIT: [
    ...grant([...PERMISSION_MODULES], ['VIEW'], 'organisation'),
    ...grant(APPROVAL_MODULES, ['APPROVE'], 'organisation'),        // stage 3 across engine types
    ...grant(['audit'], ['CREATE', 'EDIT', 'APPROVE', 'EXPORT', 'CONFIGURE'], 'organisation'), // flags, findings, evidence, checklists
    ...grant(['documents'], ['EDIT'], 'organisation'),              // legal hold
    ...grant(['reports'], ['EXPORT'], 'organisation'),
  ],
  FINANCE: [
    ...grant(['budgets'], ['VIEW', 'CREATE', 'EDIT', 'SUBMIT', 'APPROVE', 'EXPORT', 'CONFIGURE'], 'organisation'),
    ...grant(['quickbooks'], ['VIEW', 'EDIT', 'EXPORT', 'CONFIGURE'], 'organisation'), // repost/exception handling
    ...grant(TX_MODULES, ['VIEW', 'APPROVE'], 'organisation'),      // stage 4; disburse/settle map to APPROVE
    ...grant(['payroll'], ['VIEW', 'APPROVE', 'EXPORT'], 'organisation'),
    ...grant(['procurement'], ['VIEW', 'CREATE', 'EDIT'], 'organisation'),  // vendor confirm, contracts (no engine approval here)
    ...grant(['assets', 'inventory'], ['VIEW', 'EDIT', 'APPROVE'], 'organisation'),
    ...grant(['grants'], ['VIEW', 'CREATE', 'EDIT'], 'organisation'),
    ...grant(['reports'], ['VIEW', 'CREATE', 'EXPORT'], 'organisation'),               // schedules
    ...grant(['hr', 'documents'], ['VIEW'], 'organisation'),
  ],
  /**
   * PROC-01. Runs sourcing end to end — issue the RFQ, take quotes, award, raise the PO,
   * receipt the goods — and approves none of it. SUBMIT without APPROVE on procurement is
   * what keeps this SoD-clean: the award proposes a commitment, the workflow disposes.
   * Finance keeps vendor bank confirmation and contracts; this role does not touch them.
   */
  PROCUREMENT_OFFICER: [
    ...grant(['procurement'], ['VIEW', 'CREATE', 'EDIT', 'SUBMIT', 'EXPORT'], 'organisation'),
    ...grant(['inventory'], ['VIEW', 'CREATE', 'EDIT'], 'organisation'),   // goods receipt into stores
    ...grant(['documents', 'esign'], ['VIEW', 'CREATE'], 'own'),
    ...grant(['budgets', 'reports'], ['VIEW'], 'organisation'),            // spend against line, before awarding
  ],
  FINAL_APPROVER: [
    ...grant(APPROVAL_MODULES, ['VIEW', 'APPROVE'], 'organisation'),                   // stage 5 everywhere
    ...grant(['procurement'], ['VIEW', 'APPROVE'], 'organisation'),
    ...grant(['reports', 'grants', 'audit', 'quickbooks', 'esign', 'inventory'], ['VIEW'], 'organisation'),
  ],
  HR_OFFICER: [
    ...grant(['hr'], ['VIEW', 'CREATE', 'EDIT', 'SUBMIT', 'APPROVE', 'CONFIGURE'], 'organisation'), // leave stage 2/HR stage
    ...grant(['payroll'], ['VIEW', 'CREATE', 'EDIT', 'SUBMIT'], 'organisation'),
    ...grant(['timesheets', 'reports'], ['VIEW'], 'organisation'),
    ...grant(['documents', 'esign'], ['VIEW', 'CREATE'], 'organisation'),              // HR letters, contracts to sign
  ],
  SYSTEM_ADMIN: [
    ...grant(['admin'], [...PERMISSION_ACTIONS], 'organisation'),
    ...grant([...PERMISSION_MODULES], ['VIEW', 'CONFIGURE'], 'organisation'),
  ],
  EXTERNAL_AUDITOR: [
    ...grant(['requisitions', 'advances', 'retirements', 'audit', 'reports', 'documents'], ['VIEW'], 'organisation'),
  ],
};
