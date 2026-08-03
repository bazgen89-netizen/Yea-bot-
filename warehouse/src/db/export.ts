import type { SqlDriver } from './driver';
import { listProducts } from './products';
import { formatMoney } from '../domain/money';
import { formatQty } from '../domain/qty';

/**
 * Экранирование по RFC 4180: поле в кавычках, внутренние кавычки удваиваются.
 * Без этого название товара с запятой разъедет таблицу.
 */
function csvCell(value: string | number | null): string {
  const raw = value == null ? '' : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function toCsv(rows: (string | number | null)[][]): string {
  // BOM — иначе Excel открывает кириллицу как «ÐÐ°Ð·Ð²Ð°Ð½Ð¸Ðµ».
  return '﻿' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
}

/** Выгрузка остатков: то, что чаще всего нужно отправить бухгалтеру или поставщику. */
export function stockCsv(db: SqlDriver): string {
  const products = listProducts(db, { includeArchived: false });

  const rows: (string | number | null)[][] = [
    [
      'Название',
      'Категория',
      'Артикул',
      'Штрихкод',
      'Единица',
      'Остаток',
      'Закупочная цена',
      'Цена продажи',
      'Стоимость остатка',
    ],
  ];

  for (const p of products) {
    rows.push([
      p.name,
      p.category_name,
      p.sku,
      p.barcode,
      p.unit,
      formatQty(p.stock),
      formatMoney(p.cost_price),
      formatMoney(p.sale_price),
      formatMoney(Math.round((p.stock * p.cost_price) / 1000)),
    ]);
  }

  return toCsv(rows);
}
