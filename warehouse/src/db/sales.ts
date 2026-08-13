import type { SqlDriver } from './driver';
import { createMoneyDoc, SALE_ACCOUNT } from './money';
import { openShiftAnywhere } from './shifts';
import { currentStaffId } from './staff';
import { cartTotals, findStockIssues } from '../domain/cart';
import { formatQty, lineTotal } from '../domain/qty';
import type { CartLine, Id, PaymentMethod, Sale, SaleItem } from '../domain/types';

/** Магазин, к которому привязана касса открытой смены. */
function shiftLocation(db: SqlDriver, shiftId: Id | null): Id | null {
  if (shiftId === null) return null;
  const row = db.get<{ location_id: Id | null }>(
    `SELECT r.location_id FROM shifts s
     JOIN registers r ON r.id = s.register_id
     WHERE s.id = ?`,
    [shiftId],
  );
  return row?.location_id ?? null;
}

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
  /**
   * Магазин, в котором пробит чек.
   *
   * Без него движения по чеку висели бы вне магазинов, и остаток точки
   * после продажи не менялся бы: он считается по движениям этой точки.
   */
  locationId?: Id | null;
  /**
   * Покупатель чека; пусто — розничный.
   *
   * Без него чек некому приписать: карточка клиента считает покупки по своим
   * чекам, и «сколько он у нас купил» осталось бы без ответа.
   */
  customerId?: Id | null;
  /** Комментарий к продаже — то, что кассир написал в окне оплаты. */
  note?: string | null;
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
    // Магазин берём у смены, если он там есть: кассир уже выбрал кассу, и
    // спрашивать его о том же второй раз незачем.
    const locationId = input.locationId ?? shiftLocation(db, shift?.id ?? null);

    db.run(
      `INSERT INTO sales (discount, total, cost_total, payment, shift_id, location_id,
                          customer_id, note, staff_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        totals.discount,
        totals.total,
        totals.costTotal,
        input.payment ?? 'cash',
        shift?.id ?? null,
        locationId,
        input.customerId ?? null,
        input.note?.trim() || null,
        // Чек помнит, кто его пробил: без этого отчёт по сотрудникам
        // считать не из чего.
        currentStaffId(db),
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
        `INSERT INTO stock_moves (product_id, qty_delta, reason, sale_id, price, location_id, created_at)
         VALUES (?, ?, 'sale', ?, ?, ?, ?)`,
        [line.product_id, -line.qty, saleId, line.price, locationId, now],
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

    // Товар возвращается в тот же магазин, из которого ушёл: иначе остаток
    // точки после возврата не сошёлся бы с её же продажей.
    const sale = db.get<{ location_id: Id | null }>('SELECT location_id FROM sales WHERE id = ?', [
      saleId,
    ]);

    const existing = db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM stock_moves WHERE sale_id = ? AND reason = 'return'",
      [saleId],
    );
    if ((existing?.n ?? 0) > 0) throw new Error('Возврат по этому чеку уже оформлен');

    for (const item of items) {
      db.run(
        `INSERT INTO stock_moves (product_id, qty_delta, reason, sale_id, price, location_id, created_at)
         VALUES (?, ?, 'return', ?, ?, ?, ?)`,
        [item.product_id, item.qty, saleId, item.price, sale?.location_id ?? null, now],
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

/**
 * Возврат без чека — то, что открывает пункт кассы «Создать возврат».
 *
 * Отличается от `refundSale` тем, что не ссылается на прошлую продажу:
 * покупатель приходит с товаром, а чека у него нет. Такой возврат кассир
 * набирает как обычный чек и проводит — товар возвращается на склад, деньги
 * уходят из кассы.
 *
 * Сумма чека остаётся нулевой, как и у возврата по чеку: выручка не должна
 * расти от того, что товар принесли обратно. Деньги при этом уходят
 * настоящим расходным документом — иначе остаток кассы в конце смены не
 * сошёлся бы с тем, что лежит в ящике.
 */
export function createReturn(db: SqlDriver, input: SaleInput): Id {
  if (input.lines.length === 0) {
    throw new Error('Пустой возврат провести нельзя');
  }

  const now = new Date().toISOString();
  const payment = input.payment ?? 'cash';

  return db.tx(() => {
    const totals = cartTotals(input.lines, input.discount ?? 0);
    const shift = openShiftAnywhere(db);
    const locationId = input.locationId ?? shiftLocation(db, shift?.id ?? null);

    db.run(
      `INSERT INTO sales (discount, total, cost_total, payment, shift_id, location_id,
                          customer_id, note, staff_id, created_at)
       VALUES (?, 0, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [
        totals.discount,
        payment,
        shift?.id ?? null,
        locationId,
        input.customerId ?? null,
        input.note?.trim() || null,
        currentStaffId(db),
        now,
      ],
    );
    const saleId = db.lastInsertId();

    for (const line of input.lines) {
      db.run(
        `INSERT INTO sale_items (sale_id, product_id, qty, price, cost_price)
         VALUES (?, ?, ?, ?, ?)`,
        [saleId, line.product_id, line.qty, line.price, line.cost_price],
      );
      db.run(
        `INSERT INTO stock_moves (product_id, qty_delta, reason, sale_id, price, location_id, created_at)
         VALUES (?, ?, 'return', ?, ?, ?, ?)`,
        [line.product_id, line.qty, saleId, line.price, locationId, now],
      );
    }

    if (totals.total > 0) {
      createMoneyDoc(db, {
        type: 'expense',
        amount: totals.total,
        account: SALE_ACCOUNT[payment] ?? 'Касса магазина',
        category: 'Прочий расход',
        note: `Возврат по чеку №${saleId}`,
        locationId,
      });
    }

    return saleId;
  });
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
