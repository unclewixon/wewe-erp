/* Full-system verification: walks every workflow end-to-end as the real personas.
 * Run: node scripts/system-verify.mjs   (API on :3001, seeded demo org)
 * Exit code = number of failures. */
const B = 'http://localhost:3001';
const jar = {};
let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(`${name} ${detail}`); console.log(`  ✗ ${name}  ${detail}`); }
}
async function login(key, email, password = 'Password1!') {
  const r = await fetch(`${B}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const cookie = r.headers.get('set-cookie');
  if (cookie) jar[key] = cookie.split(';')[0];
  return r.json();
}
async function call(as, method, path, body) {
  const r = await fetch(`${B}${path}`, {
    method, headers: { 'content-type': 'application/json', cookie: jar[as] ?? '' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}
const act = (as, id, verb, comment) => call(as, 'POST', `/v1/requisitions/${id}/action`, { verb, comment });
const actTx = (as, id, verb, comment) => call(as, 'POST', `/v1/transactions/${id}/action`, { verb, comment });

console.log('— personas sign in');
for (const [k, e] of [['ami', 'amina.yusuf@wewe.org'], ['tun', 'tunde.balogun@wewe.org'], ['ngo', 'ngozi.okafor@wewe.org'],
  ['ibr', 'ibrahim.musa@wewe.org'], ['fol', 'folake.adeyemi@wewe.org'], ['chi', 'chiamaka.eze@wewe.org'],
  ['adm', 'admin@wewe.org'], ['ble', 'blessing.adeyemi@wewe.org'], ['eme', 'emeka.nwosu@wewe.org'], ['ext', 'k.adeleke@auditfirm.ng'], ['fat', 'fatima.bello@wewe.org']]) {
  await login(k, e);
  check(`login ${e}`, Boolean(jar[k]));
}

console.log('— WORKFLOW: full 5-stage requisition with return/resubmit');
let r = await call('ami', 'POST', '/v1/requisitions', { title: 'Verification sweep — training venue', donorCode: 'USAID-LON-24', submit: true, lines: [{ description: 'Hall rental', qty: 2, unitKobo: '35000000' }] });
check('create+submit ₦700k requisition (4-stage chain incl Final)', r.status === 201 || r.status === 200, JSON.stringify(r.data).slice(0, 120));
const bigId = r.data?.id;
check('chain resolved with FINAL (>= threshold)', Array.isArray(r.data?.chain) && r.data.chain.length === 4, String(r.data?.chain));
r = await act('tun', bigId, 'approve');
check('Supervisor approves -> Internal Audit', r.data?.currentStageRole === 'INTERNAL_AUDIT', JSON.stringify(r.data).slice(0, 100));
r = await act('ngo', bigId, 'return', 'Attach the venue quote before we proceed.');
check('Internal Audit returns with note', r.data?.status === 'RETURNED');
r = await call('ami', 'POST', `/v1/requisitions/${bigId}/resubmit`);
check('initiator resubmits -> chain restarts at Supervisor', r.data?.status === 'PENDING' && r.data?.currentStage === 0);
for (const [who, want] of [['tun', 'INTERNAL_AUDIT'], ['ngo', 'FINANCE'], ['ibr', 'FINAL_APPROVER']]) {
  r = await act(who, bigId, 'approve');
  check(`${who} approves -> ${want ?? 'APPROVED'}`, r.data?.currentStageRole === want || r.data?.status === 'APPROVED');
}
r = await act('fol', bigId, 'approve');
check('Final Approver releases -> APPROVED', r.data?.status === 'APPROVED');
r = await act('fol', bigId, 'approve');
check('acting on APPROVED tx is rejected', r.status === 403);

console.log('— WORKFLOW: reject path (MNE department routing)');
r = await call('chi', 'POST', '/v1/requisitions', { title: 'Verification — duplicate airtime', submit: true, lines: [{ description: 'Airtime', qty: 1, unitKobo: '5000000' }] });
const rejId = r.data?.id;
check('MNE initiator submits (MNE now routes to a Supervisor)', Boolean(rejId));
r = await act('tun', rejId, 'reject', 'Duplicate of an existing request.');
check('Supervisor rejects with reason -> REJECTED', r.data?.status === 'REJECTED');

console.log('— WORKFLOW: withdraw path');
r = await call('ami', 'POST', '/v1/requisitions', { title: 'Verification — withdraw me', submit: true, lines: [{ description: 'x', qty: 1, unitKobo: '100000' }] });
r = await call('ami', 'POST', `/v1/requisitions/${r.data.id}/withdraw`);
check('withdraw before any approval -> WITHDRAWN', r.data?.status === 'WITHDRAWN');

console.log('— MONEY: advance -> disburse -> partial + final retirement -> closed');
r = await call('ami', 'POST', '/v1/advances', { purpose: 'Sweep advance — community visit', amountKobo: '20000000', submit: true });
const advId = r.data?.id, advTx = r.data?.txId;
check('advance created+submitted', Boolean(advId && advTx), JSON.stringify(r.data).slice(0, 120));
for (const who of ['tun', 'ngo', 'ibr']) await actTx(who, advTx, 'approve');
r = await call('ibr', 'POST', `/v1/advances/${advId}/disburse`, { disbursedRef: 'TRF-SWEEP-1' });
check('Finance disburses (matrix maps to APPROVE)', r.status < 300 && (r.data?.status === 'DISBURSED'), JSON.stringify(r.data).slice(0, 120));
r = await call('ami', 'POST', '/v1/retirements', { advanceId: advId, title: 'Partial retirement — sweep', submit: true, lines: [{ description: 'Transport', amountKobo: '8000000' }] });
const ret1 = r.data?.txId;
check('partial retirement submitted', Boolean(ret1));
for (const who of ['tun', 'ngo', 'ibr']) await actTx(who, ret1, 'approve');
r = await call('ibr', 'GET', `/v1/advances/${advId}`);
check('balance reduced after partial (₦120k left)', String(r.data?.balanceKobo) === '12000000', String(r.data?.balanceKobo));
r = await call('ami', 'POST', '/v1/retirements', { advanceId: advId, title: 'Final retirement — sweep', submit: true, lines: [{ description: 'Refreshments', amountKobo: '12000000' }] });
const ret2 = r.data?.txId;
for (const who of ['tun', 'ngo', 'ibr']) await actTx(who, ret2, 'approve');
r = await call('ibr', 'GET', `/v1/advances/${advId}`);
check('advance CLOSED at zero balance', r.data?.status === 'CLOSED' && String(r.data?.balanceKobo) === '0', `${r.data?.status}/${r.data?.balanceKobo}`);
r = await call('ibr', 'GET', '/v1/qb/outbox');
check('QuickBooks journals queued+posted (sandbox)', Array.isArray(r.data) && r.data.length >= 2 && r.data.every((x) => x.status === 'POSTED'), `${Array.isArray(r.data) ? r.data.length : r.status}`);

console.log('— MONEY: virement through its chain applies allocation');
{
  const lines = (await call('ibr', 'GET', '/v1/meta/budget-lines')).data;
  const src = lines.find((l) => l.code === 'PRG-TRV'), dst = lines.find((l) => l.code === 'PRG-TRN');
  r = await call('ibr', 'POST', '/v1/virements', { title: 'Sweep virement', sourceLineId: src.id, destLineId: dst.id, amountKobo: '10000000', submit: true });
}
const virTx = r.data?.txId ?? r.data?.id;
check('virement submitted by Finance manager', r.status < 300, JSON.stringify(r.data).slice(0, 140));
if (r.status < 300) {
  await actTx('fat', virTx, 'approve'); // second Finance officer — initiator cannot act on own
  const fin = await actTx('fol', virTx, 'approve');
  check('virement approved FINANCE(officer 2) -> FINAL', fin.data?.status === 'APPROVED' || fin.data?.status === 'APPROVED', JSON.stringify(fin.data).slice(0, 100));
}

console.log('— PEOPLE: leave request full chain decrements balance');
r = await call('ami', 'GET', '/v1/leave/balances');
const before = Array.isArray(r.data) ? r.data.find((b) => b.leaveTypeCode === 'ANNUAL') : null;
r = await call('ami', 'POST', '/v1/leave/requests', { leaveTypeCode: 'ANNUAL', startDate: '2026-09-07', endDate: '2026-09-08', handoverNote: 'Handover to team lead.' });
if (r.status >= 400) {
  const types = (await call('ami', 'GET', '/v1/leave/types')).data ?? [];
  const annual = types.find((t) => t.code === 'ANNUAL') ?? types[0];
  if (annual) r = await call('ami', 'POST', '/v1/leave/requests', { leaveTypeId: annual.id, startDate: '2026-09-07', endDate: '2026-09-08', handoverNote: 'Handover to team lead.' });
}
const leaveTx = r.data?.txId ?? r.data?.id;
check('leave request submitted', r.status < 300, JSON.stringify(r.data).slice(0, 140));
if (r.status < 300) {
  await actTx('tun', leaveTx, 'approve');
  const hr = await actTx('ble', leaveTx, 'approve');
  check('leave approved Supervisor->HR', hr.data?.status === 'APPROVED', JSON.stringify(hr.data).slice(0, 100));
  r = await call('ami', 'GET', '/v1/leave/balances');
  const after = Array.isArray(r.data) ? r.data.find((b) => b.leaveTypeCode === 'ANNUAL') : null;
  check('balance decremented by 2 days', before && after && (after.usedDays - before.usedDays === 2), `${before?.usedDays} -> ${after?.usedDays}`);
}

console.log('— PEOPLE: timesheet locks; payroll runs and releases');
r = await call('ami', 'POST', '/v1/timesheets', { period: '2026-07', rows: [{ projectCode: 'USAID-LON-24', percent: 70 }, { projectCode: 'ORG', percent: 30 }] });
const tsId = r.data?.id;
check('timesheet draft created (100%)', r.status < 300, JSON.stringify(r.data).slice(0, 120));
if (tsId) {
  r = await call('ami', 'POST', `/v1/timesheets/${tsId}/submit`);
  const tsTx = r.data?.txId ?? r.data?.transactionId ?? r.data?.id;
  await actTx('tun', tsTx, 'approve');
  await actTx('ibr', tsTx, 'approve');
  r = await call('ibr', 'GET', `/v1/timesheets/${tsId}`);
  check('timesheet LOCKED after chain', r.data?.status === 'LOCKED', r.data?.status);
}
r = await call('ble', 'POST', '/v1/payroll/runs', { period: '2026-08' });
check('payroll run computed', r.status < 300 && (r.data?.items?.length > 0 || r.data?.run), JSON.stringify(r.data).slice(0, 120));
const runId = r.data?.run?.id ?? r.data?.id;
if (runId) {
  r = await call('ble', 'POST', `/v1/payroll/runs/${runId}/release`);
  const payTx = r.data?.txId ?? r.data?.transaction?.id;
  check('payroll release routed', r.status < 300 && Boolean(payTx), JSON.stringify(r.data).slice(0, 120));
  if (payTx) {
    await actTx('ibr', payTx, 'approve');
    await actTx('fol', payTx, 'approve');
    r = await call('ble', 'GET', `/v1/payroll/runs/${runId}`);
    const st = r.data?.status ?? r.data?.run?.status;
    check('payroll RELEASED after FINANCE->FINAL', st === 'RELEASED', st);
    r = await call('ami', 'GET', '/v1/payroll/payslips/2026-08');
    check('staff sees own payslip', r.status < 300, String(r.status));
  }
}

console.log('— DMS: document lifecycle + e-sign with certificate');
r = await call('adm', 'POST', '/v1/dms/documents', { name: 'Sweep MOU.txt', mime: 'text/plain', dataBase64: Buffer.from('MOU between WEWE and partner for the sweep.').toString('base64'), textContent: 'MOU partner sweep' });
const docId = r.data?.document?.id ?? r.data?.id;
check('document uploaded with hash', Boolean(docId), JSON.stringify(r.data).slice(0, 100));
r = await call('adm', 'GET', '/v1/dms/search?q=MOU');
check('full-text search finds it', (r.data?.results ?? r.data ?? []).length >= 1);
r = await call('adm', 'POST', '/v1/esign/requests', { documentId: docId, signers: [{ userId: null, order: 1 }] });
if (r.status >= 400) {
  const me = (await call('tun', 'GET', '/v1/auth/me')).data?.user;
  r = await call('adm', 'POST', '/v1/esign/requests', { documentId: docId, signers: [{ userId: me.id, orderNo: 1 }] });
}
const esId = r.data?.id ?? r.data?.request?.id;
check('signature request created', r.status < 300, JSON.stringify(r.data).slice(0, 140));
if (esId) {
  r = await call('tun', 'POST', `/v1/esign/requests/${esId}/sign`, { method: 'typed' });
  check('internal signer signs (personal duty, matrix-exempt)', r.status < 300, JSON.stringify(r.data).slice(0, 120));
  r = await call('adm', 'GET', `/v1/esign/verify/${esId}`);
  check('certificate verifies (hash match)', r.status < 300 && (r.data?.hashMatches !== false), JSON.stringify(r.data).slice(0, 100));
}

console.log('— OPS: RFQ -> PO -> receipt closes; inventory; assets');
r = await call('eme', 'POST', '/v1/vendors', { name: 'Sweep Supplies Ltd' });
const venId = r.data?.id;
check('vendor created by procurement officer', Boolean(venId), JSON.stringify(r.data).slice(0, 100));
r = await call('eme', 'POST', '/v1/rfqs', { title: 'Sweep RFQ — stationery' });
const rfqId = r.data?.id;
check('RFQ created', Boolean(rfqId));
if (rfqId && venId) {
  await call('eme', 'POST', `/v1/rfqs/${rfqId}/quotes`, { vendorId: venId, totalKobo: '5000000' });
  r = await call('eme', 'POST', `/v1/rfqs/${rfqId}/select`, { quoteVendorId: venId, justification: 'Only compliant bid under the single-quote band.' });
  if (r.status >= 400) {
    const quotes = (await call('eme', 'GET', `/v1/rfqs/${rfqId}`)).data?.quotes ?? [];
    r = await call('eme', 'POST', `/v1/rfqs/${rfqId}/select`, { quoteId: quotes[0]?.id, justification: 'Only compliant bid under the single-quote band.' });
  }
  check('quote selected under threshold band', r.status < 300, JSON.stringify(r.data).slice(0, 140));
  r = await call('eme', 'POST', '/v1/purchase-orders', { rfqId });
  const poId = r.data?.id;
  check('PO generated from selected quote', Boolean(poId), JSON.stringify(r.data).slice(0, 140));
  if (poId) {
    const po = (await call('eme', 'GET', `/v1/purchase-orders/${poId}`)).data;
    const lines = (po?.lines ?? []).map((_, i) => ({ lineIndex: i, qty: po.lines[i].qty ?? 1 }));
    r = await call('eme', 'POST', `/v1/purchase-orders/${poId}/receipts`, { lines: lines.length ? lines : [{ lineIndex: 0, qty: 1 }] });
    const after = (await call('eme', 'GET', `/v1/purchase-orders/${poId}`)).data;
    check('full receipt closes the PO', after?.status === 'CLOSED', after?.status);
  }
}
r = await call('eme', 'GET', '/v1/inventory/items');
const item = (r.data ?? [])[0];
if (item) {
  r = await call('eme', 'POST', `/v1/inventory/items/${item.id}/moves`, { kind: 'ISSUE', qty: -(item.qtyOnHand + 999), refText: 'over-issue probe' });
  check('inventory can never go negative', r.status >= 400);
  r = await call('eme', 'POST', `/v1/inventory/items/${item.id}/moves`, { kind: 'GRN', qty: 10, refText: 'sweep GRN' });
  check('GRN increments stock', r.status < 300);
}
r = await call('adm', 'GET', '/v1/assets');
const asset = (r.data ?? [])[0];
check('asset register populated', Boolean(asset));
r = await call('adm', 'GET', '/v1/assets/reports/depreciation');
check('depreciation report computes', r.status < 300);

console.log('— GOVERNANCE: flags block bulk; grants report; auditor scope');
r = await call('ngo', 'POST', '/v1/audit-flags', { entityType: 'transaction', entityId: 'REQ-2026-0002', severity: 'MEDIUM', question: 'Sweep probe: confirm the venue rate.' });
check('audit flag raised', r.status < 300);
r = await call('ami', 'POST', '/v1/requisitions', { title: 'Sweep bulk A', submit: true, lines: [{ description: 'a', qty: 1, unitKobo: '100000' }] });
const bulkA = r.data?.id;
r = await call('tun', 'POST', '/v1/requisitions/bulk-action', { ids: [bulkA], verb: 'approve' });
check('bulk approve works on clean item', r.data?.succeeded === 1, JSON.stringify(r.data).slice(0, 120));
r = await call('ibr', 'GET', '/v1/grants');
const grant = (r.data ?? [])[0];
r = await call('ibr', 'GET', `/v1/grants/${grant?.id}/report-data.csv`);
check('donor report CSV renders', r.status < 300);
r = await call('ext', 'GET', '/v1/requisitions?scope=all');
check('external auditor sees only USAID scope', Array.isArray(r.data) && r.data.every((t) => t.donorCode === 'USAID-LON-24'), `${r.data?.length} rows`);
r = await call('ext', 'POST', '/v1/vendors', { name: 'nope' });
check('external auditor writes blocked', r.status === 403);
r = await call('ngo', 'POST', '/v1/evidence-packs', { donorCode: 'USAID-LON-24' });
check('evidence pack exports', r.status < 300, String(r.status));
r = await call('ngo', 'GET', '/v1/analytics/pipeline');
check('pipeline analytics computes', r.status < 300 && Array.isArray(r.data?.stages));

console.log('— PLATFORM: notifications, SLA scan, schedules, matrix, audit chain');
r = await call('ami', 'GET', '/v1/notifications');
check('notifications feed live', r.status < 300 && ((r.data?.needsAction ?? r.data?.updates ?? r.data)?.length !== undefined));
r = await call('adm', 'POST', '/v1/admin/sla/scan');
check('SLA scan runs', r.status < 300);
r = await call('adm', 'POST', '/v1/admin/email/process-outbox');
check('email outbox drains (dev transport)', r.status < 300);
r = await call('adm', 'GET', '/v1/admin/permissions/matrix');
check('permission matrix intact (17 modules)', (r.data?.modules ?? []).length === 17);
r = await call('adm', 'GET', '/v1/audit/verify');
check('AUDIT HASH CHAIN VERIFIES', r.data?.ok === true, JSON.stringify(r.data));

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
failures.forEach((f) => console.log('FAIL:', f));
process.exit(fail);
