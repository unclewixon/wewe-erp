/**
 * PROC-01 follow-up: give the two orphaned dashboards an audience.
 *
 *   procurement  — no role code existed until now, so nothing could ever resolve to it
 *   hr           — HR_OFFICER ranks below SUPERVISOR, and the only HR officer also
 *                  supervises, so she gets the supervisor view and HR has no audience
 *
 * Creates one user for each, with exactly the role that persona needs and nothing else.
 * Idempotent: re-running grants nothing twice.
 *
 *   node scripts/seed-procurement-hr.mjs
 *   BASE=http://157.245.35.226 node scripts/seed-procurement-hr.mjs
 */
const BASE = process.env.BASE || 'http://157.245.35.226';
const ADMIN = process.env.ADMIN_EMAIL || 'superadmin@wewe.org';
const PASS = process.env.ADMIN_PASSWORD || 'zObG5BBCfHnQ';

const PEOPLE = [
  { email: 'kelechi.obi@wewe.org', name: 'Kelechi Obi', title: 'Procurement Officer', roles: ['PROCUREMENT_OFFICER'] },
  { email: 'hauwa.suleiman@wewe.org', name: 'Hauwa Suleiman', title: 'HR Officer', roles: ['HR_OFFICER'] },
];

let cookie = '';
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setC = res.headers.get('set-cookie');
  if (setC) cookie = setC.split(';')[0];
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, json, text };
}

const login = await api('POST', '/v1/auth/login', { email: ADMIN, password: PASS });
if (!login.ok) { console.error('Admin sign-in failed:', login.status, login.text.slice(0, 200)); process.exit(1); }
console.log('signed in as', ADMIN);

const users = (await api('GET', '/v1/admin/users')).json || [];
const deptsRes = (await api('GET', '/v1/meta/departments')).json;
const depts = Array.isArray(deptsRes) ? deptsRes : (deptsRes && deptsRes.items) || [];
const opsDept = depts.find((d) => /operation/i.test(d.name)) || depts[0];

for (const p of PEOPLE) {
  const existing = users.find((u) => u.email === p.email);
  if (existing) {
    console.log(`${p.email} exists — ensuring roles`);
    const res = await api('PATCH', `/v1/admin/users/${existing.id}`, {
      roles: p.roles.map((code) => ({ code, departmentId: null })),
    });
    console.log('   ', res.ok ? 'roles set' : `FAILED ${res.status} ${res.text.slice(0, 140)}`);
    continue;
  }
  const res = await api('POST', '/v1/admin/users', {
    email: p.email, name: p.name, title: p.title,
    password: 'Password1!',
    departmentId: opsDept ? opsDept.id : undefined,
    roles: p.roles.map((code) => ({ code, departmentId: null })),
  });
  console.log(`${p.email} ${res.ok ? 'created' : `FAILED ${res.status} ${res.text.slice(0, 160)}`}`);
}

console.log('\nBoth sign in with Password1!.');
console.log('These two hold ONE role each on purpose: the procurement and HR dashboards are');
console.log('only reachable by someone whose highest-ranked role is that one.');
