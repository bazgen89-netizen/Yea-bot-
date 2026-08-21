import type { SqlDriver } from './driver';
import { createMoneyDoc, SALE_ACCOUNT } from './money';
import { openShiftAnywhere } from './shifts';
import { currentStaffId } from './staff';
import { cartTotals, findStockIssues } from '../domain/cart';
import { formatQty, lineTotal } from '../domain/qty';
import type { Kopecks } from '../domain/money';
import type { CartLine, Id, PaymentMethod, Sale, SaleItem } from '../domain/types';

/**
 * Следующий номер чека — на единицу больше самого большого.
 *
 * Своя нумерация продолжается с того места, где её оставил CloudShop.
 * Внутренний номер строки для этого не годится: перенесённых чеков сорок пять
 * тысяч, а строк в таблице ровно столько же, и новый чек получал номер из
 * середины — «Продажа #41766» при последней проданной «#45868». Такой номер
 * не найти в кабинете и не назвать покупателю: он уже занят чеком трёхлетней
 * давности.
 *
 * На пустой базе нумерация начинается с единицы — как и должна.
 */
function nextNumber(db: SqlDriver): number {
  const row = db.get<{ top: number | null }>('SELECT MAX(number) AS top FROM sales');
  return (row?.top ?? 0) + 1;
}

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
  /**
   * Сколько из чека приняли отсрочкой, копейки.
   *
   * Это долг покупателя: товар отдали, деньги не взяли. Отсрочку нельзя дать
   * розничному — долг некому записать, — и нельзя дать больше, чем в чеке.
   */
  debt?: Kopecks;
  /**
   * Провести чек, даже если товара на складе меньше, чем в нём.
   *
   * Решает не касса, а настройка компании «Разрешить продажу в минус»: сюда
   * приходит уже готовый ответ. Остаток при этом уходит в минус — он считается
   * по движениям, и отрицательное значение честно говорит, что товар отдали,
   * а прихода на него нет.
   */
  allowNegative?: boolean;
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

    if (!input.allowNegative) {
      const issues = findStockIssues(verified);
      if (issues.length > 0) {
        throw new OutOfStockError(issues);
      }
    }

    const totals = cartTotals(verified, input.discount ?? 0);

    // Чек привязывается к открытой смене сам: кассир открывает смену один раз
    // за день, и заставлять его указывать её в каждом чеке — лишний повод
    // ошибиться.
    const shift = openShiftAnywhere(db);
    // Магазин берём у смены, если он там есть: кассир уже выбрал кассу, и
    // спрашивать его о том же второй раз незачем.
    const locationId = input.locationId ?? shiftLocation(db, shift?.id ?? null);

    // Долг без покупателя записать некуда, поэтому его и не бывает: розничный
    // ушёл — спросить не с кого.
    const debt = input.customerId ? Math.min(Math.max(0, input.debt ?? 0), totals.total) : 0;

    db.run(
      `INSERT INTO sales (discount, total, cost_total, payment, shift_id, location_id,
                          customer_id, note, debt, staff_id, created_at, number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        totals.discount,
        totals.total,
        totals.costTotal,
        input.payment ?? 'cash',
        shift?.id ?? null,
        locationId,
        input.customerId ?? null,
        input.note?.trim() || null,
        debt,
        // Чек помнит, кто его пробил: без этого отчёт по сотрудникам
        // считать не из чего.
        currentStaffId(db),
        now,
        nextNumber(db),
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
  items: (SaleItem & {
    name: string;
    unit: string;
    sku: string | null;
    barcode: string | null;
  })[];
  refunded: boolean;
  /** Чем чек подписан в просмотре документа. */
  store: string | null;
  customer: string | null;
  register: string | null;
  shift_number: number | null;
}

export function getSale(db: SqlDriver, saleId: Id): SaleWithItems | null {
  // Вместе с чеком тянем то, чем он подписан в просмотре документа: магазин,
  // покупателя, кассу и смену. Отдельными запросами это были бы четыре
  // похода в базу за четырьмя строчками.
  const sale = db.get<Sale & {
    store: string | null;
    customer: string | null;
    register: string | null;
    shift_number: number | null;
  }>(
    `SELECT s.*,
            (SELECT l.name FROM locations l WHERE l.id = s.location_id)      AS store,
            (SELECT c.name FROM counterparties c WHERE c.id = s.customer_id) AS customer,
            (SELECT r.name FROM registers r
               JOIN shifts h ON h.register_id = r.id WHERE h.id = s.shift_id) AS register,
            s.shift_id                                                        AS shift_number
       FROM sales s
      WHERE s.id = ?`,
    [saleId],
  );
  if (!sale) return null;

  const items = db.all<SaleItem & { name: string; unit: string; sku: string | null; barcode: string | null }>(
    `SELECT i.*, p.name, p.unit, p.sku, p.barcode
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
                          customer_id, note, staff_id, created_at, number)
       VALUES (?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        totals.discount,
        payment,
        shift?.id ?? null,
        locationId,
        input.customerId ?? null,
        input.note?.trim() || null,
        currentStaffId(db),
        now,
        nextNumber(db),
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
