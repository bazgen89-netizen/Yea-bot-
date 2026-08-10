import type { SqlDriver } from './driver';
import { accountBalances } from './money';
import {
  agentsReport,
  dailySales,
  motionByProduct,
  salesByCategory,
  salesSummary,
  staffReport,
  stockOverview,
  topProducts,
  type Period,
} from './reports';
import { formatDayLabel, groupByMonth, groupByWeek } from '../domain/grouping';
import { formatMoneyWeb } from '../domain/money';
import { ROLE_LABEL, type Role } from '../domain/permissions';
import { formatQtyWeb } from '../domain/qty';

/**
 * Отчёты кабинета.
 *
 * Состав, порядок и колонки — те же, что в исходном приложении: они читаются
 * из его собственного кода (`reports.menu` в бандле кабинета), где у каждого
 * отчёта прописаны адрес, название, значок и подсказки к колонкам. Поэтому
 * здесь не «похожий набор», а тот же самый.
 *
 * Каждый отчёт — колонки плюс функция, отдающая готовые строки. Экран отчёта
 * один на все: он не знает, что именно считает, и новый отчёт не требует
 * нового экрана.
 *
 * Ячейки — уже строки: форматирование денег и количеств отличается на телефоне
 * и в кабинете, и решать это в каждой таблице заново значит однажды разойтись.
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

/** Доля в процентах: маржа и наценка в отчётах по продажам. */
function percent(part: number, whole: number): string {
  if (whole === 0) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

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
      percent(b.profit, b.revenue),
    ]);
  };
}

const PERIOD_COLUMNS: ReportColumn[] = [
  { title: 'Период', width: 240 },
  { title: 'Продаж', width: 110, numeric: true },
  { title: 'Выручка', width: 160, numeric: true },
  { title: 'Себестоимость', width: 170, numeric: true },
  { title: 'Прибыль', width: 160, numeric: true },
  { title: 'Маржа', width: 110, numeric: true },
];

function periodTotal(db: SqlDriver, period: Period): string[] {
  const s = salesSummary(db, period);
  return [
    'Итого',
    String(s.receipts),
    money(s.revenue),
    money(s.cost),
    money(s.profit),
    percent(s.profit, s.revenue),
  ];
}

/**
 * Колонки отчётов по продажам — те же, что подсказывает исходное приложение:
 * выручка без возвратов, прибыль как выручка минус себестоимость, число
 * продаж, количество единиц, маржа (прибыль к выручке) и наценка (прибыль
 * к себестоимости).
 */
const SALES_COLUMNS: ReportColumn[] = [
  { title: 'Наименование', width: 320 },
  { title: 'Выручка', width: 150, numeric: true },
  { title: 'Прибыль', width: 150, numeric: true },
  { title: 'Продаж', width: 110, numeric: true },
  { title: 'Количество', width: 140, numeric: true },
  { title: 'Маржа', width: 100, numeric: true },
  { title: 'Наценка', width: 110, numeric: true },
];

export const REPORTS: ReportDefinition[] = [
  {
    id: 'product',
    title: 'Продажи по товарам',
    note: 'Сумма продаж товара без учёта возвратов, прибыль, маржа и наценка.',
    columns: SALES_COLUMNS,
    rows: (db, period) =>
      topProducts(db, period, 1000).map((p) => [
        p.name,
        money(p.revenue),
        money(p.profit),
        String(p.sales),
        `${formatQtyWeb(p.qty)} ${p.unit}`,
        percent(p.profit, p.revenue),
        percent(p.profit, p.revenue - p.profit),
      ]),
  },
  {
    id: 'categories',
    title: 'Продажи по категориям',
    note: 'То же по категориям товара. Товары без категории идут отдельной строкой.',
    columns: SALES_COLUMNS,
    rows: (db, period) =>
      salesByCategory(db, period).map((c) => [
        c.name,
        money(c.revenue),
        money(c.profit),
        String(c.sales),
        formatQtyWeb(c.qty),
        percent(c.profit, c.revenue),
        percent(c.profit, c.revenue - c.profit),
      ]),
  },
  {
    id: 'set',
    title: 'Продажи по комплектам',
    note: 'Комплектов в справочнике пока нет — товар из нескольких других не заводится.',
    columns: [
      { title: 'Комплект', width: 320 },
      { title: 'Выручка', width: 160, numeric: true },
      { title: 'Продаж', width: 120, numeric: true },
      { title: 'Средняя цена', width: 170, numeric: true },
      { title: 'Количество', width: 140, numeric: true },
    ],
    rows: () => [],
  },
  {
    id: 'day',
    title: 'Продажи по дням',
    note: 'Выручка, себестоимость и прибыль по каждому дню периода.',
    columns: PERIOD_COLUMNS,
    rows: salesOver('day'),
    total: periodTotal,
  },
  {
    id: 'week',
    title: 'Продажи по неделям',
    note: 'То же по неделям. Неделя считается с понедельника.',
    columns: PERIOD_COLUMNS,
    rows: salesOver('week'),
    total: periodTotal,
  },
  {
    id: 'month',
    title: 'Продажи по месяцам',
    note: 'То же по календарным месяцам.',
    columns: PERIOD_COLUMNS,
    rows: salesOver('month'),
    total: periodTotal,
  },
  {
    id: 'motion',
    title: 'Отчёт по движению',
    note: 'Остаток на начало периода, поступило, выбыло и остаток на конец — по каждому товару.',
    columns: [
      { title: 'Товар', width: 340 },
      { title: 'На начало', width: 160, numeric: true },
      { title: 'Поступило', width: 160, numeric: true },
      { title: 'Выбыло', width: 160, numeric: true },
      { title: 'На конец', width: 160, numeric: true },
    ],
    rows: (db, period) =>
      motionByProduct(db, period).map((row) => [
        row.name,
        formatQtyWeb(row.before),
        formatQtyWeb(row.movsIn),
        formatQtyWeb(row.movsOut),
        formatQtyWeb(row.after),
      ]),
  },
  {
    id: 'agent',
    title: 'Отчёт по агентам',
    note: 'Клиенты и поставщики: продажи, возвраты, средний чек и движение денег.',
    columns: [
      { title: 'Контрагент', width: 300 },
      { title: 'Продаж', width: 110, numeric: true },
      { title: 'Сумма продаж', width: 170, numeric: true },
      { title: 'Возвратов', width: 130, numeric: true },
      { title: 'Средний чек', width: 160, numeric: true },
      { title: 'Приход', width: 150, numeric: true },
      { title: 'Расход', width: 150, numeric: true },
    ],
    rows: (db, period) =>
      agentsReport(db, period).map((a) => [
        a.name,
        String(a.salesCount),
        money(a.salesSum),
        String(a.returnCount),
        money(a.average),
        money(a.debit),
        money(a.credit),
      ]),
  },
  {
    id: 'finance',
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
        ['Маржа', percent(s.profit, s.revenue)],
        ['Скидки', money(s.discounts)],
        ['Продаж', String(s.receipts)],
        ['Средний чек', money(s.averageReceipt)],
      ];
    },
  },
  {
    id: 'staff',
    title: 'Отчёт по сотрудникам',
    note: 'Кто сколько пробил. Чеки, пробитые до появления сотрудников, ни за кем не числятся.',
    columns: [
      { title: 'Сотрудник', width: 300 },
      { title: 'Продаж', width: 130, numeric: true },
      { title: 'Возвратов', width: 140, numeric: true },
      { title: 'Сумма продаж', width: 170, numeric: true },
      { title: 'Средний чек', width: 170, numeric: true },
      { title: 'Сумма скидок', width: 170, numeric: true },
      { title: 'Позиций в чеке', width: 170, numeric: true },
    ],
    rows: (db, period) =>
      staffReport(db, period).map((row) => [
        `${row.name} · ${ROLE_LABEL[row.role as Role] ?? row.role}`,
        String(row.salesCount),
        String(row.returnCount),
        money(row.salesSum),
        money(row.average),
        money(row.discounts),
        (row.itemsPerReceipt / 100).toFixed(2).replace('.', ','),
      ]),
  },
  {
    id: 'stock',
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
    id: 'accounts',
    title: 'Отчёт по счетам',
    note: 'Остаток каждого счёта: чеки, документы прихода и расхода, переводы.',
    columns: [
      { title: 'Счёт', width: 280 },
      { title: 'С продаж', width: 160, numeric: true },
      { title: 'Приход', width: 150, numeric: true },
      { title: 'Расход', width: 150, numeric: true },
      { title: 'Остаток', width: 170, numeric: true },
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
];

export function reportById(id: string | undefined): ReportDefinition | null {
  return REPORTS.find((report) => report.id === id) ?? null;
}
