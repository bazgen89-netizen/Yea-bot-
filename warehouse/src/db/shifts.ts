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
            s.opened_at AS opened_at
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
    `SELECT COALESCE(SUM(total), 0) AS revenue,
            COALESCE(SUM(CASE WHEN payment = 'cash'     THEN total END), 0) AS cash,
            COALESCE(SUM(CASE WHEN payment = 'card'     THEN total END), 0) AS card,
            COALESCE(SUM(CASE WHEN payment = 'transfer' THEN total END), 0) AS transfer,
            COUNT(*) AS receipts
     FROM sales s
     WHERE s.shift_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM stock_moves m WHERE m.sale_id = s.id AND m.reason = 'return'
       )`,
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
