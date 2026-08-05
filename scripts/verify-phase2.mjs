import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
mkdirSync('/tmp/shots7', { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const acts = [];
page.on('console', (m) => { if (m.text().includes('[wewe]')) acts.push(m.text()); });
await page.goto('http://localhost:5173/?as=supervisor');
await page.waitForTimeout(3000);
for (let i = 0; i < 3; i++) { const b = page.locator('button:visible').first(); if (!(await b.count())) break; await b.click().catch(()=>{}); await page.waitForTimeout(1000); }

// find a live PENDING ref in tunde's queue, open ITS detail page (G20)
const queueRefs = await page.evaluate(async () => {
  const r = await fetch('/v1/requisitions?scope=queue', { credentials: 'include' });
  return (await r.json()).map((t) => t.ref);
});
console.log('live queue refs:', queueRefs.join(', ') || 'EMPTY');
const ref = queueRefs[0];
if (ref) {
  await page.goto(`http://localhost:5173/?as=supervisor#/requisitions/${ref}`);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: '/tmp/shots7/detail-live-ref.png' });
  const txt = await page.evaluate(() => document.body.innerText);
  console.log('G20 detail renders live ref:', txt.includes(ref), '| has action panel:', /Approve/.test(txt));
  // G21: open the decision drawer via Return (needs note) then confirm
  const returnBtn = page.locator('button:visible', { hasText: 'Return' }).first();
  if (await returnBtn.count()) {
    await returnBtn.click(); await page.waitForTimeout(900);
    await page.screenshot({ path: '/tmp/shots7/decision-drawer.png' });
    const note = page.locator('textarea:visible').first();
    if (await note.count()) {
      await note.fill('Please attach the vendor quote — returned from the live drawer.');
      const confirm = page.locator('button:visible', { hasText: /Return|Confirm/ }).last();
      await confirm.click();
      await page.waitForTimeout(3500); // __weweAct → engine → reload
    }
  }
  console.log('acts:', acts.join(' | ') || 'none');
}
await browser.close();
