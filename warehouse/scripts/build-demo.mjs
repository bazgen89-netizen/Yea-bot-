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
import { gzipSync } from 'node:zlib';
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
 * Вся история — по ссылке, а не последние восемнадцать тысяч чеков.
 *
 * Страница по ссылке не может быть больше 16 МБ, а история текстом — все
 * четырнадцать: раньше она обрезалась, и открывший ссылку видел неполную
 * картину. Теперь данные не вшиваются в сборку, а кладутся рядом со
 * страницей пожатыми gzip: те же сорок пять тысяч чеков вместе с клиентами
 * и фотографиями весят меньше трёх мегабайт. Распаковывает их браузер при
 * первом запуске (`src/db/seedPack.ts`).
 */

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
const allPhotos = JSON.parse(readFileSync(source('photos.json'), 'utf8'));
const allStores = JSON.parse(readFileSync(source('stores.json'), 'utf8'));

console.log(
  REAL
    ? `НАСТОЯЩИЕ данные: ${fake.length} карточек клиентов с телефонами; ` +
      `истории по ссылке — все ${allSales.length} чеков…`
    : `Подменяю ${fake.length} карточек клиентов и ${scrubbed} названий товаров; ` +
      `истории по ссылке — все ${allSales.length} чеков…`,
);

/**
 * Пакет данных рядом со страницей.
 *
 * В сборку вместо файлов кладутся пустышки — иначе те же данные уехали бы
 * в неё дважды, в разжатом виде, и страница не влезла бы в предел размера.
 */
const packed = gzipSync(
  Buffer.from(
    JSON.stringify({
      products: cleanProducts,
      clients: fake,
      sales: allSales,
      photos: allPhotos,
      stores: allStores,
    }),
  ),
  { level: 9 },
).toString('base64');

console.log(`Пакет данных: ${(packed.length / 1024 / 1024).toFixed(1)} МБ в base64.`);

// Вместо данных в сборку кладутся пустышки: те же данные внутри неё,
// разжатые, весили бы больше самой страницы, а нужны они ровно один раз —
// при первом наполнении базы. Порядок важен: сперва отложить настоящий
// файл, потом писать пустышку, иначе отложится сама пустышка.
const STUBS = [
  [clients, backup, '[]'],
  [products, productsBackup, '[]'],
  [sales, salesBackup, '[]'],
  [photos, photosBackup, '{}'],
];

for (const [file, saved, stub] of STUBS) {
  copyFileSync(file, saved);
  writeFileSync(file, stub);
}

try {
  // DEMO=1 обязательно: обычная сборка приходит пустой, и показывать по
  // ссылке было бы нечего — ни таблиц, ни отчётов, ни кассы.
  execSync('npm run web:build', { cwd: root, stdio: 'inherit', env: { ...process.env, DEMO: '1' } });
  mkdirSync(`${root}/dist-demo`, { recursive: true });

  // Пакет вписывается в самое начало страницы: распаковка идёт при первом
  // запуске, до наполнения базы, и к этому времени он должен быть на месте.
  let page = readFileSync(`${root}/dist/index.html`, 'utf8');
  const tag = `<script>globalThis.__SEED_GZ__=${JSON.stringify(packed)}</script>`;
  const head = page.indexOf('</head>');
  if (head < 0) throw new Error('В сборке нет </head> — некуда положить данные.');
  page = page.slice(0, head) + tag + page.slice(head);
  writeFileSync(`${root}/dist-demo/index.html`, page);

  const mb = (Buffer.byteLength(page) / 1024 / 1024).toFixed(1);
  console.log(`\nГотово: dist-demo/index.html — ${mb} МБ, ${allSales.length} чеков.`);
} finally {
  // Настоящие данные возвращаются на место всегда, даже если сборка упала:
  // иначе следующий коммит унёс бы в репозиторий пустышки и выдуманные имена.
  for (const [file, saved] of STUBS) renameSync(saved, file);
  console.log('Настоящие данные возвращены на место.');
}
