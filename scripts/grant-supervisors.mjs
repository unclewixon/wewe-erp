#!/usr/bin/env node
/**
 * Give the demo environment a supervisor for every department, then prove it worked.
 *
 * Why this exists: the seed creates exactly one Supervisor (Tunde), scoped to Programmes
 * and M&E. Requisitions raised from any other department reach the Supervisor stage and
 * stop there for good — nobody holds the role for those departments, so the engine
 * refuses with "Current stage requires the SUPERVISOR role for this department".
 *
 * The fix is one grant, not four: engine.logic.ts treats a role with departmentId === null
 * as organisation-wide (`r.departmentId === null || r.departmentId === tx.departmentId`).
 *
 * Two people get it, not one. Segregation of duties blocks self-approval, so a lone
 * supervisor's own requisitions would stall exactly the way we are trying to fix.
 * Blessing is the safe second: HR_OFFICER appears nowhere in the requisition chain, so
 * she can never trip the "already acted on this transaction" rule. Ibrahim and Ngozi
 * would be wrong choices — they hold Finance and Internal Audit, later stages in the
 * same chain, so supervising first would block them at their own stage.
 *
 * An organisation-wide supervisor is a TEST-ENVIRONMENT convenience. In production you
 * want a real supervisor per department: one person approving every department's
 * spending is the concentration this workflow exists to prevent.
 *
 *   node scripts/grant-supervisors.mjs                  # grant + verify
 *   node scripts/grant-supervisors.mjs --revert         # put the seed's scoping back
 *   BASE=http://host node scripts/grant-supervisors.mjs # different deployment
 */
const BASE = process.env.BASE || 'http://157.245.35.226';
const PW = process.env.SEED_PASSWORD || 'Password1!';
const REVERT = process.argv.includes('--revert');

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
const users = (await api(admin, 'GET', '/v1/admin/users')).body || [];
const byEmail = Object.fromEntries(users.map((u) => [u.email, u]));
const depts = (await api(admin, 'GET', '/v1/admin/departments')).body || [];
const deptId = (name) => (depts.find((d) => d.name === name) || {}).id;

// Roles are replaced wholesale by PATCH, so each set below is complete, not a delta.
const PLAN = REVERT
  ? [
      ['tunde.balogun@wewe.org', [
        { code: 'INITIATOR', departmentId: null },
        { code: 'SUPERVISOR', departmentId: deptId('Programmes') },
        { code: 'SUPERVISOR', departmentId: deptId('M&E') },
      ]],
      ['blessing.adeyemi@wewe.org', [
        { code: 'HR_OFFICER', departmentId: null },
        { code: 'INITIATOR', departmentId: null },
      ]],
    ]
  : [
      ['tunde.balogun@wewe.org', [
        { code: 'INITIATOR', departmentId: null },
        { code: 'SUPERVISOR', departmentId: null },
      ]],
      ['blessing.adeyemi@wewe.org', [
        { code: 'HR_OFFICER', departmentId: null },
        { code: 'INITIATOR', departmentId: null },
        { code: 'SUPERVISOR', departmentId: null },
      ]],
    ];

console.log(REVERT ? 'Restoring the seed\'s department scoping…\n' : 'Granting organisation-wide Supervisor…\n');
for (const [email, roles] of PLAN) {
  const u = byEmail[email];
  if (!u) { console.log(`  ${email}: not found — skipped`); continue; }
  const res = await api(admin, 'PATCH', `/v1/admin/users/${u.id}`, { roles });
  console.log(`  ${res.ok ? 'OK  ' : 'FAIL'} ${email.padEnd(28)} ${
    res.ok ? roles.map((r) => r.code + (r.departmentId ? '@dept' : '')).join(', ')
           : JSON.stringify(res.body).slice(0, 140)}`);
}

if (REVERT) process.exit(0);

// ---- proof: the departments that used to stall can now be actioned ----
console.log('\nVerifying the stalls are cleared:');
const sup = await login('tunde.balogun@wewe.org');
for (const email of ['emeka.nwosu@wewe.org', 'fatima.bello@wewe.org', 'amina.yusuf@wewe.org']) {
  const c = await login(email);
  const made = await api(c, 'POST', '/v1/requisitions', {
    title: '[GRANT-CHECK] ' + email, lines: [{ description: 'check', qty: 1, unitKobo: '50000' }], submit: true,
  });
  const tx = made.body;
  const acted = await api(sup, 'POST', `/v1/transactions/${tx.id}/action`, { verb: 'approve' });
  const dept = (depts.find((d) => d.id === (byEmail[email] || {}).departmentId) || {}).name || '?';
  console.log(`  ${dept.padEnd(18)} ${tx.ref}  supervisor approve -> ${
    acted.ok ? acted.body.status + ' @ ' + (acted.body.currentStageRole || 'closed') : 'REFUSED: ' + acted.body.message}`);
}

// ---- proof: segregation of duties is untouched ----
console.log('\nSegregation of duties still holds:');
const own = await api(sup, 'POST', '/v1/requisitions', {
  title: '[GRANT-CHECK] supervisor raising their own', lines: [{ description: 'check', qty: 1, unitKobo: '50000' }], submit: true,
});
const self = await api(sup, 'POST', `/v1/transactions/${own.body.id}/action`, { verb: 'approve' });
console.log(`  self-approval -> ${self.ok ? '*** ALLOWED — investigate ***' : 'refused: ' + self.body.message}`);
const second = await login('blessing.adeyemi@wewe.org');
const bySecond = await api(second, 'POST', `/v1/transactions/${own.body.id}/action`, { verb: 'approve' });
console.log(`  but the second supervisor can act -> ${bySecond.ok ? bySecond.body.status : 'REFUSED: ' + bySecond.body.message}`);
