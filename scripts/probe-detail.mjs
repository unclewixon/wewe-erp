import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/?as=finance');
await page.waitForTimeout(2800);
for (let i = 0; i < 3; i++) { const b = page.locator('button:visible').first(); if (!(await b.count())) break; await b.click().catch(()=>{}); await page.waitForTimeout(1000); }
// live ref detail
await page.goto('http://localhost:5173/?as=finance#/requisitions/REQ-2026-0003');
await page.waitForTimeout(1500);
const t = await page.evaluate(() => document.body.innerText.slice(0, 600));
console.log('DETAIL for live ref →', t.replace(/\n/g, ' | ').slice(0, 400));
// what buttons exist on that page
const btns = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.innerText.trim()).filter(Boolean).slice(0, 20));
console.log('BUTTONS:', btns.join(' · '));
const inputs = await page.evaluate(() => [...document.querySelectorAll('textarea, input[placeholder]')].map(i => i.placeholder || i.tagName).slice(0, 8));
console.log('INPUTS:', inputs.join(' · '));
await browser.close();
