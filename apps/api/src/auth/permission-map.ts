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

/** Personal duties any authed user may perform; the owning service enforces specifics. */
const PERSONAL_DUTY = [
  /^\/v1\/transactions\//,                 // type-aware matrix check happens in the handler
  /^\/v1\/audit-flags\/[^/]+\/respond$/,   // anyone named in a flag must be able to answer it
  /^\/v1\/esign\/requests\/[^/]+\/(sign|decline)$/, // any staff can be a signer
  /^\/v1\/checklists\/[^/]+\/items$/,      // checklist items assigned across roles
];

export function moduleFor(path: string): string | null {
  const clean = path.split('?')[0];
  if (PERSONAL_DUTY.some((re) => re.test(clean))) return null;
  for (const [prefix, mod] of MODULE_BY_PREFIX) if (path.startsWith(prefix)) return mod;
  return null;
}

export function actionFor(method: string, path: string): string {
  if (method === 'GET') return 'VIEW';
  if (/\/(action|bulk-action|disburse|settle-refund)$/.test(path)) return 'APPROVE'; // Finance-stage operations
  if (/\/(submit|resubmit)$/.test(path)) return 'SUBMIT';
  if (/\/(export|run)(\?.*)?$/.test(path) || path.includes('evidence-packs')) return 'EXPORT';
  if (method === 'PATCH' || method === 'PUT') return 'EDIT';
  if (method === 'DELETE') return 'CONFIGURE';
  // POST on a collection (no id-like segment after /v1/<module>) is CREATE;
  // POST sub-actions on an entity (disburse, blacklist, cancel…) are EDIT.
  const segs = path.split('?')[0].split('/').filter(Boolean);
  const looksLikeId = (seg: string) => /\d/.test(seg) || seg.length > 20;
  return segs.slice(1).some(looksLikeId) ? 'EDIT' : 'CREATE';
}
