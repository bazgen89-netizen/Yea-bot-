import type { SqlDb } from '../db/driver.ts';

export interface Period {
  from: string;
  to: string;
}

export interface SalesSummary {
  revenue: number;
  cost: number;
  profit: number;
  discounts: number;
  receipts: number;
  averageReceipt: number;
}

/**
 * Возвращённые чеки исключаются: при возврате их суммы обнуляются, и учитывать
 * такой чек в количестве и среднем чеке было бы неверно.
 */
export async function salesSummary(
  db: SqlDb,
  orgId: string,
  period: Period,
  locationId?: string,
): Promise<SalesSummary> {
  const params: unknown[] = [orgId, period.from, period.to];
  let filter = '';
  if (locationId) {
    params.push(locationId);
    filter = ` AND location_id = $${params.length}`;
  }

  const row = await db.one<{
    revenue: number;
    cost: number;
    discounts: number;
    receipts: number;
  }>(
    `SELECT COALESCE(SUM(total), 0)::bigint      AS revenue,
            COALESCE(SUM(cost_total), 0)::bigint AS cost,
            COALESCE(SUM(discount), 0)::bigint   AS discounts,
            COUNT(*)::int                        AS receipts
     FROM sales
     WHERE org_id = $1 AND created_at >= $2 AND created_at < $3
       AND refunded_at IS NULL${filter}`,
    params,
  );

  const revenue = Number(row?.revenue ?? 0);
  const cost = Number(row?.cost ?? 0);
  const receipts = Number(row?.receipts ?? 0);

  return {
    revenue,
    cost,
    profit: revenue - cost,
    discounts: Number(row?.discounts ?? 0),
    receipts,
    averageReceipt: receipts > 0 ? Math.round(revenue / receipts) : 0,
  };
}

export interface TopProduct {
  product_id: string;
  name: string;
  unit: string;
  qty: number;
  revenue: number;
  profit: number;
}

export async function topProducts(
  db: SqlDb,
  orgId: string,
  period: Period,
  options: { locationId?: string; limit?: number } = {},
): Promise<TopProduct[]> {
  const params: unknown[] = [orgId, period.from, period.to];
  let filter = '';
  if (options.locationId) {
    params.push(options.locationId);
    filter = ` AND s.location_id = $${params.length}`;
  }
  params.push(Math.min(options.limit ?? 10, 100));

  return db.query<TopProduct>(
    `SELECT i.product_id, p.name, p.unit,
            SUM(i.qty)::bigint                                       AS qty,
            ROUND(SUM(i.qty * i.price) / 1000.0)::bigint             AS revenue,
            ROUND(SUM(i.qty * (i.price - i.cost_price)) / 1000.0)::bigint AS profit
     FROM sale_items i
     JOIN sales s    ON s.id = i.sale_id
     JOIN products p ON p.id = i.product_id
     WHERE s.org_id = $1 AND s.created_at >= $2 AND s.created_at < $3
       AND s.refunded_at IS NULL${filter}
     GROUP BY i.product_id, p.name, p.unit
     ORDER BY revenue DESC
     LIMIT $${params.length}`,
    params,
  );
}

export interface StockValue {
  costValue: number;
  retailValue: number;
  positions: number;
}

/** Сколько денег лежит на складе. */
export async function stockValue(
  db: SqlDb,
  orgId: string,
  locationId?: string,
): Promise<StockValue> {
  const params: unknown[] = [orgId];
  let filter = '';
  if (locationId) {
    params.push(locationId);
    filter = ` AND m.location_id = $${params.length}`;
  }

  const row = await db.one<StockValue>(
    `SELECT COALESCE(ROUND(SUM(stock * cost_price) / 1000.0), 0)::bigint AS "costValue",
            COALESCE(ROUND(SUM(stock * sale_price) / 1000.0), 0)::bigint AS "retailValue",
            COUNT(*)::int AS positions
     FROM (
       SELECT p.cost_price, p.sale_price,
              COALESCE((
                SELECT SUM(m.qty_delta) FROM stock_moves m
                WHERE m.product_id = p.id${filter}
              ), 0) AS stock
       FROM products p
       WHERE p.org_id = $1 AND p.archived = false
     ) rows
     -- Отрицательные остатки тоже учитываются: если товар ушёл в минус,
     -- оценка склада должна это показывать, а не делать вид, что его ноль.
     WHERE stock <> 0`,
    params,
  );

  return {
    costValue: Number(row?.costValue ?? 0),
    retailValue: Number(row?.retailValue ?? 0),
    positions: Number(row?.positions ?? 0),
  };
}

export interface DailyPoint {
  day: string;
  revenue: number;
  profit: number;
  receipts: number;
}

export async function dailySales(
  db: SqlDb,
  orgId: string,
  period: Period,
  locationId?: string,
): Promise<DailyPoint[]> {
  const params: unknown[] = [orgId, period.from, period.to];
  let filter = '';
  if (locationId) {
    params.push(locationId);
    filter = ` AND location_id = $${params.length}`;
  }

  return db.query<DailyPoint>(
    `SELECT to_char(created_at, 'YYYY-MM-DD')          AS day,
            COALESCE(SUM(total), 0)::bigint             AS revenue,
            COALESCE(SUM(total - cost_total), 0)::bigint AS profit,
            COUNT(*)::int                               AS receipts
     FROM sales
     WHERE org_id = $1 AND created_at >= $2 AND created_at < $3
       AND refunded_at IS NULL${filter}
     GROUP BY day
     ORDER BY day`,
    params,
  );
}

export interface LocationBreakdown {
  location_id: string;
  location_name: string;
  revenue: number;
  profit: number;
  receipts: number;
}

/** Выручка в разрезе точек — ради этого и заводились несколько складов. */
export async function salesByLocation(
  db: SqlDb,
  orgId: string,
  period: Period,
): Promise<LocationBreakdown[]> {
  return db.query<LocationBreakdown>(
    `SELECT l.id AS location_id, l.name AS location_name,
            COALESCE(SUM(s.total), 0)::bigint              AS revenue,
            COALESCE(SUM(s.total - s.cost_total), 0)::bigint AS profit,
            COUNT(s.id)::int                                AS receipts
     FROM locations l
     LEFT JOIN sales s
       ON s.location_id = l.id
      AND s.created_at >= $2 AND s.created_at < $3
      AND s.refunded_at IS NULL
     WHERE l.org_id = $1 AND l.archived = false
     GROUP BY l.id, l.name
     ORDER BY revenue DESC`,
    [orgId, period.from, period.to],
  );
}
