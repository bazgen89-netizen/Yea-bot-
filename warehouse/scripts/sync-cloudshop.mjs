/**
 * Забирает каталог из Connect API в файл, из которого приложение заводит базу.
 *
 * Ключ берётся из переменной окружения, а не из файла в репозитории: ключ,
 * попавший в git, остаётся в истории навсегда, и «удалить» его оттуда нельзя —
 * только перевыпустить в кабинете.
 *
 *   CLOUDSHOP_TOKEN=... node scripts/sync-cloudshop.mjs
 *
 * Пишет в src/db/seed/local/ — эта папка не коммитится: там живые остатки
 * и цены работающего магазина.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://connect-api.cloudshop.ru/api/v4';
const token = process.env.CLOUDSHOP_TOKEN;

if (!token) {
  console.error('Нужен ключ: CLOUDSHOP_TOKEN=... node scripts/sync-cloudshop.mjs');
  console.error('Взять его: кабинет → Интеграции → Connect API → сгенерировать.');
  process.exit(1);
}

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../src/db/seed/local');
mkdirSync(out, { recursive: true });

async function get(path) {
  const response = await fetch(`${API}${path}`, {
    headers: { 'X-CloudShop-API-Access-Token': token, Accept: 'application/json' },
    redirect: 'manual',
  });

  // Отказ приходит редиректом на главную, а не кодом ошибки: без этой
  // проверки пустой ответ читался бы как «данных нет».
  if (response.status === 302) {
    throw new Error(`${path}: ключу не хватает прав (или параметры не приняты)`);
  }
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);

  return response.json();
}

/** Товары отдаются страницами; API отдаёт максимум тысячу за раз. */
async function allProducts() {
  const products = [];
  const limit = 1000;

  for (let offset = 0; ; offset += limit) {
    const page = await get(`/product?limit=${limit}&offset=${offset}`);
    products.push(...page);
    process.stdout.write(`\r  товаров: ${products.length}`);
    if (page.length < limit) break;
  }

  process.stdout.write('\n');
  return products;
}

console.log('Магазины…');
const { shops } = await get('/stores');
console.log(`  ${shops.length}`);

console.log('Товары…');
const raw = await allProducts();

console.log('Категории…');
const tags = await get('/product/ext-tags').catch(() => []);

/**
 * Цены и остатки приходят дробными числами. В базе они целые: деньги —
 * копейки, количества — тысячные. Перевод делается здесь, один раз, а не
 * в приложении при каждом чтении.
 */
const kopecks = (value) => Math.round((Number(value) || 0) * 100);
const milli = (value) => Math.round((Number(value) || 0) * 1000);

const stores = shops.map((shop) => ({ id: shop.id, name: shop.name.trim(), address: shop.address }));
const storeName = new Map(stores.map((shop) => [shop.id, shop.name]));

/**
 * Формат тот же, в котором лежит наполнение базы: короткие ключи и целые
 * числа. Остатки подписаны названием магазина, а не его идентификатором:
 * идентификаторы CloudShop у нас ничего не означают, а по названию видно,
 * что за магазин, если открыть файл глазами.
 *
 * Магазины без единого остатка в строку не попадают — иначе у каждого из
 * 590 товаров висели бы семь нулей.
 */
const products = raw.map((item) => {
  const stock = {};
  for (const [id, qty] of Object.entries(item.stock ?? {})) {
    const amount = milli(qty);
    if (amount !== 0) stock[storeName.get(id) ?? id] = amount;
  }

  return {
    n: (item.options?.name ?? '').trim(),
    c: item.code || null,
    s: item.sku || null,
    u: item.unit || 'шт',
    p: kopecks(item.price),
    d: Math.round((Number(item.discount) || 0) * 100),
    // Категорий в CloudShop у товара может быть несколько, у нас одна:
    // берём первую, а не склеиваем их в строку, которой нигде нет.
    g: item.tags?.[0] ?? null,
    q: stock,
  };
});

const withStock = products.filter((p) => Object.keys(p.q).length > 0);
const negative = products.filter((p) => Object.values(p.q).some((q) => q < 0));

writeFileSync(`${out}/stores.json`, JSON.stringify(stores, null, 1));
writeFileSync(`${out}/categories.json`, JSON.stringify(tags, null, 1));

// Каталог — цены, коды и остатки — кладётся туда, откуда приложение заводит
// базу. Клиентов скрипт не трогает: это личные данные 3184 человек, и таскать
// их туда-сюда без нужды не стоит.
const target = process.argv.includes('--seed')
  ? resolve(out, '../products.json')
  : `${out}/products.json`;

writeFileSync(target, JSON.stringify(products, null, 1));

console.log(`
  магазинов        ${stores.length}
  товаров          ${products.length}
  с остатком       ${withStock.length}
  в минусе         ${negative.length}
  категорий        ${Array.isArray(tags) ? tags.length : '—'}

Каталог записан: ${target.replace(resolve(out, '../../../..') + '/', '')}`);
