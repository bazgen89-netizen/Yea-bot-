import { parseDecimal } from './money';

/**
 * Количество хранится в тысячных долях единицы (целые числа).
 * 1000 = 1 шт / 1 кг. Это позволяет продавать чай на вес (0,05 кг = 50)
 * и при этом не накапливать ошибку float на остатках.
 */

export type Milli = number;

export const QTY_SCALE = 1000;

/** "1,5" | "0.05" | "2" -> тысячные. Возвращает null, если не число. */
export function parseQty(input: string): Milli | null {
  // Разбор общий с деньгами: «692,599.300» — это и в количествах то же
  // самое число, что показывает экран, и читаться оно обязано одинаково.
  const value = parseDecimal(input);
  if (value === null) return null;

  return Math.round(value * QTY_SCALE);
}

/** 1500 -> "1,5"; 2000 -> "2"; 50 -> "0,05" */
export function formatQty(milli: Milli): string {
  const negative = milli < 0;
  const abs = Math.abs(Math.round(milli));
  const whole = Math.floor(abs / QTY_SCALE);
  const frac = abs % QTY_SCALE;

  const sign = negative ? '-' : '';
  if (frac === 0) return `${sign}${whole}`;

  const fracStr = String(frac).padStart(3, '0').replace(/0+$/, '');
  return `${sign}${whole},${fracStr}`;
}

/** 1500 -> "1,5 кг" */
export function formatQtyWithUnit(milli: Milli, unit: string): string {
  return `${formatQty(milli)} ${unit}`;
}

/**
 * 692599300 -> "692,599.300" — как в веб-кабинете.
 *
 * Та же причина, что у `formatMoneyWeb`: в кабинете количества записаны
 * по-английски и всегда с тремя знаками после точки («-692,599.300 ед.»),
 * а на телефоне — по-русски и без хвостовых нулей.
 */
export function formatQtyWeb(milli: Milli): string {
  const negative = milli < 0;
  const abs = Math.abs(Math.round(milli));
  const whole = Math.floor(abs / QTY_SCALE);
  const frac = abs % QTY_SCALE;

  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${String(frac).padStart(3, '0')}`;
}

/**
 * Стоимость позиции: цена за единицу × количество.
 * Округление к ближайшей копейке — иначе 0,333 кг × 100 ₽ даст дробную копейку.
 */
export function lineTotal(pricePerUnit: number, qty: Milli): number {
  return Math.round((pricePerUnit * qty) / QTY_SCALE);
}
