/**
 * Прокликивает меню кассира и записывает, куда на самом деле ведёт каждый пункт.
 *
 * Нужен, чтобы `docs/меню-кассира.md` описывал приложение, а не память того,
 * кто его писал: после правок меню сценарий прогоняется заново, и таблица
 * либо подтверждается, либо расходится — и тогда врёт документ, а не код.
 *
 *   npm run web:build && node scripts/audit-cashier-menu.mjs
 *
 * Снимки экрана и разбор кладутся в `dist/audit/`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

// Playwright не в зависимостях проекта: он нужен одному этому сценарию, а
// приложению — нет. Берём тот, что стоит в системе, и говорим по-человечески,
// если его нет, вместо «Cannot find package».
const { chromium } = await import('playwright').catch(() => {
  console.error('Нужен Playwright: npm i -g playwright && npx playwright install chromium');
  process.exit(1);
});

const dist = new URL('../dist/', import.meta.url).pathname;
const shots = `${dist}audit`;
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
let dialogs = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => d.accept()); });

await page.goto(`file://${dist}index.html`);
await page.waitForTimeout(12000);

const vis = (label) => page.getByText(label, { exact: true }).locator('visible=true').first();
const text = () => page.evaluate(() => document.getElementById('root').innerText);
const inCashier = async () => (await text()).includes('ПРОДАЖА');

async function toCashier() {
  if (await inCashier()) return;
  await vis('Интерфейс кассира').click();
  await page.waitForTimeout(1500);
}

async function closePanel() {
  // Панель закрывается нажатием мимо неё — по затемнению справа.
  const open = await page.getByText('Выйти в кабинет', { exact: true }).locator('visible=true').count();
  if (open) {
    await page.mouse.click(1100, 450);
    await page.waitForTimeout(500);
  }
}

async function openMenu() {
  await closePanel();
  await toCashier();
  // По ярлыку, а не по тексту: слово «Меню» есть ещё и в заголовке панели.
  await page.getByLabel('Меню', { exact: true }).last().click({ timeout: 8000 });
  await page.waitForTimeout(700);
}

// Что вообще есть в меню — читаем из самой панели, а не из моей памяти.
await openMenu();
await page.screenshot({ path: `${shots}/audit-меню.png` });
const items = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('[role="button"]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.left < 380 && r.width > 300 && r.height > 40 && r.height < 80) {
      // Значки — символы из приватной области Unicode; в подписи они не нужны.
      const t = el.innerText
        .split('\n')
        .map((s) => s.replace(/[\uE000-\uF8FF]|[\u{F0000}-\u{FFFFD}]/gu, '').trim())
        .filter(Boolean);
      if (t.length) out.push({ label: t[0], hint: t[1] ?? '' });
    }
  });
  return out;
});
console.log('ПУНКТОВ В МЕНЮ:', items.length);

const rows = [];
for (const item of items) {
  await openMenu();
  dialogs = [];
  await vis(item.label).click({ timeout: 8000, noWaitAfter: true }).catch((e) => console.log('   (клик:', String(e).split('\n')[0], ')'));
  await page.waitForTimeout(1500);

  const body = await text();
  const lines = body.split('\n').filter((l) => l.trim());
  // Заголовок раздела кабинета — сразу после логотипа.
  const i = lines.indexOf('CloudShop');
  const title = i >= 0 ? (lines[i + 1] ?? '') : (lines[0] ?? '');
  const still = await inCashier();
  const file = `audit-${item.label.replace(/[^\wА-Яа-яё]+/g, '-')}.png`;
  await page.screenshot({ path: `${shots}/${file}` });

  rows.push({
    label: item.label,
    hint: item.hint,
    where: still ? 'остаётся в кассе' : title,
    dialogs: dialogs.map((d) => d.replace(/\n+/g, ' · ')),
    file,
  });
  console.log(item.label.padEnd(22), '→', still ? 'касса' : title, dialogs.length ? `[${dialogs.length} диалог]` : '');
}

writeFileSync(`${shots}/меню.json`, JSON.stringify({ rows, errors: [...new Set(errors)] }, null, 2));
console.log('ОШИБКИ:', errors.length ? [...new Set(errors)].slice(0, 5) : 'нет');
await browser.close();
