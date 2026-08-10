import type { SqlDriver } from './driver';
import { listLocationsWithTotals } from './locations';
import { accountBalances } from './money';
import {
  dailySales,
  documentTotals,
  salesSummary,
  stockOverview,
  topProducts,
  type Period,
} from './reports';
import { listProducts } from './products';
import { formatDayLabel, groupByMonth, groupByWeek } from '../domain/grouping';
import { formatMoneyWeb } from '../domain/money';
import { formatQtyWeb } from '../domain/qty';

/**
 * Отчёты кабинета.
 *
 * Каждый отчёт — это набор колонок и функция, отдающая готовые строки. Так
 * экран отчёта один на все: он не знает, что именно считает, и добавление
 * нового отчёта не требует нового экрана.
 *
 * Ячейки — уже строки: форматирование денег и количеств у нас отличается на
 * телефоне и в кабинете, и решать это в каждой таблице заново значит рано или
 * поздно разойтись.
 */

export interface ReportColumn {
  title: string;
  width: number;
  numeric?: boolean;
}

export interface ReportDefinition {
  id: string;
  title: string;
  /** Одной строкой: что именно показывает отчёт. */
  note: string;
  columns: ReportColumn[];
  rows: (db: SqlDriver, period: Period) => string[][];
  /** Итоговая строка снизу; пусто — итога нет. */
  total?: (db: SqlDriver, period: Period) => string[] | null;
}

const money = (value: number) => formatMoneyWeb(value);

/** Продажи, сгруппированные по дням, неделям или месяцам. */
function salesOver(kind: 'day' | 'week' | 'month'): ReportDefinition['rows'] {
  return (db, period) => {
    const points = dailySales(db, period);
    const buckets =
      kind === 'day'
        ? points.map((p) => ({ label: formatDayLabel(p.day), ...p }))
        : kind === 'week'
          ? groupByWeek(points)
          : groupByMonth(points);

    return buckets.map((b) => [
      b.label,
      String(b.receipts),
      money(b.revenue),
      money(b.revenue - b.profit),
      money(b.profit),
    ]);
  };
}

const SALES_COLUMNS: ReportColumn[] = [
  { title: 'Период', width: 260 },
  { title: 'Чеков', width: 110, numeric: true },
  { title: 'Выручка, руб', width: 170, numeric: true },
  { title: 'Себестоимость, руб', width: 200, numeric: true },
  { title: 'Прибыль, руб', width: 170, numeric: true },
];

function salesTotal(db: SqlDriver, period: Period): string[] {
  const s = salesSummary(db, period);
  return ['Итого', String(s.receipts), money(s.revenue), money(s.cost), money(s.profit)];
}

export const REPORTS: ReportDefinition[] = [
  {
    id: 'sales-by-day',
    title: 'Продажи по дням',
    note: 'Выручка, себестоимость и прибыль по каждому дню периода.',
    columns: SALES_COLUMNS,
    rows: salesOver('day'),
    total: salesTotal,
  },
  {
    id: 'sales-by-week',
    title: 'Продажи по неделям',
    note: 'То же по неделям. Неделя считается с понедельника.',
    columns: SALES_COLUMNS,
    rows: salesOver('week'),
    total: salesTotal,
  },
  {
    id: 'sales-by-month',
    title: 'Продажи по месяцам',
    note: 'То же по календарным месяцам.',
    columns: SALES_COLUMNS,
    rows: salesOver('month'),
    total: salesTotal,
  },
  {
    id: 'sales-by-product',
    title: 'Продажи по товарам',
    note: 'Что продавалось за период и сколько на этом заработано.',
    columns: [
      { title: 'Товар', width: 380 },
      { title: 'Продано', width: 150, numeric: true },
      { title: 'Выручка, руб', width: 180, numeric: true },
      { title: 'Прибыль, руб', width: 180, numeric: true },
    ],
    rows: (db, period) =>
      topProducts(db, period, 500).map((p) => [
        p.name,
        `${formatQtyWeb(p.qty)} ${p.unit}`,
        money(p.revenue),
        money(p.profit),
      ]),
  },
  {
    id: 'movement',
    title: 'Отчёт по движению',
    note: 'Сколько документов каждого вида проведено и на какую сумму.',
    columns: [
      { title: 'Документ', width: 300 },
      { title: 'Кол-во', width: 130, numeric: true },
      { title: 'Сумма, руб', width: 190, numeric: true },
      { title: 'Товара', width: 190, numeric: true },
    ],
    rows: (db, period) =>
      documentTotals(db, period).map((row) => [
        row.name,
        String(row.count),
        money(row.amount),
        row.quantity === 0 ? '0' : formatQtyWeb(row.quantity),
      ]),
  },
  {
    id: 'financial',
    title: 'Финансовый отчёт',
    note: 'Выручка, себестоимость, прибыль и скидки за период — одной сводкой.',
    columns: [
      { title: 'Показатель', width: 340 },
      { title: 'Значение', width: 220, numeric: true },
    ],
    rows: (db, period) => {
      const s = salesSummary(db, period);
      return [
        ['Выручка', money(s.revenue)],
        ['Себестоимость продаж', money(s.cost)],
        ['Прибыль', money(s.profit)],
        ['Скидки', money(s.discounts)],
        ['Чеков', String(s.receipts)],
        ['Средний чек', money(s.averageReceipt)],
      ];
    },
  },
  {
    id: 'accounts',
    title: 'Отчёт по счетам',
    note: 'Остаток каждого счёта: чеки, документы прихода и расхода, переводы.',
    columns: [
      { title: 'Счёт', width: 280 },
      { title: 'С продаж, руб', width: 170, numeric: true },
      { title: 'Приход, руб', width: 160, numeric: true },
      { title: 'Расход, руб', width: 160, numeric: true },
      { title: 'Остаток, руб', width: 170, numeric: true },
    ],
    rows: (db) =>
      accountBalances(db).map((a) => [
        a.name,
        money(a.fromSales),
        money(a.income),
        money(a.expense),
        money(a.balance),
      ]),
    total: (db) => {
      const total = accountBalances(db).reduce((sum, a) => sum + a.balance, 0);
      return ['Итого', '', '', '', money(total)];
    },
  },
  {
    id: 'stock-by-store',
    title: 'Остатки по магазинам',
    note: 'Сколько позиций и на какую сумму лежит в каждом магазине.',
    columns: [
      { title: 'Магазин', width: 320 },
      { title: 'Позиций', width: 150, numeric: true },
      { title: 'Количество', width: 190, numeric: true },
      { title: 'В розничных ценах, руб', width: 240, numeric: true },
    ],
    rows: (db) =>
      listLocationsWithTotals(db).map((store) => [
        store.name,
        String(store.positions),
        formatQtyWeb(store.quantity),
        money(store.retailValue),
      ]),
  },
  {
    id: 'stock-value',
    title: 'Оценка склада',
    note: 'Во сколько оценивается склад и что мешает верить этой оценке.',
    columns: [
      { title: 'Показатель', width: 340 },
      { title: 'Значение', width: 240, numeric: true },
    ],
    rows: (db) => {
      const s = stockOverview(db);
      return [
        ['Количество товара', `${formatQtyWeb(s.quantity)} ед.`],
        ['Стоимость в розничных ценах', money(s.retailValue)],
        ['Стоимость по себестоимости', money(s.costValue)],
        ['Позиций с себестоимостью 0', String(s.zeroCost)],
        ['Позиций с остатком меньше 0', String(s.negative)],
      ];
    },
  },
  {
    id: 'low-stock',
    title: 'Заканчивается',
    note: 'Товары, у которых остаток опустился до порога из карточки.',
    columns: [
      { title: 'Товар', width: 420 },
      { title: 'Остаток', width: 170, numeric: true },
      { title: 'Порог', width: 170, numeric: true },
    ],
    rows: (db) =>
      listProducts(db, { lowStockOnly: true }).map((p) => [
        p.name,
        `${formatQtyWeb(p.stock)} ${p.unit}`,
        `${formatQtyWeb(p.min_qty)} ${p.unit}`,
      ]),
  },
];

export function reportById(id: string | undefined): ReportDefinition | null {
  return REPORTS.find((report) => report.id === id) ?? null;
}
