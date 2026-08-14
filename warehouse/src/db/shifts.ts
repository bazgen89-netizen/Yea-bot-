import type { SqlDriver } from './driver';
import type { Kopecks } from '../domain/money';
import type { Id } from '../domain/types';

/**
 * Кассы и смены.
 *
 * Смена — это отрезок времени, за который касса отвечает деньгами. Всё, что
 * она показывает, считается из чеков и денежных документов этой смены, а не
 * копится отдельными счётчиками: счётчик, который увеличивают при продаже,
 * невозможно объяснить, если он разошёлся с чеками.
 */

export interface Register {
  id: Id;
  name: string;
  location_id: Id | null;
  archived: number;
  created_at: string;
}

export interface RegisterWithState extends Register {
  /** Кассиры, работавшие на этой кассе, через запятую. */
  cashiers: string | null;
  /** Наличные на начало открытой смены, копейки; 0 — смены нет. */
  opening_cash: Kopecks;
  location_name: string | null;
  /** Номер открытой смены или null. */
  open_shift_id: Id | null;
  opened_at: string | null;
}

export function listRegisters(db: SqlDriver): RegisterWithState[] {
  return db.all<RegisterWithState>(
    `SELECT r.*,
            (SELECT l.name FROM locations l WHERE l.id = r.location_id) AS location_name,
            s.id        AS open_shift_id,
            s.opened_at AS opened_at,
            -- Кассиры кассы — те, кто на ней уже работал: отдельной привязки
            -- сотрудника к кассе у нас нет, а список из смен — настоящий.
            (SELECT GROUP_CONCAT(DISTINCT h.cashier) FROM shifts h
              WHERE h.register_id = r.id AND h.cashier IS NOT NULL) AS cashiers,
            -- Сколько денег в ящике: наличные открытой смены на сейчас.
            COALESCE(s.opening_cash, 0) AS opening_cash
     FROM registers r
     LEFT JOIN shifts s ON s.register_id = r.id AND s.closed_at IS NULL
     WHERE r.archived = 0
     ORDER BY r.id`,
  );
}

/** Возвращает id кассы, заводя её при необходимости. */
export function ensureRegister(db: SqlDriver, name: string, locationId: Id | null = null): Id {
  const existing = db.get<Register>('SELECT * FROM registers WHERE name = ?', [name.trim()]);
  if (existing) return existing.id;

  db.run('INSERT INTO registers (name, location_id, created_at) VALUES (?, ?, ?)', [
    name.trim(),
    locationId,
    new Date().toISOString(),
  ]);
  return db.lastInsertId();
}

export interface Shift {
  id: Id;
  register_id: Id;
  opened_at: string;
  closed_at: string | null;
  opening_cash: Kopecks;
  closing_cash: Kopecks | null;
  cashier: string | null;
  created_at: string;
}

/** Открытая смена этой кассы или null. */
export function currentShift(db: SqlDriver, registerId: Id): Shift | null {
  return db.get<Shift>(
    'SELECT * FROM shifts WHERE register_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1',
    [registerId],
  );
}

/** Любая открытая смена — то, в чём копятся пробиваемые сейчас чеки. */
export function openShiftAnywhere(db: SqlDriver): Shift | null {
  return db.get<Shift>('SELECT * FROM shifts WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1');
}

export function openShift(
  db: SqlDriver,
  input: { registerId: Id; openingCash?: Kopecks; cashier?: string | null },
): Id {
  if (currentShift(db, input.registerId)) {
    throw new Error('Смена на этой кассе уже открыта');
  }

  const now = new Date().toISOString();
  db.run(
    `INSERT INTO shifts (register_id, opened_at, opening_cash, cashier, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [input.registerId, now, input.openingCash ?? 0, input.cashier?.trim() || null, now],
  );
  return db.lastInsertId();
}

/**
 * Закрывает смену пересчитанной наличностью.
 *
 * Расхождение не исправляется и не прячется: оно и есть главный результат
 * закрытия — деньги в ящике либо сошлись с чеками, либо нет.
 */
export function closeShift(db: SqlDriver, shiftId: Id, countedCash: Kopecks): ShiftReport {
  const shift = db.get<Shift>('SELECT * FROM shifts WHERE id = ?', [shiftId]);
  if (!shift) throw new Error('Смена не найдена');
  if (shift.closed_at) throw new Error('Смена уже закрыта');

  db.run('UPDATE shifts SET closed_at = ?, closing_cash = ? WHERE id = ?', [
    new Date().toISOString(),
    countedCash,
    shiftId,
  ]);

  return shiftReport(db, shiftId);
}

/**
 * Итоги смены. Пока смена открыта — это X-отчёт, после закрытия — Z-отчёт:
 * считаются они одинаково, различие только в том, окончательные ли числа.
 */
export interface ShiftReport {
  shift: Shift;
  register_name: string;
  location_name: string | null;
  /** Выручка за смену, копейки. */
  revenue: Kopecks;
  cash: Kopecks;
  card: Kopecks;
  transfer: Kopecks;
  receipts: number;
  /** Сколько чеков этой смены вернули. */
  returns: number;
  /** Сумма возвращённого, копейки. */
  returnsSum: Kopecks;
  /** Внесения и изъятия деньгами за смену, копейки. */
  moneyIn: Kopecks;
  moneyOut: Kopecks;
  /** Сколько наличных должно быть в ящике, копейки. */
  expectedCash: Kopecks;
  /** Пересчитано минус ожидаемое; null, пока смена открыта. */
  difference: Kopecks | null;
}

export function shiftReport(db: SqlDriver, shiftId: Id): ShiftReport {
  const shift = db.get<Shift>('SELECT * FROM shifts WHERE id = ?', [shiftId]);
  if (!shift) throw new Error('Смена не найдена');

  const register = db.get<{ name: string; location_name: string | null }>(
    `SELECT r.name, (SELECT l.name FROM locations l WHERE l.id = r.location_id) AS location_name
     FROM registers r WHERE r.id = ?`,
    [shift.register_id],
  );

  const sales = db.get<{
    revenue: number;
    cash: number;
    card: number;
    transfer: number;
    receipts: number;
  }>(
    // Выручка — вся сумма чеков, включая отсроченную: товар продан. А вот
    // в ящик и на терминал попадает только то, что реально взяли, поэтому
    // из способов оплаты отсрочка вычитается.
    `SELECT COALESCE(SUM(total), 0) AS revenue,
            COALESCE(SUM(CASE WHEN payment = 'cash'     THEN total - debt END), 0) AS cash,
            COALESCE(SUM(CASE WHEN payment = 'card'     THEN total - debt END), 0) AS card,
            COALESCE(SUM(CASE WHEN payment = 'transfer' THEN total - debt END), 0) AS transfer,
            COUNT(*) AS receipts
     FROM sales s
     WHERE s.shift_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM stock_moves m WHERE m.sale_id = s.id AND m.reason = 'return'
       )`,
    [shiftId],
  );

  // Возвраты считаются по движениям, а не по чекам: при возврате суммы чека
  // обнуляются, чтобы выручка за период не включала возвращённое. Само же
  // возвращённое никуда не девается, и в смене его надо показать.
  const returns = db.get<{ count: number; sum: number }>(
    `SELECT COUNT(DISTINCT m.sale_id) AS count,
            COALESCE(SUM(CAST(ROUND(m.qty_delta * m.price / 1000.0) AS INTEGER)), 0) AS sum
     FROM stock_moves m
     JOIN sales s ON s.id = m.sale_id
     WHERE m.reason = 'return' AND s.shift_id = ?`,
    [shiftId],
  );

  // Из ящика деньги уходят и приходят не только чеками: инкассация, размен.
  const money = db.get<{ moneyIn: number; moneyOut: number }>(
    `SELECT COALESCE(SUM(CASE WHEN type = 'income'  THEN amount END), 0) AS moneyIn,
            COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS moneyOut
     FROM money_docs
     WHERE shift_id = ? AND account = 'Касса магазина'`,
    [shiftId],
  );

  const revenue = sales?.revenue ?? 0;
  const cash = sales?.cash ?? 0;
  const moneyIn = money?.moneyIn ?? 0;
  const moneyOut = money?.moneyOut ?? 0;
  const expectedCash = shift.opening_cash + cash + moneyIn - moneyOut;

  return {
    shift,
    register_name: register?.name ?? 'Касса',
    location_name: register?.location_name ?? null,
    revenue,
    cash,
    card: sales?.card ?? 0,
    transfer: sales?.transfer ?? 0,
    receipts: sales?.receipts ?? 0,
    returns: returns?.count ?? 0,
    returnsSum: returns?.sum ?? 0,
    moneyIn,
    moneyOut,
    expectedCash,
    difference: shift.closing_cash === null ? null : shift.closing_cash - expectedCash,
  };
}

/** Список смен для таблицы кабинета — свежие сверху. */
export function listShifts(db: SqlDriver, limit = 200): ShiftReport[] {
  const ids = db.all<{ id: Id }>('SELECT id FROM shifts ORDER BY id DESC LIMIT ?', [limit]);
  return ids.map((row) => shiftReport(db, row.id));
}

/**
 * Сколько денег осталось в ящике этой кассы с прошлой смены.
 *
 * Подставляется в «Сумму денег в кассе» при открытии: ящик не опустошают на
 * ночь, и кассир начинает смену с тем, что в нём лежит. Считать это число
 * заново он не должен — он его сверяет.
 */
export function lastClosingCash(db: SqlDriver, registerId: Id): Kopecks {
  const row = db.get<{ closing_cash: Kopecks | null }>(
    `SELECT closing_cash FROM shifts
     WHERE register_id = ? AND closed_at IS NOT NULL
     ORDER BY id DESC LIMIT 1`,
    [registerId],
  );
  return row?.closing_cash ?? 0;
}

/** Чек смены — строка «Продажа #N» в её движении товара. */
export interface ShiftSale {
  id: Id;
  total: Kopecks;
  payment: string;
  created_at: string;
  /** Кто пробил; пусто — сотрудник не выбран. */
  staff_name: string | null;
  location_name: string | null;
  /** Покупатель; пусто — розничный. */
  customer_name: string | null;
  /** Сколько позиций в чеке — «N поз.». */
  positions: number;
  /** Возвращён ли чек целиком. */
  refunded: number;
  /** Сколько из чека осталось долгом. */
  debt: Kopecks;
}

/** Чеки смены, свежие сверху. */
export function shiftSales(db: SqlDriver, shiftId: Id): ShiftSale[] {
  return db.all<ShiftSale>(
    `SELECT s.id,
            s.total,
            s.payment,
            s.created_at,
            s.debt,
            (SELECT name FROM staff        WHERE id = s.staff_id)    AS staff_name,
            (SELECT name FROM locations    WHERE id = s.location_id) AS location_name,
            (SELECT name FROM counterparties WHERE id = s.customer_id) AS customer_name,
            (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) AS positions,
            (SELECT COUNT(*) FROM stock_moves m
              WHERE m.sale_id = s.id AND m.reason = 'return') > 0 AS refunded
     FROM sales s
     WHERE s.shift_id = ?
     ORDER BY s.id DESC`,
    [shiftId],
  );
}

/** Позиции одного чека — то, что раскрывается под «Список товаров». */
export function saleLines(
  db: SqlDriver,
  saleId: Id,
): { name: string; unit: string; qty: number; price: Kopecks }[] {
  return db.all<{ name: string; unit: string; qty: number; price: Kopecks }>(
    `SELECT p.name, p.unit, i.qty, i.price
     FROM sale_items i
     JOIN products p ON p.id = i.product_id
     WHERE i.sale_id = ?
     ORDER BY i.id`,
    [saleId],
  );
}

/** Денежные документы смены — вкладка «Движение денег». */
export interface ShiftMoney {
  id: Id;
  type: string;
  amount: Kopecks;
  account: string;
  account_to: string | null;
  category: string | null;
  note: string | null;
  created_at: string;
}

export function shiftMoney(db: SqlDriver, shiftId: Id): ShiftMoney[] {
  return db.all<ShiftMoney>(
    `SELECT id, type, amount, account, account_to, category, note, created_at
     FROM money_docs
     WHERE shift_id = ?
     ORDER BY id DESC`,
    [shiftId],
  );
}

/**
 * Сколько времени шла смена — «8 ч 50 мин» в списке.
 *
 * У открытой смены длительности нет: она ещё идёт, и в списке вместо неё
 * стоит «Открыта в 10:06».
 */
export function shiftLength(shift: Shift): string | null {
  if (!shift.closed_at) return null;

  const minutes = Math.max(
    0,
    Math.round((Date.parse(shift.closed_at) - Date.parse(shift.opened_at)) / 60000),
  );
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} ч ${minutes % 60} мин` : `${minutes} мин`;
}
