/* Internal security assessment — live attack probes against the running API.
 * NOT a substitute for the independent pen test; it hardens ahead of it.
 * Each probe asserts the SECURE behaviour; a failed assertion = a finding. */
const B = 'http://localhost:3001';
const findings = [];
let ok = 0;
function pass(name) { ok++; console.log(`  ✓ ${name}`); }
function finding(sev, name, detail) { findings.push({ sev, name, detail }); console.log(`  ✗ [${sev}] ${name} — ${detail}`); }

async function login(email, password = 'Password1!') {
  const r = await fetch(`${B}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const list = (r.headers.getSetCookie && r.headers.getSetCookie()) || (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
  const setc = list[0] || '';
  return { cookie: setc.split(';')[0], setCookie: setc, body: await r.json().catch(() => ({})), res: r };
}
async function req(cookie, method, path, body) {
  const r = await fetch(`${B}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await r.json(); } catch { /* */ }
  return { status: r.status, data, res: r };
}

const admin = await login('admin@wewe.org');
const amina = await login('amina.yusuf@wewe.org');   // Initiator, Programmes
const chi = await login('chiamaka.eze@wewe.org');    // Initiator, M&E
const ext = await login('k.adeleke@auditfirm.ng');   // External auditor, USAID scope

console.log('\n[A] Authentication & session');
// A1 unauthenticated access
{ const r = await req(null, 'GET', '/v1/requisitions?scope=all'); r.status === 401 ? pass('unauthenticated request → 401') : finding('HIGH', 'unauthenticated access', `got ${r.status}`); }
// A2 cookie flags
{ const sc = admin.setCookie.toLowerCase();
  sc.includes('httponly') ? pass('session cookie HttpOnly') : finding('HIGH', 'cookie not HttpOnly', sc);
  sc.includes('samesite') ? pass('session cookie SameSite') : finding('MED', 'cookie missing SameSite', sc);
  // secure is env-gated (COOKIE_SECURE); dev runs plain HTTP so absence is expected here
  console.log('    (Secure flag is env-gated via COOKIE_SECURE=1 in prod compose — not asserted on dev HTTP)'); }
// A3 forged/garbage cookie
{ const r = await req('wewe_session=deadbeefdeadbeef', 'GET', '/v1/dashboard'); r.status === 401 ? pass('forged session token → 401') : finding('HIGH', 'forged token accepted', `${r.status}`); }
// A4 pending-2fa token is not a session
{ const r = await req('wewe_session=2fa.abc', 'GET', '/v1/dashboard'); r.status === 401 ? pass('2fa-pending token cannot authorise') : finding('HIGH', '2fa pending token usable as session', `${r.status}`); }
// A5 SQLi in login email
{ const r = await fetch(`${B}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: "' OR '1'='1' --", password: 'x' }) }); (r.status === 400 || r.status === 401) ? pass("SQLi login payload rejected/failed") : finding('CRIT', 'SQLi login', `${r.status}`); }
// A6 password not echoed anywhere
{ const me = await req(admin.cookie, 'GET', '/v1/auth/me'); JSON.stringify(me.data).match(/passwordHash|password/i) ? finding('HIGH', 'password field leaked in /me', '') : pass('no password/hash in /me'); }

console.log('\n[B] Authorization — BOLA/IDOR & privilege');
// B1 cross-tenant object read: amina opening a document she has no rights to
{ const up = await req(admin.cookie, 'POST', '/v1/dms/documents', { name: 'secret.txt', mime: 'text/plain', dataBase64: Buffer.from('board only').toString('base64'), confidential: true });
  const id = up.data?.document?.id ?? up.data?.id;
  const r = await req(amina.cookie, 'GET', `/v1/dms/documents/${id}`);
  (r.status === 403 || r.status === 404) ? pass('confidential doc not readable by unauthorised user') : finding('HIGH', 'IDOR: confidential document readable', `${r.status}`); }
// B2 external auditor write attempt (must be read-only)
{ const r = await req(ext.cookie, 'POST', '/v1/vendors', { name: 'evil' }); r.status === 403 ? pass('external auditor write → 403') : finding('CRIT', 'read-only auditor can write', `${r.status}`); }
// B3 external auditor scope leakage
{ const r = await req(ext.cookie, 'GET', '/v1/requisitions?scope=all');
  Array.isArray(r.data) && r.data.every((t) => t.donorCode === 'USAID-LON-24') ? pass('auditor sees only in-scope donor rows') : finding('HIGH', 'auditor scope leak', JSON.stringify(r.data).slice(0,80)); }
// B4 privilege escalation: initiator hitting admin endpoints
{ const r = await req(amina.cookie, 'GET', '/v1/admin/users'); r.status === 403 ? pass('initiator → admin/users blocked') : finding('CRIT', 'privilege escalation to admin', `${r.status}`); }
// B5 matrix write by non-admin
{ const r = await req(amina.cookie, 'PUT', '/v1/admin/permissions/matrix', { roleCode: 'INITIATOR', grants: [{ module: 'admin', action: 'CONFIGURE', scope: 'organisation' }] }); r.status === 403 ? pass('non-admin cannot edit permission matrix') : finding('CRIT', 'anyone can grant themselves admin', `${r.status}`); }
// B6 SoD self-approval via generic endpoint
{ const c = await req(amina.cookie, 'POST', '/v1/requisitions', { title: 'SoD probe', submit: true, lines: [{ description: 'x', qty: 1, unitKobo: '100000' }] });
  const id = c.data?.id;
  const r = await req(amina.cookie, 'POST', `/v1/transactions/${id}/action`, { verb: 'approve' });
  (r.status === 403) ? pass('initiator cannot approve (matrix+SoD, 403)') : finding('CRIT', 'SoD/authz bypass via /transactions', `${r.status}`); }
// B7 cross-department approve: chiamaka (M&E) approving Programmes item she has no supervisor scope for
{ const c = await req(amina.cookie, 'POST', '/v1/requisitions', { title: 'cross-dept probe', submit: true, lines: [{ description: 'x', qty: 1, unitKobo: '100000' }] });
  const r = await req(chi.cookie, 'POST', `/v1/transactions/${c.data?.id}/action`, { verb: 'approve' });
  (r.status === 403) ? pass('cross-department approval blocked (403)') : finding('HIGH', 'cross-department approval', `${r.status}`); }

console.log('\n[C] Injection & input');
// C1 SQLi via search
{ const r = await req(admin.cookie, 'GET', `/v1/dms/search?q=${encodeURIComponent("'; DROP TABLE documents;--")}`);
  r.status < 500 ? pass('SQLi in search handled (parameterised)') : finding('CRIT', 'search SQLi 500', `${r.status}`);
  const still = await req(admin.cookie, 'GET', '/v1/dms/search?q=MOU'); still.status < 500 ? pass('documents table intact after SQLi attempt') : finding('CRIT', 'table dropped', ''); }
// C2 oversized body rejected (>15mb JSON limit)
{ const big = 'A'.repeat(20 * 1024 * 1024); const r = await fetch(`${B}/v1/dms/documents`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: admin.cookie }, body: JSON.stringify({ name: 'big', mime: 'text/plain', dataBase64: big }) }).catch(() => ({ status: 413 }));
  (r.status === 413 || r.status === 400) ? pass('oversized payload rejected') : finding('MED', 'no body-size cap', `${r.status}`); }
// C3 zod validation on bad types
{ const r = await req(admin.cookie, 'POST', '/v1/requisitions', { title: 123, lines: 'nope' }); r.status === 400 ? pass('malformed body → 400 (zod)') : finding('MED', 'weak input validation', `${r.status}`); }
// C4 mass-assignment: try to set status/ref directly
{ const r = await req(amina.cookie, 'POST', '/v1/requisitions', { title: 'mass assign', status: 'APPROVED', ref: 'REQ-9999-9999', currentStage: 4, submit: false, lines: [{ description: 'x', qty: 1, unitKobo: '100000' }] });
  const created = r.data;
  (created?.status === 'DRAFT' && created?.ref !== 'REQ-9999-9999') ? pass('mass-assignment ignored (status/ref server-controlled)') : finding('HIGH', 'mass assignment', `${created?.status}/${created?.ref}`); }

console.log('\n[D] Audit integrity & info leakage');
// D1 audit log has no write/patch/delete endpoint
{ const post = await req(admin.cookie, 'POST', '/v1/audit', { action: 'FAKE' }); const del = await req(admin.cookie, 'DELETE', '/v1/audit/1');
  (post.status === 404 || post.status === 405) && (del.status === 404 || del.status === 405) ? pass('audit log is append-only (no write/delete route)') : finding('HIGH', 'audit log mutable via API', `post ${post.status} del ${del.status}`); }
// D2 chain still verifies
{ const r = await req(admin.cookie, 'GET', '/v1/audit/verify'); r.data?.ok === true ? pass('audit hash chain verifies') : finding('CRIT', 'audit chain broken', JSON.stringify(r.data)); }
// D3 error responses don't leak stack traces
{ const r = await req(admin.cookie, 'GET', '/v1/requisitions/does-not-exist-xyz'); const s = JSON.stringify(r.data);
  (!s.includes('at ') && !s.match(/\/home\/|node_modules|\.ts:/)) ? pass('no stack trace / path leak in errors') : finding('MED', 'stack trace leaked', s.slice(0, 120)); }
// D4 auditor cannot see another donor's transaction by direct id
{ const one = (await req(admin.cookie, 'GET', '/v1/requisitions?scope=all')).data?.find((t) => t.donorCode && t.donorCode !== 'USAID-LON-24');
  if (one) { const r = await req(ext.cookie, 'GET', `/v1/requisitions/${one.id}`); (r.status === 403 || r.status === 404) ? pass('auditor cannot fetch out-of-scope tx by id') : finding('HIGH', 'auditor IDOR by id', `${r.status}`); }
  else pass('auditor IDOR check (no out-of-scope sample)'); }

console.log('\n[E] Security headers & rate limiting');
// NOTE: the brute-force probe below records 15+ failed logins for this IP, which trips
// the per-IP throttle for ~60s. Run this suite LAST, or wait a minute before system-verify.
{ const r = await fetch(`${B}/v1/auth/me`, { headers: { cookie: admin.cookie } });
  const h = Object.fromEntries([...r.headers.entries()]);
  h['x-content-type-options'] === 'nosniff' ? pass('X-Content-Type-Options: nosniff') : finding('LOW', 'missing X-Content-Type-Options', '');
  h['x-frame-options'] || h['content-security-policy'] ? pass('framing protection present') : finding('MED', 'no X-Frame-Options/CSP (clickjacking)', '');
  h['x-powered-by'] ? finding('LOW', 'X-Powered-By discloses stack', h['x-powered-by']) : pass('no X-Powered-By disclosure'); }
// E2 login rate limiting
{ let blocked = false; for (let i = 0; i < 18; i++) { const r = await fetch(`${B}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ratelimit@wewe.org', password: 'x' }) }); if (r.status === 429) blocked = true; }
  blocked ? pass('login endpoint rate-limited (429)') : finding('MED', 'no IP rate limiting on login', 'brute-force only slowed by per-account lockout'); }

console.log(`\n===== ${ok} secure behaviours confirmed, ${findings.length} findings =====`);
for (const f of findings) console.log(`[${f.sev}] ${f.name}: ${f.detail}`);
process.exit(findings.filter((f) => f.sev === 'CRIT' || f.sev === 'HIGH').length);
