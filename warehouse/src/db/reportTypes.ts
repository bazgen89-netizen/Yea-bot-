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
 * Отчёты кабинета — одиннадцать, ровно как на его экране «Выберите тип отчёта».
 *
 * «Оценки склада» среди них нет: в исходном приложении это не отчёт, а
 * отдельный экран справочника (`/catalog/stock`). Я её сюда однажды добавил
 * по ошибке — плитка была, а у него такой плитки не существует.
 *
 * Прежнее описание:
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
  /** Кружок «?» рядом с названием — у него он стоит не у всех колонок. */
  /**
   * Пояснение под кружком «?» — как считается колонка. Тексты его: у него
   * у каждой такой колонки висит своя подсказка, и без неё «Рентабельность»
   * и «Маржинальность» неотличимы на глаз.
   */
  help?: string;
}

export interface ReportDefinition {
  id: string;
  title: string;
  /** Одной строкой: что именно показывает отчёт. */
  note: string;
  columns: ReportColumn[];
  rows: (db: SqlDriver, period: Period) => string[][];
  /**
   * Итог по колонкам. У него он стоит не строкой в таблице, а прямо в шапке,
   * под названием колонки: сумма видна сразу, искать её прокруткой не надо.
   */
  total?: (db: SqlDriver, period: Period) => string[] | null;
  /** По какой колонке отчёт открывается отсортированным. */
  sortColumn?: number;
  /**
   * Отчёт по датам: строки — дни, недели или месяцы подряд. У таких у него в
   * шапке каждой числовой колонки стоит полоска-график, и переключатель
   * «таблица / график» показывает их крупно.
   */
  dates?: boolean;
}

const money = (value: number) => formatMoneyWeb(value);

/**
 * Рентабельность — прибыль к себестоимости продаж, в процентах.
 *
 * Так её считает исходное приложение: в его отчёте по категориям итог
 * 118 814,92 прибыли на 13 292,66 себестоимости показан как 894 %, а
 * убыточный «Белый чай» (−4 753,51 на 8 035,18) — как −59 %.
 *
 * При нулевой себестоимости показывает 0 %, а не прочерк: у него в строках
 * «Матэ» и «в зале», где себестоимости нет, стоит именно ноль.
 */
function percent(part: number, whole: number): string {
  if (whole === 0) return '0%';
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
      money(b.revenue),
      // Возвраты в сводке по дням пока не отделены от продаж: чек с возвратом
      // из выручки исключается целиком. Столбцы есть, чтобы отчёт совпадал
      // по составу, но заполнить их правдой сейчас нечем — и ноль честнее
      // выдуманного числа.
      money(0),
      money(b.revenue - b.profit),
      money(0),
      money(b.profit),
      String(b.receipts),
    ]);
  };
}

/**
 * Колонки отчётов по дням, неделям и месяцам — его собственные, включая
 * возвраты отдельными столбцами: «Сумма возврата» и «Себест. возвратов».
 */
const PERIOD_COLUMNS: ReportColumn[] = [
  { title: 'Наименование', width: 450 },
  { title: 'Сумма продаж', width: 200, numeric: true },
  { title: 'Сумма возврата', width: 210, numeric: true },
  { title: 'Себест. продаж', width: 210, numeric: true },
  { title: 'Себест. возвратов', width: 240, numeric: true },
  { title: 'Прибыль', width: 200, numeric: true, help: 'Выручка минус себестоимость продаж' },
  { title: 'Продажи', width: 180, numeric: true, help: 'Количество продаж товара' },
];

function periodTotal(db: SqlDriver, period: Period): string[] {
  const s = salesSummary(db, period);
  return [
    'ИТОГ',
    money(s.revenue),
    money(0),
    money(s.cost),
    money(0),
    money(s.profit),
    String(s.receipts),
  ];
}

/**
 * Колонки отчёта по категориям — его собственные, вплоть до сокращений:
 * «Себест. продаж», «Продано», «Рентабельность». Названия важны не меньше
 * чисел: по ним человек находит нужный столбец, не читая всю шапку.
 */
const CATEGORY_COLUMNS: ReportColumn[] = [
  { title: 'Наименование', width: 430 },
  { title: 'Выручка', width: 200, numeric: true, help: 'Сумма продаж товара без учета возвратов' },
  { title: 'Прибыль', width: 200, numeric: true, help: 'Выручка минус себестоимость продаж' },
  { title: 'Себест. продаж', width: 260, numeric: true },
  { title: 'Продажи', width: 200, numeric: true, help: 'Количество продаж товара' },
  { title: 'Продано', width: 200, numeric: true, help: 'Количество единиц проданного товара' },
  { title: 'Рентабельность', width: 200, numeric: true, help: 'Отношение прибыли к себестоимости' },
];

/** Отчёт по товарам: то же плюс штрихкод и артикул. */
const PRODUCT_COLUMNS: ReportColumn[] = [
  { title: 'Наименование', width: 430 },
  { title: 'Штрих-код', width: 200 },
  { title: 'Артикул', width: 180 },
  { title: 'Выручка', width: 200, numeric: true, help: 'Сумма продаж товара без учета возвратов' },
  { title: 'Прибыль', width: 200, numeric: true, help: 'Выручка минус себестоимость продаж' },
  { title: 'Себест. продаж', width: 260, numeric: true },
  { title: 'Продажи', width: 200, numeric: true, help: 'Количество продаж товара' },
  { title: 'Продано', width: 200, numeric: true, help: 'Количество единиц проданного товара' },
  { title: 'Рентабельность', width: 200, numeric: true, help: 'Отношение прибыли к себестоимости' },
];

export const REPORTS: ReportDefinition[] = [
  {
    id: 'product',
    title: 'Продажи по товарам',
    note: 'Сумма продаж товара без учёта возвратов, прибыль и рентабельность.',
    columns: PRODUCT_COLUMNS,
    // Отсортировано по прибыли — так этот отчёт открывается у него.
    sortColumn: 4,
    rows: (db, period) =>
      topProducts(db, period, 1000).map((p) => [
        p.name,
        p.barcode ?? '',
        p.sku ?? '',
        money(p.revenue),
        money(p.profit),
        money(p.revenue - p.profit),
        String(p.sales),
        formatQtyWeb(p.qty),
        percent(p.profit, p.revenue - p.profit),
      ]),
    total: (db, period) => {
      const s = salesSummary(db, period);
      return ['ИТОГ', '', '', money(s.revenue), money(s.profit), money(s.cost),
        String(s.receipts), '', percent(s.profit, s.cost)];
    },
  },
  {
    id: 'categories',
    title: 'Продажи по категориям',
    note: 'То же по категориям товара. Товары без категории идут отдельной строкой.',
    columns: CATEGORY_COLUMNS,
    sortColumn: 2,
    rows: (db, period) =>
      salesByCategory(db, period).map((c) => [
        c.name,
        money(c.revenue),
        money(c.profit),
        money(c.revenue - c.profit),
        String(c.sales),
        formatQtyWeb(c.qty),
        percent(c.profit, c.revenue - c.profit),
      ]),
    total: (db, period) => {
      const s = salesSummary(db, period);
      return ['ИТОГ', money(s.revenue), money(s.profit), money(s.cost),
        String(s.receipts), '', percent(s.profit, s.cost)];
    },
  },
  {
    id: 'set',
    title: 'Продажи по комплектам',
    note: 'То же по комплектам: выручка, число продаж, средняя цена и сколько продано.',
    columns: [
      { title: 'Наименование', width: 500 },
      { title: 'Штрих-код', width: 200 },
      { title: 'Артикул', width: 200 },
      { title: 'Выручка', width: 200, numeric: true, help: 'Сумма продаж товара без учета возвратов' },
      { title: 'Продажи', width: 190, numeric: true, help: 'Количество продаж товара' },
      { title: 'Средняя цена', width: 200, numeric: true, help: 'Выручка, делённая на количество проданного' },
      { title: 'Продано', width: 190, numeric: true, help: 'Количество единиц проданного товара' },
    ],
    sortColumn: 3,
    rows: (db, period) =>
      topProducts(db, period, 1000, 'set').map((p) => [
        p.name,
        p.barcode ?? '',
        p.sku ?? '',
        money(p.revenue),
        String(p.sales),
        money(p.sales > 0 ? Math.round(p.revenue / p.sales) : 0),
        formatQtyWeb(p.qty),
      ]),
  },
  {
    id: 'day',
    dates: true,
    title: 'Продажи по дням',
    note: 'Выручка, себестоимость и прибыль по каждому дню периода.',
    columns: PERIOD_COLUMNS,
    rows: salesOver('day'),
    total: periodTotal,
  },
  {
    id: 'week',
    dates: true,
    title: 'Продажи по неделям',
    note: 'То же по неделям. Неделя считается с понедельника.',
    columns: PERIOD_COLUMNS,
    rows: salesOver('week'),
    total: periodTotal,
  },
  {
    id: 'month',
    dates: true,
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
      { title: 'Наименование', width: 450 },
      { title: 'На начало', width: 200, numeric: true },
      { title: 'Поступило', width: 200, numeric: true },
      { title: 'Выбыло', width: 200, numeric: true },
      { title: 'На конец', width: 200, numeric: true },
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
      { title: 'Наименование', width: 430 },
      { title: 'Продажи', width: 180, numeric: true, help: 'Количество продаж товара' },
      { title: 'Сумма продаж', width: 210, numeric: true },
      { title: 'Возвраты', width: 190, numeric: true },
      { title: 'Средний чек', width: 210, numeric: true, help: 'Сумма продаж, делённая на их количество' },
      { title: 'Приход', width: 190, numeric: true },
      { title: 'Расход', width: 190, numeric: true },
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
      { title: 'Наименование', width: 450 },
      { title: 'Значение', width: 260, numeric: true },
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
      { title: 'Наименование', width: 400 },
      { title: 'Продажи', width: 180, numeric: true, help: 'Количество продаж товара' },
      { title: 'Возвраты', width: 190, numeric: true },
      { title: 'Сумма продаж', width: 210, numeric: true },
      { title: 'Средний чек', width: 210, numeric: true, help: 'Сумма продаж, делённая на их количество' },
      { title: 'Сумма скидок', width: 210, numeric: true },
      { title: 'Позиций в чеке', width: 220, numeric: true },
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
    id: 'accounts',
    title: 'Отчёт по счетам',
    note: 'Остаток каждого счёта: чеки, документы прихода и расхода, переводы.',
    columns: [
      { title: 'Наименование', width: 400 },
      { title: 'С продаж', width: 200, numeric: true },
      { title: 'Приход', width: 190, numeric: true },
      { title: 'Расход', width: 190, numeric: true },
      { title: 'Остаток', width: 210, numeric: true },
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
      return ['ИТОГ', '', '', '', money(total)];
    },
  },
];

export function reportById(id: string | undefined): ReportDefinition | null {
  return REPORTS.find((report) => report.id === id) ?? null;
}
