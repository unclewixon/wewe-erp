import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const shots = '/tmp/shots';
import { mkdirSync } from 'fs';
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/signin`);
await page.waitForSelector('.signin-card');
await page.screenshot({ path: `${shots}/01-signin.png` });

await page.fill('input[type=email]', 'ibrahim.musa@wewe.org');
await page.fill('input[type=password]', 'Password1!');
await page.click('button:has-text("Sign in")');
await page.waitForSelector('.stat-grid', { timeout: 15000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${shots}/02-dashboard-finance.png` });

await page.click('a:has-text("Requisitions")');
await page.waitForSelector('table.data, .empty', { timeout: 10000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${shots}/03-queue-finance.png` });

// open first queue item
const row = page.locator('table.data tbody tr').first();
await row.click();
await page.waitForSelector('.tracker', { timeout: 10000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${shots}/04-detail-tracker.png` });

// approve it
const approve = page.locator('button:has-text("Approve")').first();
if (await approve.isVisible()) {
  await approve.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${shots}/05-after-approve.png` });
}

await browser.close();
console.log('screenshots done');
