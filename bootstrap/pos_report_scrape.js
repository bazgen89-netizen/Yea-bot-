const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1700, height: 1000 } });
  await p.goto('file://' + process.env.S + '/app.html', { waitUntil: 'load', timeout: 120000 });
  await p.waitForTimeout(9000);
  await p.getByText('Отчеты', { exact: true }).first().click();
  await p.waitForTimeout(3500);
  await p.getByText('Продажи по товарам', { exact: true }).first().click();
  await p.waitForTimeout(6000);
  // период: открыть переключатель «месяц» и посмотреть варианты
  try {
    await p.getByText('месяц', { exact: true }).first().click();
    await p.waitForTimeout(1500);
    const opts = await p.evaluate(() => [...document.querySelectorAll('*')]
      .filter(e => e.children.length === 0 && /^(день|неделя|месяц|квартал|год|всё время|все время|период)$/i.test(e.textContent.trim()))
      .map(e => e.textContent.trim()));
    console.log('варианты периода:', [...new Set(opts)]);
    for (const want of ['всё время', 'все время', 'год']) {
      const el = p.getByText(want, { exact: true }).first();
      if (await el.count()) { await el.click(); console.log('выбрано:', want); break; }
    }
  } catch (e) { console.log('период не переключился:', e.message.slice(0, 60)); }
  await p.waitForTimeout(6000);
  const data = await p.evaluate(async () => {
    let best = null, bestN = 0;
    document.querySelectorAll('div').forEach(d => {
      const n = d.children.length;
      if (n > bestN && n > 8) {
        const h = [...d.children].map(c => Math.round(c.getBoundingClientRect().height));
        if (new Set(h).size <= 3) { best = d; bestN = n; }
      }
    });
    if (!best) return [];
    // прокрутить контейнер до конца, чтобы дорисовались все строки
    let sc = best;
    while (sc && sc.scrollHeight <= sc.clientHeight + 4) sc = sc.parentElement;
    for (let i = 0; i < 60 && sc; i++) {
      sc.scrollTop = sc.scrollHeight;
      await new Promise(r => setTimeout(r, 250));
    }
    return [...best.children].map(r =>
      [...r.querySelectorAll('*')].filter(e => e.children.length === 0)
        .map(e => e.textContent.trim()).filter(Boolean));
  });
  fs.writeFileSync(process.env.S + '/pos_report.json', JSON.stringify(data, null, 1));
  console.log('строк снято:', data.length);
  await b.close();
})();
