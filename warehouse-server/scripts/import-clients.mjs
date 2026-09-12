#!/usr/bin/env node
/**
 * Загрузка клиентской базы из выгрузки Excel в сервер склада.
 *
 *   node scripts/import-clients.mjs клиенты.xlsx \
 *     --url http://localhost:3000 --token <токен>
 *
 * Колонки ищутся по заголовку, порядок не важен. Понимаются любые из названий:
 *   имя         — Наименование, Имя, ФИО, Клиент, Контрагент, Название
 *   телефон     — Телефон, Номер телефона, Моб. телефон, Мобильный
 *   почта       — Email, E-mail, Почта, Электронная почта
 *   заметка     — Комментарий, Примечание, Заметка, Описание
 *   тип         — Тип (значения «поставщик» / «клиент»); нет колонки — все клиенты.
 *
 * Без --token скрипт только разбирает файл и показывает, что получилось, —
 * так можно проверить разбор, ничего не записав.
 */
import { argv, exit } from 'node:process';

import XLSX from 'xlsx';

const NAME_TITLES = ['наименование', 'имя', 'фио', 'клиент', 'контрагент', 'название', 'покупатель'];
const PHONE_TITLES = ['телефон', 'номер телефона', 'моб. телефон', 'мобильный', 'тел.', 'тел'];
const EMAIL_TITLES = ['email', 'e-mail', 'почта', 'электронная почта'];
const NOTE_TITLES = ['комментарий', 'примечание', 'заметка', 'описание'];
const KIND_TITLES = ['тип', 'вид', 'категория'];

const args = parseArgs(argv.slice(2));
if (!args.file) {
  console.error('Укажите файл: node scripts/import-clients.mjs клиенты.xlsx');
  exit(1);
}

const { rows, columns } = parseWorkbook(args.file, args.kind);
console.log(`Разобрано записей: ${rows.length}`);
console.log(`Колонки: ${JSON.stringify(columns)}`);

const withPhone = rows.filter((row) => row.phone).length;
console.log(`С телефоном: ${withPhone}, без телефона: ${rows.length - withPhone}`);

console.log('\nПервые три записи:');
for (const row of rows.slice(0, 3)) {
  console.log(' ', JSON.stringify(row));
}

if (!args.token) {
  console.log('\nТокен не задан — ничего не отправлено. Добавьте --token, чтобы загрузить.');
  exit(0);
}

const url = `${(args.url ?? 'http://localhost:3000').replace(/\/$/, '')}/api/v1/import/counterparties`;

// Отправляем частями: несколько тысяч записей одним запросом упёрлись бы
// и в размер тела, и во время ответа.
const CHUNK = 500;
const total = { created: 0, updated: 0, skipped: [] };

for (let offset = 0; offset < rows.length; offset += CHUNK) {
  const chunk = rows.slice(offset, offset + CHUNK);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${args.token}` },
    body: JSON.stringify({ rows: chunk }),
  });

  if (!response.ok) {
    console.error(`\nОшибка на записях ${offset + 1}–${offset + chunk.length}:`);
    console.error(await response.text());
    exit(1);
  }

  const result = await response.json();
  total.created += result.created;
  total.updated += result.updated;
  total.skipped.push(...result.skipped);

  process.stdout.write(`\rЗагружено: ${Math.min(offset + CHUNK, rows.length)} из ${rows.length}`);
}

console.log('\n\nГотово.');
console.log(`  заведено карточек: ${total.created}`);
console.log(`  обновлено: ${total.updated}`);

if (total.skipped.length > 0) {
  console.log(`  пропущено строк: ${total.skipped.length}`);
  for (const item of total.skipped.slice(0, 10)) {
    console.log(`    строка ${item.row}: ${item.reason}`);
  }
}

// --- разбор файла ---------------------------------------------------------

function parseWorkbook(path, forcedKind) {
  const workbook = XLSX.readFile(path);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('В файле нет листов');

  const table = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  const header = (table[0] ?? []).map((value) => String(value ?? '').trim().toLowerCase());

  const nameAt = find(header, NAME_TITLES);
  if (nameAt === -1) {
    throw new Error(`Не нашёл колонку с именем. Заголовки в файле: ${header.join(' | ')}`);
  }

  const phoneAt = find(header, PHONE_TITLES);
  const emailAt = find(header, EMAIL_TITLES);
  const noteAt = find(header, NOTE_TITLES);
  const kindAt = find(header, KIND_TITLES);

  const rows = [];

  for (const values of table.slice(1)) {
    const name = String(values[nameAt] ?? '').trim();
    if (!name) continue;

    rows.push({
      name,
      kind: forcedKind ?? kindFrom(values[kindAt]),
      phone: text(values[phoneAt]),
      email: text(values[emailAt]),
      note: text(values[noteAt]),
    });
  }

  return {
    rows,
    columns: {
      имя: header[nameAt],
      телефон: header[phoneAt] ?? null,
      почта: header[emailAt] ?? null,
      заметка: header[noteAt] ?? null,
      тип: header[kindAt] ?? null,
    },
  };
}

/** Ищем колонку сначала по точному названию, потом по вхождению. */
function find(header, titles) {
  const exact = header.findIndex((title) => titles.includes(title));
  if (exact !== -1) return exact;
  return header.findIndex((title) => title && titles.some((want) => title.includes(want)));
}

function kindFrom(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw.includes('постав')) return 'supplier';
  return 'customer';
}

function text(value) {
  if (value === undefined) return null;
  // Телефоны из Excel иногда приходят числами — теряется плюс, но цифры целы.
  const result = String(value ?? '').trim();
  return result === '' ? null : result;
}

function parseArgs(list) {
  const result = {};
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (item === '--url') result.url = list[++i];
    else if (item === '--token') result.token = list[++i];
    // Файл целиком с поставщиками: --kind supplier.
    else if (item === '--kind') result.kind = list[++i];
    else if (!item.startsWith('--')) result.file = item;
  }
  return result;
}
