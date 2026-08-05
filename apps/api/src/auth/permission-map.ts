/**
 * Runtime enforcement of the granular permission matrix (Roles & Permissions module).
 * Maps request path+method → (module, action) so AuthGuard can consult role_permissions.
 * Explicit table, not inference — unmapped prefixes are personal/meta surfaces the
 * matrix does not govern (dashboard, notifications, own delegations, auth).
 */
export const MODULE_BY_PREFIX: [string, string][] = [
  ['/v1/requisitions', 'requisitions'],
  ['/v1/advances', 'advances'],
  ['/v1/retirements', 'retirements'],
  ['/v1/budgets', 'budgets'],
  ['/v1/virements', 'budgets'],
  ['/v1/qb', 'quickbooks'],
  ['/v1/dms', 'documents'],
  ['/v1/esign/requests', 'esign'], // external token routes are unauthenticated by design
  ['/v1/esign/verify', 'esign'],
  ['/v1/staff', 'hr'],
  ['/v1/leave', 'hr'],
  ['/v1/checklists', 'hr'],
  ['/v1/timesheets', 'timesheets'],
  ['/v1/payroll', 'payroll'],
  ['/v1/vendors', 'procurement'],
  ['/v1/rfqs', 'procurement'],
  ['/v1/purchase-orders', 'procurement'],
  ['/v1/contracts', 'procurement'],
  ['/v1/assets', 'assets'],
  ['/v1/asset-campaigns', 'assets'],
  ['/v1/inventory', 'inventory'],
  ['/v1/grants', 'grants'],
  ['/v1/grant-deadlines', 'grants'],
  ['/v1/audit-flags', 'audit'],
  ['/v1/findings', 'audit'],
  ['/v1/evidence-packs', 'audit'],
  ['/v1/activity', 'audit'],
  ['/v1/audit', 'audit'],
  ['/v1/analytics', 'reports'],
  ['/v1/reports', 'reports'],
  ['/v1/admin', 'admin'],
  ['/v1/auditor', 'admin'],
];

export function moduleFor(path: string): string | null {
  for (const [prefix, mod] of MODULE_BY_PREFIX) if (path.startsWith(prefix)) return mod;
  return null;
}

export function actionFor(method: string, path: string): string {
  if (method === 'GET') return 'VIEW';
  if (/\/(action|bulk-action)$/.test(path)) return 'APPROVE';
  if (/\/(submit|resubmit)$/.test(path)) return 'SUBMIT';
  if (/\/(export|run)(\?.*)?$/.test(path) || path.includes('evidence-packs')) return 'EXPORT';
  if (method === 'PATCH' || method === 'PUT') return 'EDIT';
  if (method === 'DELETE') return 'CONFIGURE';
  // POST sub-actions (disburse, blacklist, settle-refund, cancel…) are EDIT; base POST creates
  const segs = path.split('?')[0].split('/').filter(Boolean);
  return segs.length <= 2 ? 'CREATE' : 'EDIT';
}
