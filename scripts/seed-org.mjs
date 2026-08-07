#!/usr/bin/env node
/**
 * Spread the demo users across real departments, and stand up a super admin for presenting.
 *
 * Why: the seed put four of eleven people in Finance & Admin, and two functions that clearly
 * deserve their own department — HR and Procurement — had none, so the org chart on screen
 * did not look like an organisation.
 *
 * The super admin holds every operational role at once. Read this before demonstrating with it:
 * it can act at ANY stage, but it cannot walk one transaction through SEVERAL stages. The
 * engine refuses an initiator acting on their own transaction, and refuses anyone acting twice
 * on the same one. That is segregation of duties — the control this whole workflow exists to
 * enforce — and no amount of role-granting turns it off. To show a full approval chain you
 * still need distinct people (see docs/TEST_PERSONAS.md).
 *
 *   node scripts/seed-org.mjs           # create departments, move people, add the super admin
 *   node scripts/seed-org.mjs --dry     # show what would change, touch nothing
 */
const BASE = process.env.BASE || 'http://157.245.35.226';
const PW = process.env.SEED_PASSWORD || 'Password1!';
const DRY = process.argv.includes('--dry');

const login = async (email) => {
  const r = await fetch(BASE + '/v1/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  if (!r.ok) throw new Error(`login failed for ${email}: ${r.status}`);
  return (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
};
const api = async (cookie, method, path, body) => {
  const r = await fetch(BASE + path, {
    method, headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, ok: r.ok, body: j };
};

const admin = await login('admin@wewe.org');

// ---------- 1. departments ----------
const NEW_DEPTS = [
  { code: 'HR', name: 'Human Resources' },
  { code: 'PROC', name: 'Procurement' },
];
let depts = (await api(admin, 'GET', '/v1/admin/departments')).body || [];
console.log('Departments:');
for (const d of NEW_DEPTS) {
  if (depts.some((x) => x.name === d.name)) { console.log(`  exists  ${d.name}`); continue; }
  if (DRY) { console.log(`  WOULD CREATE  ${d.name}`); continue; }
  const res = await api(admin, 'POST', '/v1/admin/departments', d);
  console.log(`  ${res.ok ? 'created' : 'FAILED '} ${d.name}${res.ok ? '' : '  ' + JSON.stringify(res.body).slice(0, 100)}`);
}
depts = (await api(admin, 'GET', '/v1/admin/departments')).body || [];
const deptId = (name) => (depts.find((d) => d.name === name) || {}).id;

// ---------- 2. spread people by what they actually do ----------
const PLAN = {
  'amina.yusuf@wewe.org':     { dept: 'Programmes',          title: 'Programme Officer' },
  'tunde.balogun@wewe.org':   { dept: 'Programmes',          title: 'Head of Programmes' },
  'chiamaka.eze@wewe.org':    { dept: 'M&E',                 title: 'M&E Officer' },
  'ibrahim.musa@wewe.org':    { dept: 'Finance & Admin',     title: 'Finance Manager' },
  'fatima.bello@wewe.org':    { dept: 'Finance & Admin',     title: 'Finance Officer' },
  'folake.adeyemi@wewe.org':  { dept: 'Operations',          title: 'Managing Director' },
  'ngozi.okafor@wewe.org':    { dept: 'Grants & Compliance', title: 'Internal Audit Officer' },
  'k.adeleke@auditfirm.ng':   { dept: 'Grants & Compliance', title: 'External Auditor' },
  'blessing.adeyemi@wewe.org':{ dept: 'Human Resources',     title: 'HR Officer' },
  'emeka.nwosu@wewe.org':     { dept: 'Procurement',         title: 'Procurement Officer' },
  'admin@wewe.org':           { dept: 'Operations',          title: 'System Administrator' },
};
const users = (await api(admin, 'GET', '/v1/admin/users')).body || [];
const nameOf = Object.fromEntries(depts.map((d) => [d.id, d.name]));

console.log('\nPeople:');
for (const [email, want] of Object.entries(PLAN)) {
  const u = users.find((x) => x.email === email);
  if (!u) { console.log(`  missing ${email}`); continue; }
  const from = nameOf[u.departmentId] || '—';
  if (from === want.dept && u.title === want.title) { console.log(`  ok      ${email.padEnd(28)} ${want.dept}`); continue; }
  if (DRY) { console.log(`  WOULD MOVE ${email.padEnd(28)} ${from} -> ${want.dept}`); continue; }
  const res = await api(admin, 'PATCH', `/v1/admin/users/${u.id}`, { departmentId: deptId(want.dept), title: want.title });
  console.log(`  ${res.ok ? 'moved  ' : 'FAILED '} ${email.padEnd(28)} ${from} -> ${want.dept}${res.ok ? '' : '  ' + JSON.stringify(res.body).slice(0, 90)}`);
}

// ---------- 3. the super admin ----------
// Every operational role. EXTERNAL_AUDITOR is deliberately excluded: it is a scoped,
// read-only outsider role, not an extra power.
const SUPER = {
  email: 'superadmin@wewe.org',
  name: 'Super Admin',
  title: 'Systems & Operations Lead',
  roles: ['SYSTEM_ADMIN', 'FINANCE', 'INTERNAL_AUDIT', 'SUPERVISOR', 'FINAL_APPROVER', 'HR_OFFICER', 'INITIATOR']
    .map((code) => ({ code, departmentId: null })),
};
console.log('\nSuper admin:');
const existing = users.find((u) => u.email === SUPER.email);
if (DRY) {
  console.log(`  WOULD ${existing ? 'UPDATE' : 'CREATE'} ${SUPER.email} with ${SUPER.roles.length} organisation-wide roles`);
} else if (existing) {
  const res = await api(admin, 'PATCH', `/v1/admin/users/${existing.id}`, { roles: SUPER.roles, title: SUPER.title, departmentId: deptId('Operations') });
  console.log(`  ${res.ok ? 'updated' : 'FAILED '} ${SUPER.email}  ${res.ok ? SUPER.roles.map((r) => r.code).join(', ') : JSON.stringify(res.body).slice(0, 110)}`);
  console.log('  password unchanged — it already existed');
} else {
  const res = await api(admin, 'POST', '/v1/admin/users', { ...SUPER, departmentId: deptId('Operations') });
  if (!res.ok) console.log(`  FAILED  ${JSON.stringify(res.body).slice(0, 160)}`);
  else {
    console.log(`  created ${SUPER.email}`);
    console.log(`  ROLES   ${SUPER.roles.map((r) => r.code).join(', ')}`);
    console.log(`  TEMP PASSWORD (shown once): ${res.body.tempPassword || res.body.password || '(not returned — reset it from Admin → Users)'}`);
  }
}

// ---------- 4. show the result, and the limit that matters ----------
const after = (await api(admin, 'GET', '/v1/admin/users')).body || [];
const finalDepts = (await api(admin, 'GET', '/v1/admin/departments')).body || [];
const finalName = Object.fromEntries(finalDepts.map((d) => [d.id, d.name]));
console.log('\nFinal spread:');
const tally = {};
for (const u of after) { const n = finalName[u.departmentId] || '(none)'; (tally[n] = tally[n] || []).push(u.email.split('@')[0]); }
for (const d of finalDepts) console.log(`  ${String(d.name).padEnd(22)} ${(tally[d.name] || []).join(', ') || '—'}`);

if (!DRY) {
  console.log('\nWhat the super admin can and cannot do:');
  let sup;
  try { sup = await login(SUPER.email); } catch { console.log('  (sign in with the temp password once to activate the account, then re-run to see this)'); process.exit(0); }
  const reads = ['/v1/requisitions?scope=all', '/v1/vendors', '/v1/contracts', '/v1/purchase-orders', '/v1/budgets/position', '/v1/admin/users', '/v1/audit/verify'];
  const okReads = [];
  for (const p of reads) { const r = await api(sup, 'GET', p); if (r.ok) okReads.push(p.split('?')[0]); }
  console.log(`  reads  ${okReads.length}/${reads.length} modules`);
  const w = await api(sup, 'POST', '/v1/vendors', { name: 'Super Admin write check ' + String(Date.now()).slice(-5) });
  console.log(`  writes ${w.ok ? 'yes' : 'NO — ' + JSON.stringify(w.body).slice(0, 90)}`);
  const own = await api(sup, 'POST', '/v1/requisitions', { title: '[SUPER] own requisition', lines: [{ description: 'check', qty: 1, unitKobo: '50000' }], submit: true });
  const self = await api(sup, 'POST', `/v1/transactions/${own.body.id}/action`, { verb: 'approve' });
  console.log(`  approving its OWN requisition -> ${self.ok ? '*** ALLOWED — investigate ***' : 'refused: ' + self.body.message}`);
  console.log('  (that refusal is correct: segregation of duties is not a permission, and no role turns it off)');
}
