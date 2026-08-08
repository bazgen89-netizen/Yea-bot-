import type { SqlDriver } from './driver';
import { openShiftAnywhere } from './shifts';
import { cartTotals, findStockIssues } from '../domain/cart';
import { formatQty, lineTotal } from '../domain/qty';
import type { CartLine, Id, PaymentMethod, Sale, SaleItem } from '../domain/types';

export class OutOfStockError extends Error {
  constructor(readonly details: { name: string; requested: number; available: number }[]) {
    const list = details
      .map((d) => `${d.name}: нужно ${formatQty(d.requested)}, есть ${formatQty(d.available)}`)
      .join('; ');
    super(`Не хватает товара — ${list}`);
    this.name = 'OutOfStockError';
  }
}

export interface SaleInput {
  lines: CartLine[];
  /** Скидка на весь чек, копейки. */
  discount?: number;
  payment?: PaymentMethod;
}

/**
 * Проводит продажу: чек, позиции и списание остатков — одной транзакцией.
 *
 * Остаток перечитывается из базы прямо здесь, а не берётся из корзины: между
 * добавлением товара в корзину и оплатой его могли списать другим документом.
 */
export function createSale(db: SqlDriver, input: SaleInput): Id {
  if (input.lines.length === 0) {
    throw new Error('Пустой чек провести нельзя');
  }

  const now = new Date().toISOString();

  return db.tx(() => {
    const verified: CartLine[] = input.lines.map((line) => ({
      ...line,
      stock: currentStock(db, line.product_id),
    }));

    const issues = findStockIssues(verified);
    if (issues.length > 0) {
      throw new OutOfStockError(issues);
    }

    const totals = cartTotals(verified, input.discount ?? 0);

    // Чек привязывается к открытой смене сам: кассир открывает смену один раз
    // за день, и заставлять его указывать её в каждом чеке — лишний повод
    // ошибиться.
    const shift = openShiftAnywhere(db);

    db.run(
      `INSERT INTO sales (discount, total, cost_total, payment, shift_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        totals.discount,
        totals.total,
        totals.costTotal,
        input.payment ?? 'cash',
        shift?.id ?? null,
        now,
      ],
    );
    const saleId = db.lastInsertId();

    for (const line of verified) {
      db.run(
        `INSERT INTO sale_items (sale_id, product_id, qty, price, cost_price)
         VALUES (?, ?, ?, ?, ?)`,
        [saleId, line.product_id, line.qty, line.price, line.cost_price],
      );
      db.run(
        `INSERT INTO stock_moves (product_id, qty_delta, reason, sale_id, price, created_at)
         VALUES (?, ?, 'sale', ?, ?, ?)`,
        [line.product_id, -line.qty, saleId, line.price, now],
      );
    }

    return saleId;
  });
}

/**
 * Возврат чека: возвращает товар на склад и помечает продажу отменённой,
 * удаляя её. Движения удалятся каскадом, поэтому вместо удаления пишем
 * компенсирующие движения — история должна остаться.
 */
export function refundSale(db: SqlDriver, saleId: Id): void {
  const now = new Date().toISOString();

  db.tx(() => {
    const items = db.all<SaleItem>('SELECT * FROM sale_items WHERE sale_id = ?', [saleId]);
    if (items.length === 0) throw new Error('Чек не найден');

    const existing = db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM stock_moves WHERE sale_id = ? AND reason = 'return'",
      [saleId],
    );
    if ((existing?.n ?? 0) > 0) throw new Error('Возврат по этому чеку уже оформлен');

    for (const item of items) {
      db.run(
        `INSERT INTO stock_moves (product_id, qty_delta, reason, sale_id, price, created_at)
         VALUES (?, ?, 'return', ?, ?, ?)`,
        [item.product_id, item.qty, saleId, item.price, now],
      );
    }

    // Обнуляем суммы чека: выручка за период не должна включать возвращённое.
    db.run('UPDATE sales SET total = 0, cost_total = 0 WHERE id = ?', [saleId]);
  });
}

export interface SaleWithItems extends Sale {
  items: (SaleItem & { name: string; unit: string })[];
  refunded: boolean;
}

export function getSale(db: SqlDriver, saleId: Id): SaleWithItems | null {
  const sale = db.get<Sale>('SELECT * FROM sales WHERE id = ?', [saleId]);
  if (!sale) return null;

  const items = db.all<SaleItem & { name: string; unit: string }>(
    `SELECT i.*, p.name, p.unit
     FROM sale_items i
     JOIN products p ON p.id = i.product_id
     WHERE i.sale_id = ?`,
    [saleId],
  );

  const refund = db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM stock_moves WHERE sale_id = ? AND reason = 'return'",
    [saleId],
  );

  return { ...sale, items, refunded: (refund?.n ?? 0) > 0 };
}

export interface SaleSummary extends Sale {
  positions: number;
  refunded: number;
}

export function listSales(db: SqlDriver, limit = 50): SaleSummary[] {
  return db.all<SaleSummary>(
    `SELECT s.*,
            (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) AS positions,
            (SELECT COUNT(*) FROM stock_moves m
              WHERE m.sale_id = s.id AND m.reason = 'return') > 0 AS refunded
     FROM sales s
     ORDER BY s.id DESC
     LIMIT ?`,
    [limit],
  );
}

/** Итог чека по позициям — для показа в списке без загрузки позиций. */
export function saleSubtotal(items: SaleItem[]): number {
  return items.reduce((sum, item) => sum + lineTotal(item.price, item.qty), 0);
}

function currentStock(db: SqlDriver, productId: Id): number {
  const row = db.get<{ stock: number }>(
    'SELECT COALESCE(SUM(qty_delta), 0) AS stock FROM stock_moves WHERE product_id = ?',
    [productId],
  );
  return row?.stock ?? 0;
}
