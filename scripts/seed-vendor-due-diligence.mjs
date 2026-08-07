#!/usr/bin/env node
/**
 * Record due diligence against the seeded vendors so the RFQ flow is usable.
 *
 * Why this exists: the "Create RFQ" button only enables once at least three vendors are
 * selected, and a vendor is only selectable when it is not blacklisted and its due
 * diligence is COMPLETE — no organisation should invite a supplier whose CAC and tax
 * clearance are not on file. That rule is right. The seed just never recorded the
 * documents, so every vendor reads INCOMPLETE and the button can never enable.
 *
 * dueDiligenceStatus() (ops.logic.ts) returns COMPLETE only when both cacDocId and
 * taxClearanceDocId are present and expiresAt is in the future.
 *
 *   node scripts/seed-vendor-due-diligence.mjs           # record it, then verify
 *   node scripts/seed-vendor-due-diligence.mjs --all     # include QA-created vendors too
 */
const BASE = process.env.BASE || 'http://157.245.35.226';
const PW = process.env.SEED_PASSWORD || 'Password1!';
const ALL = process.argv.includes('--all');

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

const cookie = await login('emeka.nwosu@wewe.org');
const vendors = (await api(cookie, 'GET', '/v1/vendors')).body || [];
const targets = vendors.filter((v) => !v.blacklisted && (ALL || !/^QA /.test(v.name)));

// Two years out, so the demo does not quietly lapse mid-quarter.
const expiresAt = new Date(Date.UTC(new Date().getUTCFullYear() + 2, 0, 31)).toISOString();

console.log(`Recording due diligence for ${targets.length} vendor(s), valid to ${expiresAt.slice(0, 10)}:\n`);
for (const v of targets) {
  const res = await api(cookie, 'PATCH', `/v1/vendors/${v.id}`, {
    dueDiligence: {
      cacDocId: 'CAC-' + String(v.name).replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase(),
      taxClearanceDocId: 'TCC-' + String(v.name).replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase(),
      expiresAt,
    },
  });
  console.log(`  ${res.ok ? 'OK  ' : 'FAIL'} ${String(v.name).slice(0, 34).padEnd(36)} ${res.ok ? '' : JSON.stringify(res.body).slice(0, 110)}`);
}

const after = (await api(cookie, 'GET', '/v1/vendors')).body || [];
const selectable = after.filter((v) => !v.blacklisted && v.dueDiligenceStatus === 'COMPLETE');
console.log(`\nSelectable vendors now: ${selectable.length}`);
console.log(selectable.length >= 3
  ? '  Enough to enable "Create RFQ" — the RFQ flow is usable.'
  : '  Still under 3 — "Create RFQ" will stay disabled.');
for (const v of selectable.slice(0, 6)) console.log(`    ${v.name}  (${v.dueDiligenceStatus})`);
