import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
mkdirSync('/tmp/run', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/?as=finance');
await page.waitForTimeout(3000);
for (let i = 0; i < 3; i++) { const b = page.locator('button:visible').first(); if (!(await b.count())) break; await b.click().catch(()=>{}); await page.waitForTimeout(1000); }
await page.goto('http://localhost:5173/?as=finance#/dashboard');
await page.waitForTimeout(1600);
await page.screenshot({ path: '/tmp/run/dashboard.png' });
const t = await page.evaluate(() => document.body.innerText.slice(0, 300).replace(/\n+/g, ' | '));
console.log('LIVE:', t.slice(0, 200));
await browser.close();
