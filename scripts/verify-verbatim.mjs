import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
mkdirSync('/tmp/shots2', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/');
await page.waitForTimeout(2500);
await page.screenshot({ path: '/tmp/shots2/01-signin-verbatim.png' });
for (let i = 0; i < 3; i++) {
  const b = page.locator('button:visible').first();
  if (!(await b.count())) break;
  await b.click().catch(() => {});
  await page.waitForTimeout(1400);
  const url = page.url();
  if (url.includes('#/')) break;
}
await page.screenshot({ path: '/tmp/shots2/03-app.png' });
// visit admin roles (the deep permissions module) and requisition detail
await page.goto('http://localhost:5173/#/admin/roles'); await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/shots2/04-admin-roles.png' });
await page.goto('http://localhost:5173/#/requisitions/REQ-2026-0187'); await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/shots2/05-req-detail.png' });
await browser.close();
console.log('done');
