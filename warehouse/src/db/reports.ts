import type { SqlDriver } from './driver';
import { KIND_SQL, ONE_SIDE } from './stock';
import { DOC_KIND_LABEL, type DocKind, type Id } from '../domain/types';

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
 * Магазин, по которому смотрят показатели. `null` — по всем сразу.
 *
 * Отдельного «все магазины» в базе нет и быть не должно: это не место
 * хранения, а отсутствие условия в запросе.
 */
export type Scope = Id | null;

/**
 * Условие «только этот магазин» — или пустая строка, если смотрим все.
 *
 * Значение вклеивается в текст запроса, а не передаётся параметром: параметров
 * у каждого запроса своё число, и подстраивать их массив под необязательное
 * условие пришлось бы в каждом. Целочисленность проверяется здесь — строке
 * попасть в SQL неоткуда.
 */
function scopeSql(column: string, scope: Scope): string {
  if (scope === null) return '';
  if (!Number.isInteger(scope)) throw new Error(`Магазин задаётся целым id, получено: ${scope}`);
  return ` AND ${column} = ${scope}`;
}

/**
 * Возвращённые чеки исключаются: при возврате их суммы обнуляются, и учитывать
 * такой чек в количестве и среднем чеке было бы неверно.
 */
export function salesSummary(db: SqlDriver, period: Period, scope: Scope = null): SalesSummary {
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
       )${scopeSql('s.location_id', scope)}`,
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
export function dailySales(db: SqlDriver, period: Period, scope: Scope = null): DailyPoint[] {
  return db.all<DailyPoint>(
    `SELECT substr(s.created_at, 1, 10)               AS day,
            COALESCE(SUM(s.total), 0)                 AS revenue,
            COALESCE(SUM(s.total - s.cost_total), 0)  AS profit,
            COUNT(*)                                  AS receipts
     FROM sales s
     WHERE s.created_at >= ? AND s.created_at < ?
       AND NOT EXISTS (
         SELECT 1 FROM stock_moves m WHERE m.sale_id = s.id AND m.reason = 'return'
       )${scopeSql('s.location_id', scope)}
     GROUP BY day
     ORDER BY day`,
    [period.from, period.to],
  );
}

/** Периоды выпадающего списка в кабинете: сегодня, неделю, месяц, квартал, год. */
export type PeriodKind = 'today' | 'week' | 'month' | 'quarter' | 'year';

/** Периоды для быстрых кнопок в отчётах. Границы — по локальному дню. */
export function periodFor(kind: PeriodKind, now = new Date()): Period {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (kind === 'week') start.setDate(start.getDate() - 6);
  if (kind === 'month') start.setDate(start.getDate() - 29);
  if (kind === 'quarter') start.setDate(start.getDate() - 89);
  if (kind === 'year') start.setFullYear(start.getFullYear() - 1);

  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  return { from: start.toISOString(), to: end.toISOString() };
}

/** Строка таблицы «Документы» на главной кабинета. */
export interface DocumentTotal {
  /** Название типа документа, как в кабинете. */
  name: string;
  /** Сколько документов этого типа за период. */
  count: number;
  /** Сумма по документам, копейки. */
  amount: number;
  /** Сколько товара прошло через них, тысячные. */
  quantity: number;
}

/**
 * Сводка по типам документов за период.
 *
 * Типы перечислены все, что есть в кабинете, включая те, которых приложение
 * пока не умеет: пустая строка честнее отсутствующей — сразу видно, что
 * оприходований за месяц не было, а не что раздел куда-то делся.
 */
export function documentTotals(db: SqlDriver, period: Period, scope: Scope = null): DocumentTotal[] {
  const sales = db.get<{ count: number; amount: number; quantity: number }>(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(s.total), 0) AS amount,
            COALESCE((
              SELECT SUM(ABS(m.qty_delta)) FROM stock_moves m
              JOIN sales x ON x.id = m.sale_id
              WHERE m.reason = 'sale' AND x.created_at >= ? AND x.created_at < ?
                ${scopeSql('x.location_id', scope)}
            ), 0) AS quantity
     FROM sales s
     WHERE s.created_at >= ? AND s.created_at < ?
       AND NOT EXISTS (
         SELECT 1 FROM stock_moves m WHERE m.sale_id = s.id AND m.reason = 'return'
       )${scopeSql('s.location_id', scope)}`,
    [period.from, period.to, period.from, period.to],
  );

  const refunds = db.get<{ count: number; amount: number; quantity: number }>(
    `SELECT COUNT(DISTINCT s.id) AS count,
            COALESCE(SUM(DISTINCT s.total), 0) AS amount,
            COALESCE(SUM(ABS(m.qty_delta)), 0) AS quantity
     FROM sales s
     JOIN stock_moves m ON m.sale_id = s.id AND m.reason = 'return'
     WHERE s.created_at >= ? AND s.created_at < ?${scopeSql('s.location_id', scope)}`,
    [period.from, period.to],
  );

  const byKind = new Map<string, { count: number; amount: number; quantity: number }>();
  for (const row of db.all<{
    kind: string;
    count: number;
    amount: number;
    quantity: number;
  }>(
    `SELECT ${KIND_SQL} AS kind,
            COUNT(DISTINCT d.id) AS count,
            CAST(ROUND(COALESCE(SUM(ABS(m.qty_delta) * m.price), 0) / 1000.0) AS INTEGER) AS amount,
            COALESCE(SUM(ABS(m.qty_delta)), 0) AS quantity
     FROM docs d
     LEFT JOIN stock_moves m ON m.doc_id = d.id AND ${ONE_SIDE}
     WHERE d.created_at >= ? AND d.created_at < ?${scopeSql('d.location_id', scope)}
     GROUP BY kind`,
    [period.from, period.to],
  )) {
    byKind.set(row.kind, row);
  }

  const empty = { count: 0, amount: 0, quantity: 0 };
  const doc = (kind: DocKind) => byKind.get(kind) ?? empty;

  // Порядок строк — тот же, что в кабинете.
  return [
    { name: 'Продажа', ...(sales ?? empty) },
    { name: DOC_KIND_LABEL.purchase, ...doc('purchase') },
    { name: 'Возврат продажи', ...(refunds ?? empty) },
    { name: DOC_KIND_LABEL.purchase_return, ...doc('purchase_return') },
    { name: DOC_KIND_LABEL.adjustment, ...doc('adjustment') },
    { name: DOC_KIND_LABEL.inventory, ...doc('inventory') },
    { name: DOC_KIND_LABEL.stock_in, ...doc('stock_in') },
    { name: DOC_KIND_LABEL.writeoff, ...doc('writeoff') },
    { name: DOC_KIND_LABEL.transfer, ...doc('transfer') },
  ];
}

/** Блок «Оценка склада по всем магазинам». */
export interface StockOverview {
  /** Суммарное количество товара, тысячные. Может быть отрицательным. */
  quantity: number;
  retailValue: number;
  costValue: number;
  /** Сколько позиций без себестоимости — их оценка заведомо занижена. */
  zeroCost: number;
  /** Сколько позиций ушло в минус. */
  negative: number;
}

/**
 * Оценка склада вместе с поводами ей не доверять.
 *
 * Отрицательные остатки и позиции без себестоимости считаются и показываются
 * отдельно: без них сумма выглядит достоверной, хотя на деле собрана из
 * незаполненных карточек — ровно это и предупреждает исходное приложение.
 *
 * В деньги идут только положительные остатки: товара, ушедшего в минус,
 * на полке нет, и вычитать его стоимость из оценки склада не из чего.
 * Количество, наоборот, считается по всем — минус там и должен быть виден.
 */
export function stockOverview(db: SqlDriver, scope: Scope = null): StockOverview {
  const row = db.get<StockOverview>(
    `SELECT COALESCE(SUM(stock), 0) AS quantity,
            CAST(ROUND(COALESCE(SUM(CASE WHEN stock > 0 THEN stock * p.sale_price END), 0)
                 / 1000.0) AS INTEGER) AS retailValue,
            CAST(ROUND(COALESCE(SUM(CASE WHEN stock > 0 THEN stock * p.cost_price END), 0)
                 / 1000.0) AS INTEGER) AS costValue,
            COALESCE(SUM(CASE WHEN p.cost_price = 0 AND stock <> 0 THEN 1 ELSE 0 END), 0) AS zeroCost,
            COALESCE(SUM(CASE WHEN stock < 0 THEN 1 ELSE 0 END), 0) AS negative
     FROM (
       SELECT p.id,
              COALESCE((SELECT SUM(m.qty_delta) FROM stock_moves m
                        WHERE m.product_id = p.id${scopeSql('m.location_id', scope)}), 0) AS stock
       FROM products p
       WHERE p.archived = 0
     ) s
     JOIN products p ON p.id = s.id`,
  );

  return row ?? { quantity: 0, retailValue: 0, costValue: 0, zeroCost: 0, negative: 0 };
}
