import { chromium } from 'playwright';
const routes = ['#/dashboard', '#/requisitions', '#/requisitions/queue', '#/advances', '#/budgets', '#/quickbooks',
  '#/procurement', '#/inventory', '#/assets', '#/documents', '#/hr', '#/timesheets', '#/payroll',
  '#/grants', '#/audit', '#/reports', '#/admin', '#/admin/roles', '#/design-system', '#/mobile', '#/system',
  '#/auth/2fa', '#/auth/reset', '#/auth/setup', '#/auth/locked', '#/account/profile', '#/account/signature',
  '#/account/notifications', '#/account/delegation', '#/admin/workflow/chain', '#/documents/certificate',
  '#/sign/external', '#/print/travel-authority', '#/print/purchase-order', '#/print/hr-letter'];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('googleapis') && !m.text().includes('net::')) errors.push(m.text().slice(0, 120)); });
await page.goto('http://localhost:5173/?as=admin');
await page.waitForTimeout(2800);
for (let i = 0; i < 3; i++) { const b = page.locator('button:visible').first(); if (!(await b.count())) break; await b.click().catch(() => {}); await page.waitForTimeout(1000); }
let blank = [];
for (const rt of routes) {
  await page.goto('http://localhost:5173/?as=admin' + rt);
  await page.waitForTimeout(900);
  const len = await page.evaluate(() => document.body.innerText.length);
  if (len < 300) blank.push(rt);
}
console.log('routes visited:', routes.length, '| blank/broken routes:', blank.length ? blank.join(', ') : 'none');
console.log('JS errors:', errors.length ? errors.join(' || ') : 'none');
await browser.close();
process.exit(errors.length + blank.length);
