import type { SqlDriver } from './driver';
import type { Id } from '../domain/types';

/** Границы периода в ISO. Конец не включается: [from, to). */
export interface Period {
  from: string;
  to: string;
}

export interface SalesSummary {
  /** Выручка после скидок, копейки. */
  revenue: number;
  /** Себестоимость проданного, копейки. */
  cost: number;
  /** Прибыль = выручка - себестоимость, копейки. */
  profit: number;
  /** Сумма скидок, копейки. */
  discounts: number;
  /** Количество чеков (без возвращённых). */
  receipts: number;
  /** Средний чек, копейки. */
  averageReceipt: number;
}

/**
 * Возвращённые чеки исключаются: при возврате их суммы обнуляются, и учитывать
 * такой чек в количестве и среднем чеке было бы неверно.
 */
export function salesSummary(db: SqlDriver, period: Period): SalesSummary {
  const row = db.get<{
    revenue: number;
    cost: number;
    discounts: number;
    receipts: number;
  }>(
    `SELECT COALESCE(SUM(total), 0)      AS revenue,
            COALESCE(SUM(cost_total), 0) AS cost,
            COALESCE(SUM(discount), 0)   AS discounts,
            COUNT(*)                     AS receipts
     FROM sales s
     WHERE s.created_at >= ? AND s.created_at < ?
       AND NOT EXISTS (
         SELECT 1 FROM stock_moves m WHERE m.sale_id = s.id AND m.reason = 'return'
       )`,
    [period.from, period.to],
  );

  const revenue = row?.revenue ?? 0;
  const cost = row?.cost ?? 0;
  const receipts = row?.receipts ?? 0;

  return {
    revenue,
    cost,
    profit: revenue - cost,
    discounts: row?.discounts ?? 0,
    receipts,
    averageReceipt: receipts > 0 ? Math.round(revenue / receipts) : 0,
  };
}

export interface TopProduct {
  product_id: Id;
  name: string;
  unit: string;
  /** Продано, тысячные. */
  qty: number;
  /** Выручка по позиции до скидки на чек, копейки. */
  revenue: number;
  /** Прибыль по позиции, копейки. */
  profit: number;
}

export function topProducts(db: SqlDriver, period: Period, limit = 10): TopProduct[] {
  return db.all<TopProduct>(
    `SELECT i.product_id,
            p.name,
            p.unit,
            SUM(i.qty)                                     AS qty,
            CAST(ROUND(SUM(i.qty * i.price) / 1000.0) AS INTEGER)                  AS revenue,
            CAST(ROUND(SUM(i.qty * (i.price - i.cost_price)) / 1000.0) AS INTEGER) AS profit
     FROM sale_items i
     JOIN sales s    ON s.id = i.sale_id
     JOIN products p ON p.id = i.product_id
     WHERE s.created_at >= ? AND s.created_at < ?
       AND NOT EXISTS (
         SELECT 1 FROM stock_moves m WHERE m.sale_id = s.id AND m.reason = 'return'
       )
     GROUP BY i.product_id
     ORDER BY revenue DESC
     LIMIT ?`,
    [period.from, period.to, limit],
  );
}

export interface StockValue {
  /** Сумма остатков в закупочных ценах, копейки. */
  costValue: number;
  /** Сумма остатков в розничных ценах, копейки. */
  retailValue: number;
  /** Количество позиций с ненулевым остатком. */
  positions: number;
}

/** Сколько денег «лежит» на складе. */
export function stockValue(db: SqlDriver): StockValue {
  const row = db.get<StockValue>(
    `SELECT CAST(ROUND(COALESCE(SUM(stock * p.cost_price), 0) / 1000.0) AS INTEGER) AS costValue,
            CAST(ROUND(COALESCE(SUM(stock * p.sale_price), 0) / 1000.0) AS INTEGER) AS retailValue,
            COUNT(*)                                      AS positions
     FROM (
       SELECT p.id,
              COALESCE((SELECT SUM(m.qty_delta) FROM stock_moves m
                        WHERE m.product_id = p.id), 0) AS stock
       FROM products p
       WHERE p.archived = 0
     ) s
     JOIN products p ON p.id = s.id
     WHERE s.stock > 0`,
  );

  return row ?? { costValue: 0, retailValue: 0, positions: 0 };
}

export interface DailyPoint {
  /** Дата в формате YYYY-MM-DD. */
  day: string;
  revenue: number;
  profit: number;
  receipts: number;
}

/** Выручка по дням — для графика в отчётах. */
export function dailySales(db: SqlDriver, period: Period): DailyPoint[] {
  return db.all<DailyPoint>(
    `SELECT substr(s.created_at, 1, 10)               AS day,
            COALESCE(SUM(s.total), 0)                 AS revenue,
            COALESCE(SUM(s.total - s.cost_total), 0)  AS profit,
            COUNT(*)                                  AS receipts
     FROM sales s
     WHERE s.created_at >= ? AND s.created_at < ?
       AND NOT EXISTS (
         SELECT 1 FROM stock_moves m WHERE m.sale_id = s.id AND m.reason = 'return'
       )
     GROUP BY day
     ORDER BY day`,
    [period.from, period.to],
  );
}

/** Периоды для быстрых кнопок в отчётах. Границы — по локальному дню. */
export function periodFor(kind: 'today' | 'week' | 'month' | 'year', now = new Date()): Period {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (kind === 'week') start.setDate(start.getDate() - 6);
  if (kind === 'month') start.setDate(start.getDate() - 29);
  if (kind === 'year') start.setFullYear(start.getFullYear() - 1);

  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  return { from: start.toISOString(), to: end.toISOString() };
}
