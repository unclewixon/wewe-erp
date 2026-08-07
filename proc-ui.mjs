import { chromium } from 'playwright';
const APP = 'http://localhost:5199', API = 'http://157.245.35.226', PW = 'Password1!';
const CHROME = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const jar = {};
const login = async (e) => {
  const r = await fetch(API + '/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, password: PW }) });
  jar[e] = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
};
await login('emeka.nwosu@wewe.org');
const rfqCountBefore = (await (await fetch(API + '/v1/rfqs', { headers: { cookie: jar['emeka.nwosu@wewe.org'] } })).json()).length;

const b = await chromium.launch({ executablePath: CHROME });
const page = await b.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = []; page.on('pageerror', e => errs.push(String(e).split('\n')[0]));
const posts = []; page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/v1/') && !r.url().includes('auth')) posts.push(r.url().replace(APP, '')); });
const scr = async () => { const t = await page.evaluate(() => document.body.innerText || ''); return /Dashboard/.test(t) ? 'APP' : /Welcome back/.test(t) ? 'SIGN-IN' : '?'; };

await page.goto(APP + '/', { waitUntil: 'networkidle', timeout: 60000 }); await page.waitForTimeout(2200);
await page.locator('input[type="text"], input:not([type])').first().fill('emeka.nwosu@wewe.org');
await page.locator('input[type="password"]').first().fill(PW);
await page.locator('button', { hasText: /^Continue$/ }).first().click({ force: true });
for (let i = 0; i < 30; i++) { await page.waitForTimeout(500); if (await scr() === 'APP') break; }
console.log('signed in:', await scr());

async function openPage(parent, child) {
  await page.getByText(parent, { exact: true }).first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(900);
  if (child) { await page.getByText(child, { exact: true }).first().click({ force: true }).catch(() => {}); await page.waitForTimeout(1800); }
  return page.evaluate(() => document.body.innerText || '');
}

console.log('\n=== READ PAGES (is live data reaching them?) ===');
for (const [parent, child, marker] of [
  ['Procurement', 'Vendors', /QA Supplies|Vendor|vendor/i],
  ['Procurement', 'RFQ', /RFQ-\d{4}-\d{4}/],
  ['Procurement', 'Purchase orders', /PO-\d{4}-\d{4}/],
  ['Procurement', 'Contracts', /contract/i],
]) {
  const t = await openPage(parent, child);
  const live = marker.test(t);
  const refs = (t.match(/(RFQ|PO)-\d{4}-\d{4}/g) || []).slice(0, 3).join(', ');
  console.log(`  ${String(child).padEnd(16)} rendered=${t.length > 200 ? 'yes' : 'NO'}  live-markers=${live ? 'yes' : 'no'}  ${refs}`);
}

console.log('\n=== WRITE: raise an RFQ through the UI ===');
const t = await openPage('Procurement', 'RFQ');
const newBtn = page.getByRole('button', { name: /New RFQ|Raise RFQ|Create RFQ|New request|Invite/i }).first();
console.log('  "new RFQ" control present:', await newBtn.count() > 0);
if (await newBtn.count()) {
  await newBtn.click({ force: true }); await page.waitForTimeout(1200);
  // title
  const ti = page.locator('input[placeholder*="Laptops"], input[placeholder*="e.g."]').first();
  if (await ti.count()) await ti.fill('[UI] Stationery RFQ ' + String(Date.now()).slice(-5));
  // the Create button only renders once at least three vendors are ticked
  const boxes = page.locator('input[type="checkbox"]');
  const n = await boxes.count();
  let ticked = 0;
  for (let i = 0; i < n && ticked < 3; i++) {
    const cb = boxes.nth(i);
    if (await cb.isVisible().catch(() => false)) {
      if (!(await cb.isChecked().catch(() => false))) { await cb.click({ force: true }).catch(() => {}); }
      ticked++;
    }
  }
  await page.waitForTimeout(700);
  const tooFew = await page.getByText(/at least 3|three/i).count();
  console.log(`  vendors ticked: ${ticked}${tooFew ? '  (gate still showing "too few")' : ''}`);
  const send = page.getByRole('button', { name: 'Create RFQ' }).first();
  console.log('  "Create RFQ" button enabled:', await send.count() > 0);
  if (await send.count()) { await send.click({ force: true }); await page.waitForTimeout(3000); }
}
const after = await page.evaluate(() => document.body.innerText || '');
console.log('  toast:', (after.split('\n').filter(l => /quotation|RFQ|not go through|Nothing was/i.test(l))[0] || '(none)').slice(0, 90));
console.log('  POSTs:', posts.join(', ') || '(none)');
const rfqCountAfter = (await (await fetch(API + '/v1/rfqs', { headers: { cookie: jar['emeka.nwosu@wewe.org'] } })).json()).length;
console.log(`  RFQs on the server: ${rfqCountBefore} -> ${rfqCountAfter}  ${rfqCountAfter > rfqCountBefore ? '(written)' : '(NOT written)'}`);
console.log('\npage errors:', errs.length ? [...new Set(errs)].join(' | ') : 'none');
await b.close();
