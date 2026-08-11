import { chromium } from 'playwright';
const dist = '/home/user/Yea-bot-/warehouse/dist/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`file://${dist}index.html`);
await page.waitForTimeout(14000);

const items = await page.evaluate(() =>
  [...document.querySelectorAll('div')]
    .filter((e) => {
      const r = e.getBoundingClientRect();
      return e.offsetParent && e.childNodes.length === 1 && e.childNodes[0].nodeType === 3
        && r.x < 290 && r.width > 30 && e.textContent.trim();
    })
    .map((e) => {
      const r = e.getBoundingClientRect();
      const s = getComputedStyle(e);
      return { text: e.textContent.trim(), y: Math.round(r.y), x: Math.round(r.x),
               size: parseFloat(s.fontSize), color: s.color };
    })
    .sort((a, b) => a.y - b.y));

console.log('ПУНКТ                          y    x   размер  цвет');
for (const i of items) {
  console.log(`${i.text.slice(0,28).padEnd(30)} ${String(i.y).padEnd(4)} ${String(i.x).padEnd(3)} ${String(i.size).padEnd(6)} ${i.color}`);
}
await browser.close();
