import type { Kopecks } from './money';
import { lineTotal } from './qty';
import type { CartLine } from './types';

export interface CartTotals {
  /** Сумма позиций до скидки, копейки. */
  subtotal: Kopecks;
  /** Применённая скидка, копейки (не больше subtotal). */
  discount: Kopecks;
  /** К оплате, копейки. */
  total: Kopecks;
  /** Себестоимость позиций, копейки. */
  costTotal: Kopecks;
  /** Прибыль = total - costTotal. Может быть отрицательной при большой скидке. */
  profit: Kopecks;
  /** Количество позиций (строк, не единиц). */
  lineCount: number;
}

/**
 * Считает итоги корзины. Чистая функция — вся арифметика чека проверяется тестами
 * без базы и без UI.
 *
 * Скидка задаётся суммой в копейках на весь чек и обрезается по subtotal:
 * уйти в минус по чеку нельзя.
 */
export function cartTotals(lines: CartLine[], discount: Kopecks = 0): CartTotals {
  let subtotal = 0;
  let costTotal = 0;

  for (const line of lines) {
    subtotal += lineTotal(line.price, line.qty);
    costTotal += lineTotal(line.cost_price, line.qty);
  }

  const appliedDiscount = Math.min(Math.max(discount, 0), subtotal);
  const total = subtotal - appliedDiscount;

  return {
    subtotal,
    discount: appliedDiscount,
    total,
    costTotal,
    profit: total - costTotal,
    lineCount: lines.length,
  };
}

/** Скидка процентом -> сумма в копейках. 10% от 1000,00 ₽ = 100,00 ₽. */
export function discountFromPercent(subtotal: Kopecks, percent: number): Kopecks {
  const clamped = Math.min(Math.max(percent, 0), 100);
  return Math.round((subtotal * clamped) / 100);
}

export interface CartIssue {
  product_id: number;
  name: string;
  requested: number;
  available: number;
}

/**
 * Позиции, которых не хватает на складе. Продажа в минус запрещена:
 * иначе остаток перестаёт быть пригодным для заказа поставщику.
 * Исправляется документом инвентаризации, а не продажей.
 */
export function findStockIssues(lines: CartLine[]): CartIssue[] {
  const issues: CartIssue[] = [];
  for (const line of lines) {
    if (line.qty > line.stock) {
      issues.push({
        product_id: line.product_id,
        name: line.name,
        requested: line.qty,
        available: line.stock,
      });
    }
  }
  return issues;
}

/** Добавляет товар в корзину или увеличивает количество, если он уже есть. */
export function addToCart(lines: CartLine[], line: CartLine): CartLine[] {
  const index = lines.findIndex((l) => l.product_id === line.product_id);
  if (index === -1) return [...lines, line];

  const next = [...lines];
  next[index] = { ...next[index], qty: next[index].qty + line.qty, stock: line.stock };
  return next;
}

/** Меняет количество позиции. Количество <= 0 удаляет позицию из корзины. */
export function setCartQty(lines: CartLine[], productId: number, qty: number): CartLine[] {
  if (qty <= 0) return lines.filter((l) => l.product_id !== productId);
  return lines.map((l) => (l.product_id === productId ? { ...l, qty } : l));
}
