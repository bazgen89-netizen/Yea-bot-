/**
 * Сборка со своими данными — той выгрузкой, что лежит рядом и не в git.
 *
 *   node scripts/build-mine.mjs
 *
 * Зачем отдельная команда. Перенос из CloudShop кладёт настоящую выгрузку в
 * `src/db/seed/local/` — папку, которую git не видит. Так и должно быть:
 * там три тысячи телефонов, дни рождения и бонусные счета живых людей, а
 * данные, единожды попавшие в историю репозитория, из неё уже не убрать —
 * только переписав историю целиком.
 *
 * Собирает же программа то, что лежит в `src/db/seed/`. Поэтому здесь файлы
 * подменяются на время сборки и возвращаются на место сразу после. Возврат
 * идёт в `finally`: если сборка упадёт на середине, личные данные всё равно
 * не останутся лежать там, откуда их случайно закоммитят.
 *
 * Данные едут не внутри сборки, а рядом с ней — пожатыми gzip. Сорок пять
 * тысяч чеков текстом весят четырнадцать мегабайт, и файл выходил под
 * тридцать: на телефоне такой открывается долго, а по почте не отправляется
 * вовсе. Пожатые — меньше трёх, и это те же самые данные до последнего чека.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seed = `${root}/src/db/seed`;
const mine = `${seed}/local`;

/** Что подменяем и чем оно становится в сборке: пустышкой того же вида. */
const FILES = {
  'products.json': '[]',
  'clients.json': '[]',
  'sales.json': '[]',
  'docs.json': '[]',
  'photos.json': '{}',
  'stores.json': '[]',
};

const present = Object.keys(FILES).filter((file) => existsSync(`${mine}/${file}`));

if (present.length === 0) {
  console.error(`Своей выгрузки нет: ${mine.replace(root + '/', '')} пуст.`);
  console.error('Сначала перенос: CLOUDSHOP_TOKEN=… node scripts/import-cloudshop.mjs');
  process.exit(1);
}

/** Своё, если есть; иначе то, что лежит в сборочной папке. */
const read = (file) => {
  const own = `${mine}/${file}`;
  const path = existsSync(own) ? own : `${seed}/${file}`;
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
};

const bundle = {
  products: read('products.json') ?? [],
  clients: read('clients.json') ?? [],
  sales: read('sales.json') ?? [],
  // Складские документы: закупки и возвраты поставщику.
  docs: read('docs.json') ?? [],
  photos: read('photos.json') ?? {},
  stores: read('stores.json') ?? [],
};

const packed = gzipSync(Buffer.from(JSON.stringify(bundle)), { level: 9 }).toString('base64');

console.log(
  `Своя выгрузка: ${bundle.products.length} товаров, ${bundle.clients.length} клиентов, ` +
    `${bundle.sales.length} чеков — ${(packed.length / 1024 / 1024).toFixed(1)} МБ пожатыми.`,
);

// Что было в сборочной папке — откладываем целиком, а не «запоминаем имена»:
// вернуть надо и содержимое, и его отсутствие.
const stashed = [];

try {
  for (const file of Object.keys(FILES)) {
    const target = `${seed}/${file}`;

    if (existsSync(target)) {
      renameSync(target, `${target}.was`);
      stashed.push({ target, kept: true });
    } else {
      stashed.push({ target, kept: false });
    }

    // В сборку едет пустышка: те же данные внутри неё, разжатые, весили бы
    // больше самой сборки, а нужны они только один раз — при наполнении.
    writeFileSync(target, FILES[file]);
  }

  execSync('npm run web:build', { cwd: root, stdio: 'inherit', env: { ...process.env, SEED: '1' } });

  const file = `${root}/dist/index.html`;
  let page = readFileSync(file, 'utf8');
  const head = page.indexOf('</head>');
  if (head < 0) throw new Error('В сборке нет </head> — некуда положить данные.');

  page =
    page.slice(0, head) +
    `<script>globalThis.__SEED_GZ__=${JSON.stringify(packed)}</script>` +
    page.slice(head);
  writeFileSync(file, page);

  console.log(`\nГотово: dist/index.html — ${(Buffer.byteLength(page) / 1024 / 1024).toFixed(1)} МБ.`);
} finally {
  for (const { target, kept } of stashed) {
    rmSync(target, { force: true });
    if (kept) renameSync(`${target}.was`, target);
  }
  console.log('Сборочная папка возвращена к тому, что лежит в git.');
}

console.log(`
В файле — свои товары, клиенты и вся история покупок. Его никуда не
выкладывают: там настоящие телефоны. Для ссылки — node scripts/build-demo.mjs.`);
