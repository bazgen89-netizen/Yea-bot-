import type { Kopecks } from './money';

/**
 * Файл для весов.
 *
 * Пункт «Файл для весов» в меню «Действия» у нас был приглушён, и в списке
 * стояло «нужны марка и модель весов». Это оказалось отговоркой: кабинет
 * ничего не спрашивает у весов — он даёт выбрать модель из трёх и
 * выгружает таблицу с тем набором колонок, который эта модель ждёт.
 * Наборы лежат в их же собранной странице (`js/main-*.js`, раздел
 * `scales`), оттуда и взяты — колонка в колонку, вместе с порядком.
 *
 * Здесь только счёт и строки: ни React, ни базы.
 */

/** Товар в том виде, в каком его ждут весы. */
export interface ScaleProduct {
  name: string;
  /** Код товара из карточки. */
  code: string | null;
  /** PLU — номер, по которому весы находят товар. */
  plu: string | null;
  price: Kopecks;
  /** Весовой ли: у штучного весы печатают цену за штуку. */
  weighted: boolean;
  /** Срок годности, если задан. */
  expiresAt: string | null;
}

export type ScaleModel = 'massak' | 'mertech' | 'rongta';

export const SCALE_TITLE: Record<ScaleModel, string> = {
  massak: 'МАССА-К',
  mertech: 'MERTECH M-ER',
  rongta: 'RONGTA',
};

/** Что отобрать перед выгрузкой — их же два флажка. */
export interface ScaleOptions {
  /** «Скачать только весовые товары». */
  weightedOnly?: boolean;
  /** Только те, у кого проставлен PLU: без него весы товар не найдут. */
  pluOnly?: boolean;
  /**
   * Префикс штрихкода весового товара — «21» по умолчанию, как в кабинете.
   * У RONGTA он уходит в колонку «Department».
   */
  prefix?: number;
}

const HEADERS: Record<ScaleModel, string[]> = {
  massak: ['ID', 'Code', 'Name', 'Type', 'Price', 'Composition', 'Expiration', 'PLU'],
  mertech: [
    'ID',
    'Product Code',
    'PLU Code',
    'Product Name 1',
    'Product Name 2',
    'Price',
    'Label',
    'Barcode Structure',
    'Expiration Days',
    'Tare',
    'Unit Weight',
    'Production Date',
    'Product Type',
    'Barcode Prefix Type',
    'ROSTEST Code',
    'Expiration Date',
    'Category Name',
    'Composition',
    'Min Print Weight',
    'Max Print Weight',
  ],
  rongta: [
    'PLU No.',
    'Name',
    'LFCode',
    'Code',
    'Barcode Type',
    'Unit Price',
    'Weight Unit',
    'Department',
    'Tare',
    'Shelf Time',
    'Package Type',
    'Package Weight',
    'Package Tolerance',
    'Message1',
    'Message2',
    'Multi Label',
    'PCS Type',
  ],
};

/** Заголовок таблицы для выбранной модели. */
export function scaleHeader(model: ScaleModel): string[] {
  return [...HEADERS[model]];
}

/** Отбор перед выгрузкой: весовые и с PLU — по флажкам. */
export function scaleSelect(products: ScaleProduct[], options: ScaleOptions = {}): ScaleProduct[] {
  return products.filter((product) => {
    if (options.weightedOnly && !product.weighted) return false;
    if (options.pluOnly && !product.plu) return false;
    return true;
  });
}

/**
 * Строки файла для весов.
 *
 * Первая строка — заголовок, дальше по строке на товар. Номер `ID` идёт
 * подряд от единицы: весы им и различают записи, а код товара у части
 * позиций пуст.
 */
export function scaleRows(
  model: ScaleModel,
  products: ScaleProduct[],
  options: ScaleOptions = {},
): (string | number)[][] {
  const chosen = scaleSelect(products, options);
  const rows: (string | number)[][] = [scaleHeader(model)];

  chosen.forEach((product, index) => {
    rows.push(rowFor(model, product, index, options));
  });

  return rows;
}

function rowFor(
  model: ScaleModel,
  product: ScaleProduct,
  index: number,
  options: ScaleOptions,
): (string | number)[] {
  // Цена уходит рублями с копейками и обязательно с точкой: запятая
  // разорвала бы строку файла надвое, а разделитель тысяч весы не читают.
  const price = plainMoney(product.price);
  const name = product.name.replace(/,/g, '.').replace(/\n/g, ' ');

  if (model === 'massak') {
    return [
      String(index + 1),
      product.code ?? '',
      name,
      // «Type»: 0 — весовой, 1 — штучный. Так у них.
      product.weighted ? '0' : '1',
      price,
      '',
      '',
      product.plu ?? '',
    ];
  }

  if (model === 'mertech') {
    return [
      String(index + 1),
      product.code ?? '',
      // Ведущие нули PLU весы этой марки не принимают.
      (product.plu ?? '').replace(/^0+/, ''),
      // Длинное название режется надвое: на этикетке две строки.
      name.slice(0, 50),
      name.slice(50, 100),
      price,
      '',
      '',
      daysLeft(product.expiresAt),
      '',
      '',
      '',
      product.weighted ? '1' : '0',
      '',
      '',
      shortDate(product.expiresAt),
      '',
      '',
      '',
      '',
    ];
  }

  // RONGTA: цена уходит целым числом в копейках, а «Department» — это
  // префикс штрихкода весового товара из настроек компании.
  return [
    0,
    name,
    product.plu ?? '',
    product.plu ?? '',
    7,
    product.price,
    4,
    options.prefix ?? 21,
    0,
    15,
    0,
    0,
    5,
    0,
    0,
    0,
    0,
  ];
}

/** 125000 → «1250.00»: без пробелов, без запятой, ровно две цифры после точки. */
function plainMoney(kopecks: Kopecks): string {
  const negative = kopecks < 0;
  const abs = Math.abs(Math.round(kopecks));
  return `${negative ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Сколько дней осталось до конца срока годности. Нет срока — пусто. */
function daysLeft(expiresAt: string | null): string {
  if (!expiresAt) return '';

  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return '';

  const days = Math.round((end.getTime() - Date.now()) / 86_400_000);
  return String(Math.max(0, days));
}

/** «31.12.26» — так срок годности пишут весы. */
function shortDate(expiresAt: string | null): string {
  if (!expiresAt) return '';

  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${pad(date.getFullYear() % 100)}`;
}

/**
 * Готовый файл.
 *
 * У МАССА-К и MERTECH это запятая, у RONGTA — табуляция: их выгрузка
 * `.txp` разделена именно ей.
 */
export function scaleFile(
  model: ScaleModel,
  products: ScaleProduct[],
  options: ScaleOptions = {},
): { name: string; text: string; mime: string } {
  const rows = scaleRows(model, products, options);
  const tab = model === 'rongta';
  const text = rows.map((row) => row.join(tab ? '\t' : ',')).join(tab ? '\r\n' : '\n');

  return {
    name: model === 'rongta' ? 'scale.txp' : 'scale.csv',
    // Первый знак — метка кодировки: без неё весы читают кириллицу кашей.
    text: `﻿${text}`,
    mime: tab ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8',
  };
}
