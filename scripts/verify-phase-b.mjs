import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
mkdirSync('/tmp/shots4', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/?as=admin');
await page.waitForTimeout(3000);
for (let i = 0; i < 3; i++) {
  const b = page.locator('button:visible').first();
  if (!(await b.count())) break;
  await b.click().catch(() => {});
  await page.waitForTimeout(1100);
}
for (const [route, name] of [['#/admin', 'admin-users'], ['#/grants', 'grants'], ['#/hr', 'hr-staff']]) {
  await page.goto('http://localhost:5173/?as=admin' + route);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `/tmp/shots4/${name}.png` });
}
const text = await page.evaluate(() => document.body.innerText.slice(0, 3000));
console.log('live emails visible:', text.includes('wewe.org'));
await browser.close();
