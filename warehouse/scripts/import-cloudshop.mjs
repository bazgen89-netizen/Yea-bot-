/**
 * Перенос всего из CloudShop одной командой.
 *
 *   CLOUDSHOP_TOKEN=… node scripts/import-cloudshop.mjs
 *
 * Забирает и кладёт туда, откуда программа заводит свою базу:
 *
 *   • товары   — все поля карточки: код, артикул, штрихкод, PLU, единица,
 *                цена, скидка, вес, размеры, описание, категория, остатки по
 *                магазинам, и фотографии;
 *   • клиенты  — имя, телефоны, почта, день рождения, пол, адрес, личная
 *                скидка, бонусный счёт и накопления;
 *   • история  — все чеки со строками: что, сколько, почём, кому и когда.
 *
 * Ключ читается только из переменной окружения. Ключ, попавший в git,
 * остаётся в истории навсегда, и «удалить» его оттуда нельзя — только
 * перевыпустить в кабинете. Пароль от CloudShop не нужен вовсе.
 *
 * Ключи:
 *   --no-photos       не забирать фотографии (быстро)
 *   --no-history      не забирать историю покупок
 *   --history=N       сколько последних чеков брать (по умолчанию все)
 *   --local           положить рядом, в src/db/seed/local/, не трогая сборку
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://connect-api.cloudshop.ru/api/v4';
const token = process.env.CLOUDSHOP_TOKEN;

if (!token) {
  console.error('Нужен ключ: CLOUDSHOP_TOKEN=… node scripts/import-cloudshop.mjs');
  console.error('Взять его: кабинет CloudShop → Интеграции → Connect API → создать ключ.');
  console.error('Пароль от кабинета не нужен и не принимается.');
  process.exit(1);
}

// Ключ уходит заголовком, а в заголовок можно только латиницу: если в
// переменную попал русский текст (например, слово «токен»), ошибка вылезет
// глубоко внутри `fetch` и ничего не объяснит.
if (/[^\x20-\x7e]/.test(token)) {
  console.error('В CLOUDSHOP_TOKEN попали нелатинские знаки — это не ключ.');
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flag = (name) => process.argv.includes(`--${name}`);
const value = (name, fallback) => {
  const found = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const out = flag('local') ? `${root}/src/db/seed/local` : `${root}/src/db/seed`;
mkdirSync(out, { recursive: true });

/** Цены — копейки, количества — тысячные: в базе они целые. */
const kopecks = (input) => Math.round((Number(input) || 0) * 100);
const milli = (input) => Math.round((Number(input) || 0) * 1000);
const bp = (percent) => Math.round((Number(percent) || 0) * 100);

async function get(path) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        headers: { 'X-CloudShop-API-Access-Token': token, Accept: 'application/json' },
        redirect: 'manual',
      });
    } catch (error) {
      // Сеть моргнула — пробуем ещё пару раз: выгрузка длинная, и ронять её
      // из-за одного разрыва обидно.
      if (attempt >= 3) throw error;
      await new Promise((done) => setTimeout(done, attempt * 2000));
      continue;
    }

    // Отказ приходит редиректом на главную, а не кодом ошибки: без этой
    // проверки пустой ответ читался бы как «данных нет».
    if (response.status === 302) {
      throw new Error(`${path}: ключ не принят или ему не хватает прав`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        'ключ не принят. Проверьте, что он скопирован целиком и не отозван: ' +
          'кабинет CloudShop → Интеграции → Connect API.',
      );
    }
    if (response.status === 429 && attempt < 5) {
      await new Promise((done) => setTimeout(done, attempt * 3000));
      continue;
    }
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);

    return response.json();
  }
}

/** Постранично, пока страница приходит полной. */
async function all(path, limit, label, cap = Infinity) {
  const rows = [];

  for (let offset = 0; rows.length < cap; offset += limit) {
    const glue = path.includes('?') ? '&' : '?';
    const page = await get(`${path}${glue}limit=${limit}&offset=${offset}`);
    const list = Array.isArray(page) ? page : (page.data ?? page.items ?? []);

    rows.push(...list);
    process.stdout.write(`\r  ${label}: ${rows.length}`);
    if (list.length < limit) break;
  }

  process.stdout.write('\n');
  return rows.slice(0, cap === Infinity ? rows.length : cap);
}

// Ошибки печатаем строкой, а не стеком: тому, кто запускает перенос, нужен
// ответ «что не так», а не место в коде.
process.on('unhandledRejection', (error) => {
  console.error(`\nНе получилось: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

// --- магазины -------------------------------------------------------------

console.log('Магазины…');
const { shops = [] } = await get('/stores');
const storeName = new Map(shops.map((shop) => [shop.id, (shop.name ?? '').trim()]));
console.log(`  ${shops.length}`);

// --- товары ---------------------------------------------------------------

console.log('Товары…');
const rawProducts = await all('/product', 1000, 'товаров');

/**
 * Формат — тот же, в котором лежит наполнение базы: короткие ключи и целые
 * числа. Он читается и глазами: остатки подписаны названием магазина, а не
 * идентификатором CloudShop, который у нас ничего не значит.
 */
const products = rawProducts.map((item) => {
  const options = item.options ?? {};
  const size = item.dimensions ?? {};

  const stock = {};
  for (const [id, qty] of Object.entries(item.stock ?? {})) {
    const amount = milli(qty);
    if (amount !== 0) stock[storeName.get(id) ?? id] = amount;
  }

  return {
    n: (options.name ?? '').trim(),
    c: item.code || null,
    s: item.sku || null,
    // Штрихкод и PLU — по ним товар ищется сканером и весами.
    bc: item.barcode || null,
    plu: item.plu_code || null,
    u: item.unit || 'шт',
    p: kopecks(item.price),
    d: bp(item.discount),
    // Категорий у товара в CloudShop может быть несколько, у нас одна:
    // берём первую, а не склеиваем в строку, которой нигде нет.
    g: item.tags?.[0] ?? null,
    q: stock,
    // Описание, вес и размеры — то, что у него лежит в карточке ниже цены.
    desc: (options.description ?? '').trim() || null,
    wg: item.weight ? Math.round(Number(item.weight) * 1000) : null,
    hm: size.height ? Math.round(Number(size.height) * 10) : null,
    wm: size.width ? Math.round(Number(size.width) * 10) : null,
    dm: size.depth ? Math.round(Number(size.depth) * 10) : null,
    // Ссылка на фотографию — по ней качается картинка ниже.
    img: item.img?.[0] ?? null,
  };
});

writeFileSync(`${out}/products.json`, JSON.stringify(products, null, 1));

// --- клиенты --------------------------------------------------------------

console.log('Клиенты…');
const rawCustomers = await all('/customers', 500, 'клиентов');

const customers = rawCustomers.map((item) => {
  const billing = item.billing ?? {};
  const loyalty = item.loyalty ?? {};

  const phones = []
    .concat(billing.phone ?? [], billing.phones ?? [], item.phones ?? [])
    .filter((phone) => typeof phone === 'string' && phone.trim())
    .map((phone) => phone.trim());

  return {
    // Идентификатор CloudShop нужен, чтобы привязать к клиенту его чеки.
    id: item.id ?? null,
    n: (item.name ?? '').trim(),
    p: phones[0] ?? null,
    ph: phones.length > 1 ? phones : null,
    e: item.emails?.[0] ?? billing.email ?? null,
    b: item.birthday || null,
    g: item.sex || null,
    d: billing.note ?? null,
    a: billing.address ?? null,
    by: 'CloudShop',
    // Личная скидка — в сотых долях процента, как и везде у нас.
    dc: bp(item.discount),
    // Бонусный счёт и что уже потрачено.
    bo: kopecks(loyalty.bonus ?? loyalty.balance ?? 0),
    bs: kopecks(loyalty.spent ?? 0),
    lt: loyalty.type ?? (Number(item.discount) > 0 ? 'discount' : null),
  };
});

writeFileSync(`${out}/clients.json`, JSON.stringify(customers, null, 1));

// --- история покупок ------------------------------------------------------

let sales = [];

if (!flag('no-history')) {
  console.log('История покупок…');
  const cap = Number(value('history', '')) || Infinity;
  const documents = await all('/documents/sales', 100, 'чеков', cap);

  // Товар в строке чека приходит идентификатором CloudShop; у нас товары
  // опознаются кодом — по нему и связываем.
  const codeById = new Map(rawProducts.map((item) => [item.id, item.code || null]));

  sales = documents.map((doc) => ({
    // Дата чека — та, что стоит в документе, а не время выгрузки.
    at: doc.processed_at ?? doc.created_at ?? null,
    // Клиент — идентификатором CloudShop: имена повторяются, а он один.
    c: doc.client_id ?? doc.customer?.id ?? null,
    t: kopecks(doc.total_price),
    disc: kopecks(doc.total_discounts),
    pay: payment(doc),
    st: storeName.get(doc.location_id) ?? null,
    no: doc.order_number ?? doc.name ?? null,
    ln: (doc.line_items ?? []).map((line) => ({
      code: line.product_code ?? codeById.get(line.product_id) ?? null,
      n: (line.name ?? line.title ?? '').trim() || null,
      q: milli(line.quantity ?? line.qty ?? 0),
      p: kopecks(line.price ?? line.unit_price ?? 0),
      d: kopecks(line.discount ?? 0),
    })),
  }));

  writeFileSync(`${out}/sales.json`, JSON.stringify(sales, null, 1));
}

/** Чем платили: у него это флаги в `payment_terms`. */
function payment(doc) {
  const terms = doc.payment_terms ?? {};
  if (terms.card || terms.cashless || doc.payment_method === 'card') return 'card';
  if (terms.transfer || doc.payment_method === 'transfer') return 'transfer';
  return 'cash';
}

// --- фотографии -----------------------------------------------------------

if (!flag('no-photos')) {
  console.log('Фотографии…');
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const photos = {};
  let done = 0;
  let failed = 0;

  for (const product of products) {
    if (!product.img || !product.c) continue;

    try {
      // Ужимаем прямо в браузере: 590 фотографий по 2–3 КБ дают полтора
      // мегабайта, и файл это выдерживает. Полноразмерные — сотни мегабайт.
      const data = await page.evaluate(shrink, { url: product.img, size: 96 });
      if (data) {
        photos[product.c] = data;
        done++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }

    if ((done + failed) % 25 === 0) process.stdout.write(`\r  фотографий: ${done}`);
  }

  process.stdout.write(`\r  фотографий: ${done}\n`);
  if (failed) console.log(`  не скачалось: ${failed}`);

  await browser.close();
  writeFileSync(`${out}/photos.json`, JSON.stringify(photos, null, 1));
}

/**
 * Скачать картинку и ужать её до квадрата.
 *
 * Выполняется внутри браузера: там есть и загрузка по ссылке, и холст, на
 * котором картинку можно уменьшить, — в Node для этого пришлось бы тащить
 * стороннюю библиотеку.
 */
function shrink({ url, size }) {
  return new Promise((done) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onerror = () => done(null);
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;

      const context = canvas.getContext('2d');
      if (!context) return done(null);

      // Вписываем по короткой стороне и обрезаем — так товар остаётся в
      // середине, а не сжимается в блин.
      const side = Math.min(image.width, image.height);
      context.drawImage(
        image,
        (image.width - side) / 2,
        (image.height - side) / 2,
        side,
        side,
        0,
        0,
        size,
        size,
      );

      done(canvas.toDataURL('image/jpeg', 0.72));
    };
    image.src = url;
  });
}

// --- итог -----------------------------------------------------------------

const size = (file) => {
  try {
    return `${Math.round(readFileSync(`${out}/${file}`).length / 1024)} КБ`;
  } catch {
    return '—';
  }
};

console.log(`
  товаров          ${products.length}   (${size('products.json')})
  с фотографией    ${flag('no-photos') ? 'пропущено' : Object.keys(JSON.parse(readFileSync(`${out}/photos.json`, 'utf8'))).length}
  клиентов         ${customers.length}   (${size('clients.json')})
  чеков в истории  ${flag('no-history') ? 'пропущено' : sales.length}   (${size('sales.json')})

Записано в ${out.replace(root + '/', '')}.
Дальше: SEED=1 npm run web:build — и всё это окажется в программе.`);
