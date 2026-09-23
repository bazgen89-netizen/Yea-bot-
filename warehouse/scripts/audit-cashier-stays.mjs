/**
 * Проверка: меню кассира не выбрасывает из кассы.
 *
 *   node scripts/audit-cashier-stays.mjs
 *
 * Касса — рабочее место. Раньше каждый пункт её меню вёл на экран кабинета,
 * и после нажатия кассир оказывался на Главной. Разбор нажимает всё подряд
 * и после каждого нажатия смотрит, остался ли он в кассе.
 */
import { chromium } from 'playwright';

const dist = '/home/user/Yea-bot-/warehouse/dist/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.dismiss().catch(() => {}));
await page.goto(`file://${dist}index.html`);
await page.waitForTimeout(14000);

const shown = () =>
  page.evaluate(() => {
    const out = [];
    const walk = (el) => {
      if (el.nodeType === 3) { const t = el.textContent.trim(); if (t) out.push(t); return; }
      if (el.nodeType !== 1) return;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return;
      for (const c of el.childNodes) walk(c);
    };
    walk(document.getElementById('root'));
    return out;
  });

/** В кассе мы, если внизу горит полоса «ПРОДАЖА». */
const inCashier = async () => (await shown()).includes('ПРОДАЖА');
const vis = (t) => page.getByText(t, { exact: true }).locator('visible=true').first();

await vis('Интерфейс кассира').click();
await page.waitForTimeout(2500);
console.log('вошли в кассу:', (await inCashier()) ? 'да' : 'НЕТ');

// Пункты меню кассира, кроме выхода.
const ITEMS = [
  'История чеков', 'Клиенты', 'Товары', 'Смены и кассы',
  'Внесение и изъятие', 'X-отчёт', 'Настройки',
];

let bad = 0;
for (const item of ITEMS) {
  await vis('Меню').click().catch(() => {});
  await page.waitForTimeout(700);

  const found = await vis(item).count();
  if (!found) { console.log(`${item.padEnd(22)} — пункта нет`); continue; }

  await vis(item).click();
  await page.waitForTimeout(1400);

  const stayed = await inCashier();
  if (!stayed) bad++;
  console.log(`${item.padEnd(22)} ${stayed ? 'остались в кассе ✓' : 'ВЫБРОСИЛО ИЗ КАССЫ ✗'}`);

  // Возвращаемся к продаже, чтобы следующий пункт открывался из того же места.
  await vis('‹').click().catch(() => {});
  await page.waitForTimeout(600);
}

await page.screenshot({ path: `${dist}shots/касса-раздел.png` });
console.log(`\nвыбросило: ${bad} из ${ITEMS.length}`);
console.log('ОШИБКИ:', errors.length ? errors.slice(0, 3) : 'нет');
await browser.close();
