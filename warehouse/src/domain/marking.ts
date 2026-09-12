/**
 * Товарные группы «Честного знака» и системы налогообложения.
 *
 * Списки не придуманы: это `data/marking-types-ru.json` и
 * `data/ru_tax_system.json` исходного приложения — те самые файлы, которые
 * оно само подгружает в выпадающие списки карточки товара. Коды взяты как
 * есть, потому что по ним товар опознаёт касса и ОФД: «01» — обувь всегда и
 * везде, как бы группу ни назвали в интерфейсе.
 *
 * Две группы с пометкой «Эвотор» — их собственные: у обычной маркировки
 * алкоголя кода нет, а Эвотор требует различать маркированный и
 * немаркированный. Оставлены, чтобы товар, заведённый там, не потерял
 * значение при переносе сюда.
 */

export interface CodeName {
  code: string;
  name: string;
}

export const MARKING_TYPES: CodeName[] = [
  { code: '01', name: 'Обувь' },
  { code: '02', name: 'Изделия из меха' },
  { code: '03', name: 'Лекарственные препараты' },
  { code: '04', name: 'Табачная продукция' },
  { code: '20', name: 'Электронные сигареты' },
  { code: '21', name: 'Альтернативная табачная продукция' },
  { code: '22', name: 'Никотиносодержащая продукция' },
  { code: '05', name: 'Фотоаппаратура' },
  { code: '06', name: 'Парфюмерия' },
  { code: '07', name: 'Шины' },
  { code: '08', name: 'Одежда' },
  { code: '19', name: 'Текстиль для дома' },
  { code: '09', name: 'Маркированный алкоголь (Эвотор)' },
  { code: '10', name: 'Немаркированный алкоголь (Эвотор)' },
  { code: '12', name: 'Молочная продукция' },
  { code: '13', name: 'Упакованная вода' },
  { code: '14', name: 'Пиво и слабоалкогольные напитки' },
  { code: '23', name: 'Безалкогольные напитки' },
  { code: '15', name: 'Велосипеды' },
  { code: '16', name: 'БАД' },
  { code: '17', name: 'Антисептики' },
  { code: '18', name: 'Кресла-коляски' },
  { code: '24', name: 'Медицинские изделия' },
  { code: '25', name: 'Корма для животных' },
  { code: '26', name: 'Растительные масла' },
  { code: '27', name: 'Икра' },
  { code: '28', name: 'Консервы' },
  { code: '29', name: 'Косметика и бытовая химия' },
  { code: '30', name: 'Бакалейная продукция' },
  { code: '31', name: 'Детские игрушки' },
  { code: '32', name: 'Сладости, кондитерские изделия' },
  { code: '33', name: 'Строительные материалы' },
  { code: '34', name: 'Моторные масла' },
  { code: '35', name: 'Спортивное питание' },
  { code: '36', name: 'Растворимые завариваемые напитки' },
];

export const TAX_SYSTEMS: CodeName[] = [
  { code: '01', name: 'ЕСХН' },
  { code: '02', name: 'ОСНО' },
  { code: '03', name: 'ПСН' },
  { code: '04', name: 'УСН Доход' },
  { code: '05', name: 'УСН Доход - Расход' },
];

/** Название по коду. Неизвестный код показывается самим кодом, а не пропадает. */
export function nameByCode(list: CodeName[], code: string | null): string {
  if (!code) return '';
  return list.find((item) => item.code === code)?.name ?? code;
}

/**
 * GTIN из штрихкода — то же, что делает кнопка «Получить из штрих-кода».
 *
 * GTIN-14 — это штрихкод, дополненный нулями слева до четырнадцати знаков.
 * Годятся только цифровые коды длиной 8, 12, 13 или 14: остальное — либо
 * внутренний код магазина, либо опечатка, и превращать его в GTIN нельзя.
 */
export function gtinFromBarcode(barcode: string): string | null {
  const digits = barcode.trim();
  if (!/^\d+$/.test(digits)) return null;
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  return digits.padStart(14, '0');
}

/**
 * Штрихкод из кода товара — кнопка «Сгенерировать».
 *
 * Собирается внутренний EAN-13 с префиксом 2: этот диапазон выделен под коды
 * магазина и не пересекается с кодами производителей. Двенадцать знаков —
 * префикс и код, тринадцатый — контрольная сумма.
 */
export function barcodeFromCode(code: string): string | null {
  const digits = code.replace(/\D/g, '');
  if (!digits) return null;

  const body = `2${digits.slice(-11).padStart(11, '0')}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  }

  return body + String((10 - (sum % 10)) % 10);
}

/** Что удалось прочитать в коде маркировки. */
export interface Marking {
  /** Код товара по GS1 — четырнадцать цифр. */
  gtin: string | null;
  /** Серийный номер экземпляра: он у каждой пачки свой. */
  serial: string | null;
  /** Криптохвост — проверочный код Честного знака. */
  check: string | null;
}

/**
 * Разбор кода маркировки — того, что печатают квадратиком DataMatrix.
 *
 * Внутри не одна строка, а несколько полей подряд, каждое со своим номером:
 * `01` — код товара, `21` — серийный номер, `91`–`93` — проверочный код.
 * Разделяются они невидимым знаком GS (U+001D); сканер отдаёт его как есть.
 *
 * Разбираем ровно те поля, которые показывает диагностика оборудования: по
 * коду товара видно, что за товар, по серийному — что пачка не повторяется.
 * Остальные поля пропускаем: угадывать их длину без справочника нельзя.
 */
export function parseMarking(code: string): Marking {
  const clean = code.trim();
  const result: Marking = { gtin: null, serial: null, check: null };
  if (!clean) return result;

  const GS = '\u001d';
  // Поля с заранее известной длиной: их сканер не отделяет разделителем,
  // они просто идут подряд. Остальные тянутся до GS или до конца строки.
  const FIXED: Record<string, number> = { '01': 14, '11': 6, '13': 6, '17': 6, '7003': 10 };

  let at = 0;
  while (at < clean.length) {
    if (clean[at] === GS) {
      at++;
      continue;
    }

    const ai = clean.slice(at, at + 2);
    if (!/^\d{2}$/.test(ai)) break;

    at += 2;
    const fixed = FIXED[ai];
    let value: string;

    if (fixed) {
      value = clean.slice(at, at + fixed);
      at += fixed;
    } else {
      const end = clean.indexOf(GS, at);
      value = clean.slice(at, end === -1 ? undefined : end);
      at = end === -1 ? clean.length : end;
    }

    if (ai === '01' && /^\d{14}$/.test(value)) result.gtin = value;
    if (ai === '21') result.serial = value.slice(0, 20);
    if (ai === '91' || ai === '92' || ai === '93') result.check = value.slice(0, 88);
  }

  return result;
}
