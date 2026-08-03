/**
 * Количество хранится в тысячных долях единицы (целые числа).
 * 1000 = 1 шт / 1 кг. Это позволяет продавать чай на вес (0,05 кг = 50)
 * и при этом не накапливать ошибку float на остатках.
 */

export type Milli = number;

export const QTY_SCALE = 1000;

/** "1,5" | "0.05" | "2" -> тысячные. Возвращает null, если не число. */
export function parseQty(input: string): Milli | null {
  const cleaned = input.replace(/[\s ]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;

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
 * Стоимость позиции: цена за единицу × количество.
 * Округление к ближайшей копейке — иначе 0,333 кг × 100 ₽ даст дробную копейку.
 */
export function lineTotal(pricePerUnit: number, qty: Milli): number {
  return Math.round((pricePerUnit * qty) / QTY_SCALE);
}
