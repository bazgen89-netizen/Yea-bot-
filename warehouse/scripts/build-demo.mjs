/**
 * Сборка без личных данных — та, которую можно показать по ссылке.
 *
 * Каталог, цены и остатки остаются настоящими: это данные магазина, и без
 * них смотреть нечего. Карточки клиентов подменяются: имя, телефон, почта,
 * день рождения и адрес — выдуманные. Ссылку можно переслать, а телефон
 * живого человека, единожды уехавший на чужой сервер, назад не вернёшь.
 *
 *   node scripts/build-demo.mjs
 *
 * Кладёт результат в dist-demo/index.html, рабочую сборку не трогает.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const clients = `${root}/src/db/seed/clients.json`;
const backup = `${root}/src/db/seed/clients.real.json`;

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
const products = `${root}/src/db/seed/products.json`;
const productsBackup = `${root}/src/db/seed/products.real.json`;

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

const realProducts = JSON.parse(readFileSync(products, 'utf8'));
const cleanProducts = realProducts.map((item) => ({ ...item, n: scrubName(item.n) }));
const scrubbed = cleanProducts.filter((item, i) => item.n !== realProducts[i].n).length;

const real = JSON.parse(readFileSync(clients, 'utf8'));

const fake = real.map((client, index) => {
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

console.log(`Подменяю ${fake.length} карточек клиентов и ${scrubbed} названий товаров…`);
copyFileSync(clients, backup);
writeFileSync(clients, JSON.stringify(fake));
copyFileSync(products, productsBackup);
writeFileSync(products, JSON.stringify(cleanProducts));

try {
  execSync('npm run web:build', { cwd: root, stdio: 'inherit' });
  mkdirSync(`${root}/dist-demo`, { recursive: true });
  renameSync(`${root}/dist/index.html`, `${root}/dist-demo/index.html`);
  console.log('\nГотово: dist-demo/index.html');
} finally {
  // Настоящие клиенты возвращаются на место всегда, даже если сборка упала:
  // иначе следующий коммит унёс бы выдуманные имена в репозиторий.
  renameSync(backup, clients);
  renameSync(productsBackup, products);
  console.log('Настоящие данные возвращены на место.');
}
