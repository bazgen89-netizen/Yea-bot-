/**
 * Арифметика денег и количеств. Повторяет warehouse/src/domain — так и должно
 * быть: сервер обязан считать чек ровно так же, как телефон, иначе после
 * синхронизации итоги разойдутся.
 *
 * Деньги — целые копейки, количества — целые тысячные (1000 = 1 шт/кг).
 */

export const QTY_SCALE = 1000;

/** Стоимость позиции: цена за единицу × количество, с округлением до копейки. */
export function lineTotal(pricePerUnit: number, qty: number): number {
  return Math.round((pricePerUnit * qty) / QTY_SCALE);
}

export interface SaleLineInput {
  product_id: string;
  qty: number;
  price: number;
  cost_price: number;
}

export interface Totals {
  subtotal: number;
  discount: number;
  total: number;
  costTotal: number;
  profit: number;
}

/** Итоги чека. Скидка обрезается по сумме: уйти в минус по чеку нельзя. */
export function saleTotals(lines: SaleLineInput[], discount = 0): Totals {
  let subtotal = 0;
  let costTotal = 0;

  for (const line of lines) {
    subtotal += lineTotal(line.price, line.qty);
    costTotal += lineTotal(line.cost_price, line.qty);
  }

  const applied = Math.min(Math.max(discount, 0), subtotal);
  const total = subtotal - applied;

  return { subtotal, discount: applied, total, costTotal, profit: total - costTotal };
}
