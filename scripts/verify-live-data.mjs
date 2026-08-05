import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
mkdirSync('/tmp/shots3', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 200)));
await page.goto('http://localhost:5173/');
await page.waitForTimeout(3000);
for (let i = 0; i < 3; i++) {
  const b = page.locator('button:visible').first();
  if (!(await b.count())) break;
  await b.click().catch(() => {});
  await page.waitForTimeout(1200);
}
await page.goto('http://localhost:5173/#/requisitions');
await page.waitForTimeout(1800);
await page.screenshot({ path: '/tmp/shots3/requisitions-live.png' });
const text = await page.evaluate(() => document.body.innerText.slice(0, 4000));
console.log('page mentions live seed refs:', /REQ-2026-000\d/.test(text), '| fixture ref present:', text.includes('REQ-2026-0187'));
await browser.close();
