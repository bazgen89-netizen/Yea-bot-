/**
 * Снимки экранов — посмотреть, что получилось, не открывая сборку руками.
 *
 *   node scripts/shots.mjs
 *
 * Кладёт в dist/shots/. Кабинет снимается на 1440×900, телефон на 390×844 —
 * это те же ширины, по которым приложение само переключает вёрстку.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const dist = '/home/user/Yea-bot-/warehouse/dist/';
const out = `${dist}shots`;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`file://${dist}index.html`);
await page.waitForTimeout(14000);

const vis = (t) => page.getByText(t, { exact: true }).locator('visible=true').first();
const shot = async (name) => {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('  ', name);
};

console.log('Кабинет:');
await shot('01-кабинет-главная');

await vis('Товары и услуги').click();
await shot('02-кабинет-каталог');

await vis('Фильтр').click();
await shot('03-кабинет-фильтр');
await page.mouse.click(1400, 860);
await page.waitForTimeout(600);

const sku = await page.evaluate(() => {
  const cell = [...document.querySelectorAll('div')].find(
    (el) => el.offsetParent && el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
      && /^\d{7}$/.test(el.textContent.trim()) && el.getBoundingClientRect().x > 300);
  return cell?.textContent.trim() ?? null;
});
if (sku) {
  await vis(sku).click();
  await shot('04-кабинет-карточка-товара');
}

await vis('Движение товара').click();
await shot('05-кабинет-журнал');

await vis('Отчеты').click();
await shot('06-кабинет-отчёты');
await vis('Продажи по товарам').click();
await shot('07-кабинет-отчёт');

await vis('Компания').click();
await page.waitForTimeout(700);
await vis('Сотрудники').click().catch(() => {});
await shot('08-кабинет-сотрудники');

console.log('Телефон:');
await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await page.waitForTimeout(12000);
await shot('10-телефон-главная');

for (const [tab, name] of [['Каталог', '11-телефон-каталог'], ['Журнал', '12-телефон-журнал'], ['Меню', '13-телефон-меню']]) {
  await vis(tab).click().catch(() => {});
  await shot(name);
}

await vis('Каталог').click().catch(() => {});
await page.waitForTimeout(1200);
const first = await page.evaluate(() => {
  const el = [...document.querySelectorAll('div')].find(
    (e) => e.offsetParent && e.childNodes.length === 1 && e.childNodes[0].nodeType === 3
      && e.getBoundingClientRect().y > 150 && e.getBoundingClientRect().x < 120
      && e.textContent.trim().length > 10);
  return el?.textContent.trim() ?? null;
});
if (first) {
  await vis(first).click().catch(() => {});
  await shot('14-телефон-карточка-товара');
}

console.log('\nОШИБКИ:', errors.length ? errors.slice(0, 3) : 'нет');
await browser.close();
