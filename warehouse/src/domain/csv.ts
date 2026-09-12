/**
 * Разбор CSV — того, что выгружают Excel, «Google Таблицы» и складские
 * программы.
 *
 * Своя реализация, а не библиотека: правил здесь немного, зато все они
 * встречаются в выгрузках живых магазинов, и важно понимать каждое.
 *
 * Что учтено:
 *   — Разделитель. Excel в русской локали пишет через точку с запятой,
 *     остальные через запятую. Он определяется по первой строке, а не
 *     задаётся: спрашивать про это пользователя бессмысленно, он не знает.
 *   — Кавычки. Внутри поля они удваиваются: «Чай ""Особый""» — это одно поле.
 *   — Переносы строк внутри поля. Название товара с абзацем — обычное дело,
 *     а наивная разбивка по строкам разорвала бы такую запись пополам.
 *   — BOM в начале файла: Excel его ставит, и без снятия первый заголовок
 *     не совпадает ни с чем.
 */

/** Определяет разделитель по первой строке: тот, что встречается чаще. */
export function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? '';
  let inQuotes = false;
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 };

  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && char in counts) counts[char]++;
  }

  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ';';
}

/** Строки таблицы: массив полей на строку, всё строками. */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const clean = text.replace(/^﻿/, '');
  const rows: string[][] = [];

  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];

    if (inQuotes) {
      if (char === '"') {
        // Удвоенная кавычка внутри поля — это одна кавычка, а не конец поля.
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      // \r\n — один конец строки, а не два.
      if (char === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  // Последняя строка без завершающего перевода.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Пустые строки в конце файла — обычное дело, и таблицей они не являются.
  return rows.filter((line) => line.some((cell) => cell.trim() !== ''));
}

/**
 * Таблица с заголовком: каждая строка становится записью «колонка → значение».
 * Заголовки приводятся к нижнему регистру без лишних пробелов, чтобы
 * «Цена продажи» и «ЦЕНА  ПРОДАЖИ» считались одним и тем же.
 */
export function parseTable(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];

  const head = rows[0].map((title) => title.trim().toLowerCase().replace(/\s+/g, ' '));

  return rows.slice(1).map((line) => {
    const record: Record<string, string> = {};
    head.forEach((title, index) => {
      if (title) record[title] = (line[index] ?? '').trim();
    });
    return record;
  });
}

/**
 * Ищет в записи первое непустое значение из перечисленных названий колонок.
 *
 * Названий несколько потому, что одна и та же колонка у разных программ
 * называется по-разному: «Наименование» и «Название», «Штрих-код» и
 * «Штрихкод». Заставлять человека переименовывать заголовки перед импортом —
 * это перекладывать на него работу, которую делает список синонимов.
 */
export function pick(record: Record<string, string>, ...names: string[]): string {
  for (const name of names) {
    const value = record[name.toLowerCase()];
    if (value?.trim()) return value.trim();
  }
  return '';
}
