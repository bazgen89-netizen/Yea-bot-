#!/usr/bin/env node
/**
 * Загрузка каталога из выгрузки Excel в сервер склада.
 *
 *   node scripts/import-catalog.mjs каталог.xlsx \
 *     --url http://localhost:3000 --token <токен>
 *
 * Ожидаемые колонки (порядок не важен, ищем по заголовку):
 *   Наименование, Код, Артикул, Единица измерения, Цена продажи, Скидка
 *   и любое число колонок вида «Название магазина (Остаток)».
 *
 * Колонка «Общий остаток» пропускается: она сумма остальных, и загружать её
 * значило бы удвоить количество.
 *
 * Без --token скрипт только разбирает файл и показывает, что получилось, —
 * так можно проверить разбор, ничего не записав.
 */
import { argv, exit } from 'node:process';

import XLSX from 'xlsx';

const args = parseArgs(argv.slice(2));
if (!args.file) {
  console.error('Укажите файл: node scripts/import-catalog.mjs каталог.xlsx');
  exit(1);
}

const rows = parseWorkbook(args.file);
console.log(`Разобрано позиций: ${rows.length}`);

const locations = new Set(rows.flatMap((row) => Object.keys(row.stocks ?? {})));
console.log(`Магазины: ${[...locations].join(', ') || '(нет)'}`);

console.log('\nПервые три позиции:');
for (const row of rows.slice(0, 3)) {
  console.log(' ', JSON.stringify(row));
}

if (!args.token) {
  console.log('\nТокен не задан — ничего не отправлено. Добавьте --token, чтобы загрузить.');
  exit(0);
}

const url = `${(args.url ?? 'http://localhost:3000').replace(/\/$/, '')}/api/v1/import/products`;

// Отправляем частями: один запрос на 5000 позиций упёрся бы и в размер тела,
// и в время ответа.
const CHUNK = 200;
const total = { created: 0, updated: 0, locationsCreated: 0, stockSet: 0, skipped: [] };

for (let offset = 0; offset < rows.length; offset += CHUNK) {
  const chunk = rows.slice(offset, offset + CHUNK);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${args.token}` },
    body: JSON.stringify({ rows: chunk }),
  });

  if (!response.ok) {
    console.error(`\nОшибка на позициях ${offset + 1}–${offset + chunk.length}:`);
    console.error(await response.text());
    exit(1);
  }

  const result = await response.json();
  total.created += result.created;
  total.updated += result.updated;
  total.locationsCreated += result.locationsCreated;
  total.stockSet += result.stockSet;
  total.skipped.push(...result.skipped);

  process.stdout.write(`\rЗагружено: ${Math.min(offset + CHUNK, rows.length)} из ${rows.length}`);
}

console.log('\n\nГотово.');
console.log(`  создано товаров: ${total.created}`);
console.log(`  обновлено: ${total.updated}`);
console.log(`  создано магазинов: ${total.locationsCreated}`);
console.log(`  проставлено остатков: ${total.stockSet}`);

if (total.skipped.length > 0) {
  console.log(`  пропущено строк: ${total.skipped.length}`);
  for (const item of total.skipped.slice(0, 10)) {
    console.log(`    строка ${item.row}: ${item.reason}`);
  }
}

// --- разбор файла ---------------------------------------------------------

function parseWorkbook(path) {
  const workbook = XLSX.readFile(path);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('В файле нет листов');

  // header: 1 отдаёт строки массивами — заголовки разбираем сами, потому что
  // названия колонок с остатками заранее неизвестны.
  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  const header = (table[0] ?? []).map((value) => String(value ?? '').trim());
  const column = (title) =>
    header.findIndex((name) => name.toLowerCase() === title.toLowerCase());

  const nameAt = column('Наименование');
  if (nameAt === -1) throw new Error('Не нашёл колонку «Наименование»');

  const stockColumns = header
    .map((title, index) => ({ title, index }))
    .filter(({ title }) => /\(остаток\)/i.test(title))
    // «Общий остаток» — сумма остальных колонок, брать её нельзя.
    .filter(({ title }) => !/^общий/i.test(title))
    .map(({ title, index }) => ({ index, name: title.replace(/\s*\(остаток\)\s*/i, '').trim() }));

  const codeAt = column('Код');
  const skuAt = column('Артикул');
  const unitAt = column('Единица измерения');
  const priceAt = column('Цена продажи');
  const discountAt = column('Скидка');

  const rows = [];

  for (const values of table.slice(1)) {
    const name = String(values[nameAt] ?? '').trim();
    if (!name) continue;

    const stocks = {};
    for (const { index, name: location } of stockColumns) {
      const qty = toMilli(values[index]);
      // Ноль тоже записываем: остаток «пусто» и «ноль» — разные вещи.
      if (qty !== null) stocks[location] = qty;
    }

    rows.push({
      name,
      code: text(values[codeAt]),
      sku: text(values[skuAt]),
      unit: text(values[unitAt]),
      sale_price: toKopecks(values[priceAt]) ?? 0,
      discount_bp: toBasisPoints(values[discountAt]) ?? 0,
      stocks,
    });
  }

  return rows;
}

function text(value) {
  const result = String(value ?? '').trim();
  return result === '' ? null : result;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Рубли из файла — в копейки. */
function toKopecks(value) {
  const parsed = toNumber(value);
  return parsed === null ? null : Math.round(parsed * 100);
}

/**
 * Количество — в тысячные. В выгрузке встречаются длинные дроби вида
 * −945.381889483066: округляем до грамма, точнее склад всё равно не считает.
 */
function toMilli(value) {
  const parsed = toNumber(value);
  return parsed === null ? null : Math.round(parsed * 1000);
}

/** Проценты — в сотые доли процента: 12,5 % → 1250. */
function toBasisPoints(value) {
  const parsed = toNumber(value);
  return parsed === null ? null : Math.round(parsed * 100);
}

function parseArgs(list) {
  const result = {};
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (item === '--url') result.url = list[++i];
    else if (item === '--token') result.token = list[++i];
    else if (!item.startsWith('--')) result.file = item;
  }
  return result;
}
