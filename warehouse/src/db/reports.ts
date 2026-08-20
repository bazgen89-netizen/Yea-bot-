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
 * Сдвиг от Гринвича до времени магазина, словами SQLite: «+180 minutes».
 *
 * Время чека хранится по Гринвичу — так его отдаёт CloudShop и так пишет
 * `toISOString`. А смотрит на него хозяин по-своему: чек, пробитый в
 * 22:30 в Нижнем, по Гринвичу помечен 19:30 **того же** дня, а вот
 * пробитый в 00:30 — 21:30 **вчерашнего**.
 *
 * Пока сутки резались прямо по строке, такие чеки уезжали в соседний день:
 * выручка дня не сходилась с кассой, а график часов показывал 7 утра там,
 * где торговали в 10. Поэтому перед тем как отрезать день или час, время
 * сдвигаем к местному.
 *
 * Сдвиг берётся у самого браузера, а не из справочника часовых поясов: в
 * SQLite, собранном для страницы, справочника нет вовсе, и `'localtime'`
 * там молча ничего не делает.
 */
function localShift(offsetMinutes = -new Date().getTimezoneOffset()): string {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  return `${sign}${Math.abs(Math.round(offsetMinutes))} minutes`;
}

/** «2026-08-19» по местному времени. */
export function localDaySql(column: string, offsetMinutes?: number): string {
  return `substr(datetime(${column}, '${localShift(offsetMinutes)}'), 1, 10)`;
}

/** «22» — час по местному времени. */
export function localHourSql(column: string, offsetMinutes?: number): string {
  return `substr(datetime(${column}, '${localShift(offsetMinutes)}'), 12, 2)`;
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
  barcode: string | null;
  sku: string | null;
  /** Продано, тысячные. */
  qty: number;
  /** В скольких чеках товар встретился. */
  sales: number;
  /** Выручка по позиции до скидки на чек, копейки. */
  revenue: number;
  /** Прибыль по позиции, копейки. */
  profit: number;
}

/**
 * Продажи по товарам.
 *
 * `kind` отбирает вид позиции: отчёт по комплектам — это тот же запрос,
 * но только по комплектам. Отдельным запросом он отличался бы одной
 * строчкой и разошёлся бы с этим при первой же правке.
 */
export function topProducts(
  db: SqlDriver,
  period: Period,
  limit = 10,
  kind?: string,
): TopProduct[] {
  return db.all<TopProduct>(
    `SELECT i.product_id,
            p.name,
            p.unit,
            p.barcode,
            p.sku,
            SUM(i.qty)                                     AS qty,
            COUNT(DISTINCT i.sale_id)                      AS sales,
            CAST(ROUND(SUM(i.qty * i.price) / 1000.0) AS INTEGER)                  AS revenue,
            CAST(ROUND(SUM(i.qty * (i.price - i.cost_price)) / 1000.0) AS INTEGER) AS profit
     FROM sale_items i
     JOIN sales s    ON s.id = i.sale_id
     JOIN products p ON p.id = i.product_id
     WHERE s.created_at >= ? AND s.created_at < ?
       AND (? IS NULL OR p.kind = ?)
       AND NOT EXISTS (
         SELECT 1 FROM stock_moves m WHERE m.sale_id = s.id AND m.reason = 'return'
       )
     GROUP BY i.product_id
     ORDER BY revenue DESC
     LIMIT ?`,
    [period.from, period.to, kind ?? null, kind ?? null, limit],
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

/** Сколько денег «лежит» на складе — во всех магазинах или в одном. */
export function stockValue(db: SqlDriver, scope: Scope = null): StockValue {
  const row = db.get<StockValue>(
    `SELECT CAST(ROUND(COALESCE(SUM(stock * p.cost_price), 0) / 1000.0) AS INTEGER) AS costValue,
            CAST(ROUND(COALESCE(SUM(stock * p.sale_price), 0) / 1000.0) AS INTEGER) AS retailValue,
            COUNT(*)                                      AS positions
     FROM (
       SELECT p.id,
              COALESCE((SELECT SUM(m.qty_delta) FROM stock_moves m
                        WHERE m.product_id = p.id${scopeSql('m.location_id', scope)}), 0) AS stock
       FROM products p
       WHERE p.archived = 0
     ) s
     JOIN products p ON p.id = s.id
     WHERE s.stock > 0`,
  );

  return row ?? { costValue: 0, retailValue: 0, positions: 0 };
}

/**
 * Сколько единиц товара лежит на складе — во всех магазинах или в одном.
 *
 * Отдельной функцией, а не перебором справочника в экране: на главной нужно
 * одно число, а `listProducts` тянет пятьсот девяносто карточек со всеми
 * полями, и фильтра по магазину у него нет вовсе.
 */
export function stockQty(db: SqlDriver, scope: Scope = null): number {
  const row = db.get<{ qty: number }>(
    `SELECT COALESCE(SUM(m.qty_delta), 0) AS qty
       FROM stock_moves m
       JOIN products p ON p.id = m.product_id
      WHERE p.archived = 0${scopeSql('m.location_id', scope)}`,
  );
  return row?.qty ?? 0;
}

export interface DailyPoint {
  /** Дата в формате YYYY-MM-DD. */
  day: string;
  revenue: number;
  profit: number;
  receipts: number;
}

/** Выручка по дням — для графика в отчётах. */
export function dailySales(
  db: SqlDriver,
  period: Period,
  scope: Scope = null,
  offsetMinutes?: number,
): DailyPoint[] {
  return db.all<DailyPoint>(
    `SELECT ${localDaySql('s.created_at', offsetMinutes)} AS day,
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

/**
 * Выручка по часам — для графика дня.
 *
 * За один день `dailySales` возвращает одну точку, и столбик растягивается на
 * всю карточку синим прямоугольником: график, на котором нечего сравнивать.
 * В его телефоне за день нарисованы часы — с восьми до семнадцати видно, в
 * какие часы торговали.
 *
 * Пустые часы возвращаются нулями, а не пропускаются: иначе столбики
 * съезжаются, и десять утра оказывается там, где должно быть восемь.
 */
export function hourlySales(
  db: SqlDriver,
  period: Period,
  scope: Scope = null,
  offsetMinutes?: number,
): DailyPoint[] {
  const rows = db.all<{ hour: string; revenue: number; profit: number; receipts: number }>(
    `SELECT ${localHourSql('s.created_at', offsetMinutes)} AS hour,
            COALESCE(SUM(s.total), 0)                AS revenue,
            COALESCE(SUM(s.total - s.cost_total), 0) AS profit,
            COUNT(*)                                 AS receipts
     FROM sales s
     WHERE s.created_at >= ? AND s.created_at < ?
       AND NOT EXISTS (
         SELECT 1 FROM stock_moves m WHERE m.sale_id = s.id AND m.reason = 'return'
       )${scopeSql('s.location_id', scope)}
     GROUP BY hour
     ORDER BY hour`,
    [period.from, period.to],
  );

  const byHour = new Map(rows.map((row) => [Number(row.hour), row]));

  // Показываем не сутки целиком, а рабочие часы: ночью магазин закрыт, и
  // восемь пустых столбиков слева — не сведения, а шум. Границы берём по
  // самим продажам, с запасом в час.
  const hours = rows.map((row) => Number(row.hour));
  const from = hours.length ? Math.max(0, Math.min(...hours) - 1) : 8;
  const to = hours.length ? Math.min(23, Math.max(...hours) + 1) : 20;

  const points: DailyPoint[] = [];
  for (let hour = from; hour <= to; hour++) {
    const row = byHour.get(hour);
    points.push({
      day: String(hour).padStart(2, '0'),
      revenue: row?.revenue ?? 0,
      profit: row?.profit ?? 0,
      receipts: row?.receipts ?? 0,
    });
  }

  return points;
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

export interface CategorySales {
  name: string;
  revenue: number;
  profit: number;
  sales: number;
  qty: number;
}

/**
 * Продажи по категориям.
 *
 * Товары без категории идут одной строкой «Без категории», а не пропадают:
 * иначе сумма по отчёту не сошлась бы с выручкой за тот же период.
 */
export function salesByCategory(db: SqlDriver, period: Period): CategorySales[] {
  return db.all<CategorySales>(
    `SELECT COALESCE(c.name, 'Без категории') AS name,
            CAST(ROUND(SUM(i.qty * i.price) / 1000.0) AS INTEGER)                  AS revenue,
            CAST(ROUND(SUM(i.qty * (i.price - i.cost_price)) / 1000.0) AS INTEGER) AS profit,
            COUNT(DISTINCT i.sale_id) AS sales,
            SUM(i.qty)                AS qty
     FROM sale_items i
     JOIN sales s        ON s.id = i.sale_id
     JOIN products p     ON p.id = i.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE s.created_at >= ? AND s.created_at < ?
       AND NOT EXISTS (
         SELECT 1 FROM stock_moves m WHERE m.sale_id = s.id AND m.reason = 'return'
       )
     -- По номеру колонки: имя категории собрано выражением, а колонка name
     -- есть ещё и у товара — по имени SQLite не понимает, какая имелась в виду.
     GROUP BY 1
     ORDER BY revenue DESC`,
    [period.from, period.to],
  );
}

export interface ProductMotion {
  name: string;
  unit: string;
  /** Остаток на начало периода, тысячные. */
  before: number;
  /** Поступило за период, тысячные. */
  movsIn: number;
  /** Выбыло за период, тысячные (положительное число). */
  movsOut: number;
  /** Остаток на конец, тысячные. */
  after: number;
}

/**
 * Движение товара по позициям — так этот отчёт устроен в исходном приложении:
 * остаток на начало, приход, расход, остаток на конец.
 *
 * Товары без движений за период не показываются: строка «ничего не
 * происходило» занимает место и ничего не сообщает.
 */
export function motionByProduct(db: SqlDriver, period: Period): ProductMotion[] {
  return db
    .all<ProductMotion>(
      `SELECT p.name,
              p.unit,
              COALESCE((SELECT SUM(m.qty_delta) FROM stock_moves m
                        WHERE m.product_id = p.id AND m.created_at < ?), 0) AS before,
              COALESCE(SUM(CASE WHEN v.qty_delta > 0 THEN v.qty_delta END), 0)  AS movsIn,
              -COALESCE(SUM(CASE WHEN v.qty_delta < 0 THEN v.qty_delta END), 0) AS movsOut,
              0 AS after
       FROM stock_moves v
       JOIN products p ON p.id = v.product_id
       WHERE v.created_at >= ? AND v.created_at < ?
       GROUP BY p.id
       ORDER BY p.name COLLATE NOCASE`,
      [period.from, period.from, period.to],
    )
    .map((row) => ({ ...row, after: row.before + row.movsIn - row.movsOut }));
}

export interface AgentReport {
  name: string;
  salesCount: number;
  salesSum: number;
  returnCount: number;
  /** Средний чек, копейки. */
  average: number;
  /** Приход по ордерам, копейки. */
  debit: number;
  /** Расход по ордерам, копейки. */
  credit: number;
}

/**
 * Отчёт по агентам — по контрагентам: сколько купили, сколько вернули,
 * сколько прошло деньгами.
 *
 * Только те, у кого за период что-то было: в справочнике три тысячи карточек,
 * и строки с нулями сделали бы отчёт нечитаемым.
 */
export function agentsReport(db: SqlDriver, period: Period): AgentReport[] {
  const rows = db.all<Omit<AgentReport, 'average'>>(
    `SELECT c.name,
            COALESCE(SUM(CASE WHEN r.id IS NULL THEN 1 ELSE 0 END), 0) AS salesCount,
            COALESCE(SUM(CASE WHEN r.id IS NULL THEN s.total ELSE 0 END), 0) AS salesSum,
            COALESCE(SUM(CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS returnCount,
            COALESCE((SELECT SUM(amount) FROM money_docs md
                      WHERE md.counterparty_id = c.id AND md.type = 'income'
                        AND md.created_at >= ? AND md.created_at < ?), 0) AS debit,
            COALESCE((SELECT SUM(amount) FROM money_docs md
                      WHERE md.counterparty_id = c.id AND md.type = 'expense'
                        AND md.created_at >= ? AND md.created_at < ?), 0) AS credit
     FROM counterparties c
     JOIN sales s ON s.customer_id = c.id AND s.created_at >= ? AND s.created_at < ?
     LEFT JOIN stock_moves r ON r.sale_id = s.id AND r.reason = 'return'
     GROUP BY c.id
     ORDER BY salesSum DESC`,
    [period.from, period.to, period.from, period.to, period.from, period.to],
  );

  return rows.map((row) => ({
    ...row,
    average: row.salesCount > 0 ? Math.round(row.salesSum / row.salesCount) : 0,
  }));
}

export interface StaffReport {
  name: string;
  role: string;
  salesCount: number;
  returnCount: number;
  /** Сумма пробитого без возвратов, копейки. */
  salesSum: number;
  /** Средний чек, копейки. */
  average: number;
  /** Сумма выданных скидок, копейки. */
  discounts: number;
  /** Позиций в чеке в среднем, сотые доли штуки: 250 = 2,5. */
  itemsPerReceipt: number;
}

/**
 * Отчёт по сотрудникам.
 *
 * Раньше отдавал пустую таблицу, потому что чек не помнил, кто его пробил.
 * Теперь помнит — но только с того дня, как завели сотрудников: у чеков,
 * пробитых раньше, сотрудника нет и приписать его задним числом нельзя.
 */
export function staffReport(db: SqlDriver, period: Period): StaffReport[] {
  const rows = db.all<Omit<StaffReport, 'average' | 'itemsPerReceipt'> & { items: number }>(
    `SELECT st.name,
            st.role,
            COALESCE(SUM(CASE WHEN r.id IS NULL THEN 1 ELSE 0 END), 0) AS salesCount,
            COALESCE(SUM(CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END), 0) AS returnCount,
            COALESCE(SUM(CASE WHEN r.id IS NULL THEN s.total ELSE 0 END), 0) AS salesSum,
            COALESCE(SUM(CASE WHEN r.id IS NULL THEN s.discount ELSE 0 END), 0) AS discounts,
            COALESCE(SUM(CASE WHEN r.id IS NULL
                              THEN (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id)
                              ELSE 0 END), 0) AS items
     FROM staff st
     JOIN sales s ON s.staff_id = st.id AND s.created_at >= ? AND s.created_at < ?
     LEFT JOIN stock_moves r ON r.sale_id = s.id AND r.reason = 'return'
     GROUP BY st.id
     ORDER BY salesSum DESC`,
    [period.from, period.to],
  );

  return rows.map((row) => ({
    name: row.name,
    role: row.role,
    salesCount: row.salesCount,
    returnCount: row.returnCount,
    salesSum: row.salesSum,
    discounts: row.discounts,
    average: row.salesCount > 0 ? Math.round(row.salesSum / row.salesCount) : 0,
    itemsPerReceipt: row.salesCount > 0 ? Math.round((row.items * 100) / row.salesCount) : 0,
  }));
}
