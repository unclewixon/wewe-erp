import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
mkdirSync('/tmp/shots5', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', m => { if (m.text().includes('[wewe]')) console.log('BROWSER', m.text()); });
await page.goto('http://localhost:5173/?as=supervisor');
await page.waitForTimeout(2800);
for (let i = 0; i < 3; i++) { const b = page.locator('button:visible').first(); if (!(await b.count())) break; await b.click().catch(()=>{}); await page.waitForTimeout(1000); }
await page.goto('http://localhost:5173/?as=supervisor#/requisitions/queue');
await page.waitForTimeout(1600);
await page.screenshot({ path: '/tmp/shots5/queue-before.png' });
const before = await page.evaluate(() => document.body.innerText.match(/REQ-\d{4}-\d{4}/g) || []);
console.log('queue refs before:', [...new Set(before)].join(', '));
// click Approve on the first live row
const rowBtn = page.locator('button:has-text("Approve")').nth(1); // skip possible header button
const target = (await rowBtn.count()) ? rowBtn : page.locator('button:has-text("Approve")').first();
await target.click();
await page.waitForTimeout(3500); // reload happens
await page.goto('http://localhost:5173/?as=supervisor#/requisitions/queue');
await page.waitForTimeout(1600);
await page.screenshot({ path: '/tmp/shots5/queue-after.png' });
const after = await page.evaluate(() => document.body.innerText.match(/REQ-\d{4}-\d{4}/g) || []);
console.log('queue refs after:', [...new Set(after)].join(', '));
await browser.close();
