/**
 * Сборка без личных данных — та, которую можно показать по ссылке.
 *
 * Каталог, цены, остатки и история продаж остаются настоящими: это данные
 * магазина, и без них смотреть нечего. Карточки клиентов подменяются: имя,
 * телефон, почта, день рождения и адрес — выдуманные. Ссылку можно
 * переслать, а телефон живого человека, единожды уехавший на чужой сервер,
 * назад не вернёшь.
 *
 *   node scripts/build-demo.mjs
 *
 * Берёт свежую выгрузку из `src/db/seed/local/` — той папки, куда её кладёт
 * перенос и которой нет в git, — подставляет на время сборки и убирает
 * обратно. Кладёт результат в dist-demo/index.html, рабочую сборку не
 * трогает.
 */
import { execSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seed = `${root}/src/db/seed`;
const mine = `${seed}/local`;

const clients = `${seed}/clients.json`;
const backup = `${seed}/clients.real.json`;

/**
 * Сколько места отдать истории продаж.
 *
 * Страница по ссылке не может быть больше 16 МБ, а вся история — 13 МБ
 * одним файлом: с ней страница не открылась бы вовсе. Поэтому по ссылке
 * показываются свежие чеки, сколько влезает, а вся история — в файле,
 * который собирается `build-mine.mjs`.
 */
const HISTORY_BUDGET = 5_000_000;

/**
 * Ссылка с настоящими карточками клиентов — по его прямой просьбе.
 *
 *   node scripts/build-demo.mjs --real
 *
 * По умолчанию имена и телефоны подменяются: ссылку можно переслать, а
 * телефон живого человека, единожды уехавший на чужой сервер, назад не
 * вернёшь. С этим ключом на страницу кладутся настоящие — со всеми
 * телефонами, днями рождения и бонусами.
 *
 * Такую страницу **нельзя пересылать**: она видна тому, у кого есть ссылка.
 */
const REAL = process.argv.includes('--real');

/** Свежие чеки, пока не кончилось отведённое место. */
function trimHistory(sales) {
  const newestFirst = [...sales].sort((a, b) =>
    String(b.at ?? '').localeCompare(String(a.at ?? '')),
  );

  const kept = [];
  let size = 2;
  for (const sale of newestFirst) {
    const cost = JSON.stringify(sale).length + 1;
    if (size + cost > HISTORY_BUDGET) break;
    size += cost;
    kept.push(sale);
  }

  // Обратно по времени: журнал читается сверху вниз, от старых к новым.
  return kept.reverse();
}

const NAMES = [
  'Анна', 'Борис', 'Вера', 'Георгий', 'Дарья', 'Егор', 'Жанна', 'Зоя',
  'Иван', 'Ксения', 'Леонид', 'Марина', 'Никита', 'Ольга', 'Павел', 'Римма',
  'Сергей', 'Тамара', 'Ульяна', 'Фёдор', 'Юлия', 'Яков',
];
const SURNAMES = [
  'Авдеев', 'Белов', 'Волков', 'Гущин', 'Дроздов', 'Ершов', 'Зимин', 'Ильин',
  'Карпов', 'Лапин', 'Морозов', 'Найдёнов', 'Орлов', 'Пахомов', 'Рыжов',
  'Соколов', 'Титов', 'Устинов', 'Фомин', 'Хромов', 'Цветков', 'Чернов',
];

/**
 * Псевдослучайно, но повторяемо: одна и та же карточка получает одно и то же
 * выдуманное имя при каждой сборке. Иначе каждая пересборка выглядела бы как
 * полная смена клиентской базы.
 */
function hash(seed) {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    value ^= seed.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return Math.abs(value);
}

/**
 * В каталоге тоже есть личные данные: четырнадцать подарочных сертификатов
 * названы именем и телефоном получателя — так их завели в самом CloudShop,
 * и в выгрузку они попадают вместе с товарами. Для ссылки их надо вычистить:
 * это те же живые люди, что и в списке клиентов.
 */
const products = `${seed}/products.json`;
const productsBackup = `${seed}/products.real.json`;
const sales = `${seed}/sales.json`;
const salesBackup = `${seed}/sales.real.json`;
const photos = `${seed}/photos.json`;
const photosBackup = `${seed}/photos.real.json`;

const PHONE = /(\+?[78][\s(-]*9\d{2}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2})/g;

/** Оставляем сертификат сертификатом, убирая, на кого он выписан. */
function scrubName(name) {
  if (!PHONE.test(name)) return name;
  PHONE.lastIndex = 0;

  const sum = /(\d[\d\s]{2,})\s*(?:₽|руб)/i.exec(name);
  const number = /(?:№|#|номер)\s*(\d+)/i.exec(name);

  return [
    'Подарочный сертификат',
    number ? `№${number[1]}` : null,
    sum ? `на ${sum[1].trim()} ₽` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

// Свежая выгрузка лежит в `local/` — оттуда и берём. Если её нет (перенос
// не запускали), работаем с тем, что лежит в сборочной папке.
const source = (name) => {
  const own = `${mine}/${name}`;
  return existsSync(own) ? own : `${seed}/${name}`;
};

const realProducts = JSON.parse(readFileSync(source('products.json'), 'utf8'));
const cleanProducts = REAL ? realProducts : realProducts.map((item) => ({ ...item, n: scrubName(item.n) }));
const scrubbed = cleanProducts.filter((item, i) => item.n !== realProducts[i].n).length;

const real = JSON.parse(readFileSync(source('clients.json'), 'utf8'));

const fake = REAL ? real : real.map((client, index) => {
  const seed = hash(`${client.n ?? ''}${index}`);
  const name = NAMES[seed % NAMES.length];
  const surname = SURNAMES[(seed >> 5) % SURNAMES.length];

  return {
    ...client,
    n: `${surname} ${name}`,
    // Номера из диапазона 999 — он не выделен ни одному оператору, дозвониться
    // по такому нельзя даже случайно.
    p: `+7999${String(1000000 + (seed % 9000000))}`,
    e: null,
    b: client.b ? `0${(seed % 9) + 1}/0${(seed % 9) + 1}/199${seed % 10}` : null,
    a: null,
    d: null,
  };
});

const allSales = JSON.parse(readFileSync(source('sales.json'), 'utf8'));
const shownSales = trimHistory(allSales);

console.log(
  REAL
    ? `НАСТОЯЩИЕ данные: ${fake.length} карточек клиентов с телефонами; ` +
      `истории по ссылке — ${shownSales.length} чеков из ${allSales.length}…`
    : `Подменяю ${fake.length} карточек клиентов и ${scrubbed} названий товаров; ` +
      `истории по ссылке — ${shownSales.length} чеков из ${allSales.length}…`,
);

copyFileSync(clients, backup);
writeFileSync(clients, JSON.stringify(fake));
copyFileSync(products, productsBackup);
writeFileSync(products, JSON.stringify(cleanProducts));
copyFileSync(sales, salesBackup);
writeFileSync(sales, JSON.stringify(shownSales));

// Фотографии в сборочной папке могут быть старее свежей выгрузки.
const photosFresh = source('photos.json');
if (photosFresh !== photos) {
  copyFileSync(photos, photosBackup);
  copyFileSync(photosFresh, photos);
}

try {
  // DEMO=1 обязательно: обычная сборка приходит пустой, и показывать по
  // ссылке было бы нечего — ни таблиц, ни отчётов, ни кассы.
  execSync('npm run web:build', { cwd: root, stdio: 'inherit', env: { ...process.env, DEMO: '1' } });
  mkdirSync(`${root}/dist-demo`, { recursive: true });
  renameSync(`${root}/dist/index.html`, `${root}/dist-demo/index.html`);
  console.log('\nГотово: dist-demo/index.html');
} finally {
  // Настоящие клиенты возвращаются на место всегда, даже если сборка упала:
  // иначе следующий коммит унёс бы выдуманные имена в репозиторий.
  renameSync(backup, clients);
  renameSync(productsBackup, products);
  renameSync(salesBackup, sales);
  if (photosFresh !== photos) renameSync(photosBackup, photos);
  console.log('Настоящие данные возвращены на место.');
}
