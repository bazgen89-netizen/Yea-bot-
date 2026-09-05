/**
 * Прокликивает всё, что в приложении нажимается, и записывает, куда оно ведёт.
 *
 * Нужен, чтобы «некликабельно» и «перекидывает на главную» были списком с
 * именами, а не ощущением: сценарий обходит разделы кабинета и мобильное меню,
 * жмёт каждую кнопку и сверяет заголовок до и после.
 *
 *   npm run web:build && node scripts/audit-app.mjs
 *
 * Разбор кладётся в `dist/audit/приложение.json`, снимки — рядом.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const { chromium } = await import('playwright').catch(() => {
  console.error('Нужен Playwright: npm i -g playwright && npx playwright install chromium');
  process.exit(1);
});

const dist = new URL('../dist/', import.meta.url).pathname;
const shots = `${dist}audit`;
mkdirSync(shots, { recursive: true });

/** Разделы кабинета: подпись в боковом меню — ожидаемый заголовок. */
const SECTIONS = [
  ['Главная', 'Главная'],
  ['Товары и услуги', 'Товары и услуги / справочник'],
  ['Движение товара', 'Движение товара'],
  ['Движение денег', 'Движение денег'],
  ['Отчеты', 'Отчеты'],
  ['Интернет-витрина', 'Интернет-витрина'],
  ['Интеграции', 'Интеграции'],
  ['Лаборатория', 'Лаборатория'],
  ['Тарифы и оплата', 'Тарифы и оплата'],
  ['Корзина', 'Корзина'],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
page.on('dialog', (d) => d.dismiss().catch(() => {}));

await page.goto(`file://${dist}index.html`);
await page.waitForTimeout(12000);

const vis = (label) => page.getByText(label, { exact: true }).locator('visible=true').first();
/**
 * Текст только того, что видно.
 *
 * `innerText` корня отдаёт и вкладки, спрятанные под текущей: экраны в
 * expo-router остаются в разметке. Из-за этого «Каталог» и «Журнал» читались
 * как копия «Главной» — не потому, что они одинаковые, а потому, что мерили
 * не то. Собираем текст обходом, пропуская скрытые ветки.
 */
const lines = async () =>
  (await page.evaluate(() => {
    const skip = (el) => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
      if (el.getAttribute('aria-hidden') === 'true') return true;
      const r = el.getBoundingClientRect();
      return r.width === 0 && r.height === 0;
    };

    const out = [];
    const walk = (el) => {
      if (el.nodeType === Node.TEXT_NODE) {
        const text = el.textContent.trim();
        if (text) out.push(text);
        return;
      }
      if (el.nodeType !== Node.ELEMENT_NODE || skip(el)) return;
      for (const child of el.childNodes) walk(child);
    };

    walk(document.getElementById('root'));
    return out.join('\n');
  }))
    .split('\n')
    .map((s) => s.replace(/[-]|[\u{F0000}-\u{FFFFD}]/gu, '').trim())
    .filter(Boolean);

async function title() {
  const l = await lines();
  const i = l.indexOf('CloudShop');
  return i >= 0 ? (l[i + 1] ?? '') : (l[0] ?? '');
}

/** Всё, что нажимается на текущем экране, кроме бокового меню и шапки. */
async function clickables() {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="button"]')]
      // Экран, с которого ушли, остаётся в разметке скрытым: без этой
      // проверки в список попадали кнопки предыдущего раздела, и весь он
      // читался как «не нажалось».
      .filter((el) => el.offsetParent !== null && !el.closest('[aria-hidden="true"]'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        const text = el.innerText
          .replace(/[-]|[\u{F0000}-\u{FFFFD}]/gu, '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)[0];
        return { text, label: el.getAttribute('aria-label'), x: r.x, y: r.y, w: r.width };
      })
      // Левее 300 — боковое меню, выше 70 — шапка: их проверяем отдельно.
      .filter((c) => c.x > 300 && c.y > 70 && c.w > 20 && (c.text || c.label)),
  );
}

/** Закрыть всё, что могло открыться от нажатия: список, шторку, панель. */
async function dismiss() {
  for (const label of ['Закрыть список', 'Закрыть меню', 'Закрыть фильтр', 'Закрыть фильтры']) {
    const back = page.getByLabel(label, { exact: true });
    if (await back.count()) {
      await back.first().click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

const report = { desktop: [], mobile: [], errors: [] };

for (const [menu, expected] of SECTIONS) {
  await dismiss();
  await vis(menu).click();
  await page.waitForTimeout(1300);

  const opened = await title();
  const buttons = await clickables();
  const seen = new Set();
  const results = [];

  for (const button of buttons) {
    const name = button.text || button.label;
    if (!name || seen.has(name)) continue;
    seen.add(name);

    const before = await title();
    const target = button.text
      ? page.getByText(button.text, { exact: true }).locator('visible=true').first()
      : page.getByLabel(button.label, { exact: true }).locator('visible=true').first();

    try {
      await target.click({ timeout: 4000, noWaitAfter: true });
    } catch {
      results.push({ name, outcome: 'не нажалось' });
      continue;
    }
    await page.waitForTimeout(1100);

    const after = await title();
    // Панель или шторка, открытая этим нажатием, закрывает собой остальные
    // кнопки: без этого весь хвост списка читался бы как «не нажалось».
    await dismiss();
    const opened = await page.getByLabel('Закрыть список', { exact: true }).count();
    results.push({
      name,
      outcome: opened ? 'открыло список' : after === before ? 'осталось на месте' : `→ ${after}`,
    });

    await dismiss();
    if (after !== before) {
      await vis(menu).click();
      await page.waitForTimeout(1100);
    }
  }

  report.desktop.push({ section: menu, expected, opened, results });
  console.log(`\n### ${menu} (открылось: ${opened}${opened === expected ? '' : ' ← НЕ ТО'})`);
  for (const r of results) console.log(`   ${r.name.slice(0, 34).padEnd(36)} ${r.outcome}`);
}

// --- мобильная версия -----------------------------------------------------
await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await page.waitForTimeout(9000);

const tabs = ['Главная', 'Каталог', 'Журнал', 'Меню'];
for (const tab of tabs) {
  try {
    await vis(tab).click({ timeout: 4000 });
  } catch {
    report.mobile.push({ tab, outcome: 'вкладка не нашлась' });
    continue;
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${shots}/моб-${tab}.png` });

  const l = await lines();
  report.mobile.push({ tab, content: l.slice(0, 40) });
  console.log(`\n### телефон / ${tab}\n   ${l.slice(0, 30).join(' · ')}`);
}

report.errors = [...new Set(errors)];
writeFileSync(`${shots}/приложение.json`, JSON.stringify(report, null, 2));
console.log('\nОШИБКИ:', report.errors.length ? report.errors.slice(0, 5) : 'нет');
await browser.close();
