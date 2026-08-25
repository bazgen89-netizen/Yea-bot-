import { formatMoneyWeb } from '../domain/money';
import { formatPercent } from '../domain/pricing';
import type { CounterpartyWithTotals, PartyKind } from '../domain/types';

/**
 * Наборы колонок у контрагентов.
 *
 * У него список контрагентов показывается не одной таблицей, а несколькими:
 * сверху выпадающий список, и он переключает весь набор колонок. У клиентов
 * наборов три — «Информация», «Лояльность», «Статистика»; у поставщиков два —
 * «Информация» и «Статистика».
 *
 * Это не украшение. В «Информации» нет ни одной суммы, в «Статистике» нет ни
 * одного адреса: два разных вопроса — «кто это» и «сколько он принёс» — и
 * смешивать их в одной таблице значит заставлять листать вбок мимо
 * ненужного.
 *
 * Подписи из его словаря. Чего нет: «Долг по продажам», «Долг по возвратам»
 * и «Баланс» — мы не ведём долги, и три колонки нулей ничего не сказали бы.
 */

/**
 * Ширины столбцов — снятые с его снимка.
 *
 * Из их же таблицы стилей: клиенты лежат в
 * `.content.full-width.fixed-title` таблицей `ui small celled table scroll
 * main-table`, и там `.fixed-title .ui.table tr td { min-width: 75px }`, а
 * заголовок обрезан по `max-width: 130px`. Отдельные виды столбцов у них
 * жёстко заданы: цена — 100, штрихкод, артикул и страна — 140.
 *
 * То есть ширина у них по содержимому, с полом в 75. Померено по его
 * снимку `card/clients`: имя 274, телефон 110, почта 151, день рождения
 * 144, пол 78, описание 200, адрес 77, добавил 151, создан 95. Пол и адрес
 * стоят у самого пола — они почти всегда пустые.
 */
const W = {
  name: 274,
  phone: 110,
  email: 151,
  bday: 144,
  sex: 78,
  note: 200,
  address: 77,
  by: 151,
  created: 95,
  /** Столбцы статистики и лояльности — по общему полу в 140. */
  cell: 140,
};

export interface PartyColumn {
  key: string;
  title: string;
  width: number;
  numeric?: boolean;
  value: (party: CounterpartyWithTotals) => string;
  /**
   * По чему сортировать, если сортировать по этой колонке можно.
   *
   * Не по тому, что написано в ячейке: «1 000,00» и «900,00» строками
   * сравниваются наоборот. Поэтому число сортируется числом, а текст —
   * строкой без учёта регистра.
   *
   * У него сортируются не все колонки: телефон и почта — нет
   * (`sorting: false` в их `columnSettings`), день рождения, пол, добавил,
   * создан и вся статистика — да.
   */
  sort?: (party: CounterpartyWithTotals) => string | number;
}

/**
 * Отсортировать справочник по колонке.
 *
 * Пусто всегда внизу, в обе стороны: карточка без дня рождения не должна
 * вытеснять заполненные наверх только потому, что «пусто» меньше любой даты.
 */
export function sortParties(
  parties: CounterpartyWithTotals[],
  columns: PartyColumn[],
  sorting: { key: string; reverse: boolean },
): CounterpartyWithTotals[] {
  const column = columns.find((one) => one.key === sorting.key);
  if (!column) return parties;

  const of = (party: CounterpartyWithTotals) => {
    const raw = column.sort ? column.sort(party) : column.value(party);
    if (typeof raw === 'number') return raw;
    const text = raw.trim();
    return text === '' || text === '—' ? null : text.toLowerCase();
  };

  return [...parties].sort((a, b) => {
    const left = of(a);
    const right = of(b);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;

    // Строки сравниваем по русским правилам, а не по кодам букв: «ё» имеет
    // код больше «я», и простое сравнение ставило «Ёлчиев» после «Ясонова».
    const order =
      typeof left === 'string' && typeof right === 'string'
        ? left.localeCompare(right, 'ru')
        : left < right
          ? -1
          : left > right
            ? 1
            : 0;

    return sorting.reverse ? -order : order;
  });
}

export type PartySet = 'basic' | 'loyalty' | 'stats';

/**
 * Колонки, в которых нет ни одного значения, не показываются.
 *
 * Адрес и описание CloudShop по ключу не отдаёт вовсе — и две колонки на пол
 * экрана стояли заполненные прочерками у всех трёх тысяч карточек. Почта
 * есть у двадцати восьми человек из 3206, и её колонка выглядела так же.
 * Пустая колонка не «как у него», а занятое место: из-за неё скидка с
 * бонусами уезжали за правый край, и казалось, что данные не перенеслись.
 *
 * Правило само себя чинит: как только адреса появятся — хоть у одного
 * человека, хоть загрузкой из файла, — колонка вернётся.
 *
 * Наименование и телефон остаются всегда: таблица без них перестаёт быть
 * таблицей клиентов.
 */
const ALWAYS = new Set(['name', 'phone']);

export function usefulColumns(
  columns: PartyColumn[],
  parties: CounterpartyWithTotals[],
): PartyColumn[] {
  if (parties.length === 0) return columns;

  return columns.filter((column) => {
    if (ALWAYS.has(column.key)) return true;
    return parties.some((party) => {
      const value = column.value(party).trim();
      return value !== '' && value !== '—';
    });
  });
}

export const SET_LABEL: Record<PartySet, string> = {
  basic: 'Информация',
  loyalty: 'Лояльность',
  stats: 'Статистика',
};

/** Первые три колонки общие у всех наборов — у него они тоже общие. */
const START: PartyColumn[] = [
  // Первый столбец у него подписан «Клиент» (`CLIENT` в их словаре), а не
  // «Наименование»: наименование бывает у товара, у человека — имя.
  {
    key: 'name',
    title: 'Клиент',
    width: W.name,
    value: (p) => p.name,
    sort: (p) => p.name.toLowerCase(),
  },
  // Телефон и почта у него не сортируются — `sorting: false`.
  { key: 'phone', title: 'Телефон', width: W.phone, value: (p) => p.phone ?? '' },
  { key: 'email', title: 'Email', width: W.email, value: (p) => p.email ?? '' },
];

/**
 * Пусто у него подписано обычным дефисом — и только у дня рождения.
 * У пола, описания и адреса пустая ячейка остаётся пустой.
 */
const dash = (value: string | null) => value ?? '-';

/**
 * День рождения — через косую черту, как у него: «13/07/2006».
 *
 * В базе он лежит строкой из выгрузки, и у перенесённых записей разделитель
 * может быть точкой. Приводим к его виду при показе, не трогая саму запись.
 */
function birthdayText(value: string | null): string {
  return value ? value.replace(/[.-]/g, '/') : '-';
}

/**
 * «Информация» — его набор и его порядок.
 *
 * Взят из их же `columnSettings.basic` в `main-*.js`: телефон, почта, день
 * рождения, пол, описание, адрес, добавил, создан. Скидку и бонусы я
 * когда-то вставил сюда «чтобы главное было видно сразу» — у него они
 * живут в «Лояльности», и от моей самодеятельности сбивался весь порядок
 * колонок.
 */
const BASIC_CUSTOMER: PartyColumn[] = [
  ...START,
  {
    key: 'bday',
    title: 'День рождения',
    width: W.bday,
    value: (p) => birthdayText(p.birthday),
    // Дата в выгрузке лежит как «13/07/2006»: строкой такое сортируется по
    // дню, а не по году.
    sort: (p) => birthdayKey(p.birthday),
  },
  { key: 'sex', title: 'Пол', width: W.sex, value: (p) => p.gender ?? '', sort: (p) => p.gender ?? '' },
  { key: 'note', title: 'Описание', width: W.note, value: (p) => p.note ?? '' },
  { key: 'address', title: 'Адрес', width: W.address, value: (p) => p.address ?? '' },
  {
    key: 'by',
    title: 'Добавил',
    width: W.by,
    value: (p) => p.created_by ?? '',
    sort: (p) => p.created_by ?? '',
  },
  {
    key: 'created',
    title: 'Создан',
    width: W.created,
    value: (p) => day(p.created_at),
    sort: (p) => p.created_at,
  },
];

/** «13/07/2006» → «2006-07-13», чтобы сортировалось по годам. */
function birthdayKey(birthday: string | null): string {
  if (!birthday) return '';
  const parts = birthday.split(/[./-]/);
  if (parts.length !== 3) return birthday;
  const [d, m, y] = parts;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

const BASIC_SUPPLIER: PartyColumn[] = [
  ...START,
  { key: 'note', title: 'Описание', width: W.note, value: (p) => p.note ?? '' },
  { key: 'address', title: 'Адрес', width: W.address, value: (p) => p.address ?? '' },
  { key: 'by', title: 'Добавил', width: W.cell, value: (p) => p.created_by ?? '' },
  { key: 'created', title: 'Создан', width: W.cell, value: (p) => day(p.created_at) },
];

const LOYALTY: PartyColumn[] = [
  ...START,
  { key: 'card', title: 'Номер карты лояльности', width: W.cell, value: (p) => dash(p.discount_card) },
  {
    key: 'type',
    title: 'Система лояльности',
    width: W.cell,
    value: (p) => LOYALTY_LABEL[p.loyalty_type ?? ''] ?? '—',
  },
  { key: 'bday', title: 'День рождения', width: W.bday, value: (p) => birthdayText(p.birthday) },
  {
    key: 'discount',
    title: 'Скидка',
    width: W.cell,
    numeric: true,
    value: (p) => (p.discount_bp ? formatPercent(p.discount_bp) : '—'),
    sort: (p) => p.discount_bp ?? 0,
  },
  {
    key: 'bonus',
    title: 'Бонусов',
    width: W.cell,
    numeric: true,
    value: (p) => formatMoneyWeb(p.bonus_balance),
  },
  {
    key: 'bonusSpent',
    title: 'Потрачено бонусов',
    width: W.cell,
    numeric: true,
    value: (p) => formatMoneyWeb(p.bonus_spent),
  },
  {
    key: 'cashback',
    title: 'Кешбэк',
    width: W.cell,
    numeric: true,
    value: (p) => (p.cashback_bp ? formatPercent(p.cashback_bp) : '—'),
    sort: (p) => p.cashback_bp ?? 0,
  },
];

const STATS_CUSTOMER: PartyColumn[] = [
  ...START,
  { key: 'sales', title: 'Кол-во продаж', width: W.cell, numeric: true, value: (p) => String(p.receipts) },
  {
    key: 'salesSum',
    title: 'Сумма продаж',
    width: W.cell,
    numeric: true,
    value: (p) => formatMoneyWeb(p.purchases),
    sort: (p) => p.purchases,
  },
  {
    key: 'debit',
    title: 'Сумма приходов',
    width: W.cell,
    numeric: true,
    value: (p) => formatMoneyWeb(p.debit_sum),
    sort: (p) => p.debit_sum,
  },
  {
    key: 'avg',
    title: 'Средний чек',
    width: W.cell,
    numeric: true,
    value: (p) => (p.receipts ? formatMoneyWeb(Math.round(p.purchases / p.receipts)) : '—'),
  },
  {
    key: 'returns',
    title: 'Кол-во возвратов продаж',
    width: W.cell,
    numeric: true,
    value: (p) => String(p.returns),
    sort: (p) => p.returns,
  },
  {
    key: 'returnsSum',
    title: 'Сумма возврата',
    width: W.cell,
    numeric: true,
    value: (p) => formatMoneyWeb(p.returns_sum),
    sort: (p) => p.returns_sum,
  },
  {
    key: 'credit',
    title: 'Сумма расходов',
    width: W.cell,
    numeric: true,
    value: (p) => formatMoneyWeb(p.credit_sum),
    sort: (p) => p.credit_sum,
  },
  // Три последних столбца у него замыкают «Статистику», а у меня их не было
  // вовсе — набор обрывался на расходах.
  {
    key: 'debt',
    title: 'Долг по продажам',
    width: W.cell,
    numeric: true,
    value: (p) => formatMoneyWeb(p.debt_sales),
    sort: (p) => p.debt_sales,
  },
  {
    key: 'rdebt',
    title: 'Долг по возвратам',
    width: W.cell,
    numeric: true,
    // Долгов по возвратам мы не заводим: возврат отдаёт деньги сразу.
    value: () => formatMoneyWeb(0),
  },
  {
    key: 'balance',
    title: 'Баланс',
    width: W.cell,
    numeric: true,
    value: (p) => formatMoneyWeb(p.debit_sum - p.credit_sum),
    sort: (p) => p.debit_sum - p.credit_sum,
  },
];

const STATS_SUPPLIER: PartyColumn[] = [
  ...START,
  {
    key: 'purchases',
    title: 'Количество закупок',
    width: W.cell,
    numeric: true,
    value: (p) => String(p.purchases_count),
  },
  {
    key: 'purchasesSum',
    title: 'Сумма закупок',
    width: W.cell,
    numeric: true,
    value: (p) => formatMoneyWeb(p.purchases_sum),
  },
  {
    key: 'credit',
    title: 'Сумма расходов',
    width: W.cell,
    numeric: true,
    value: (p) => formatMoneyWeb(p.credit_sum),
    sort: (p) => p.credit_sum,
  },
  {
    key: 'purchaseReturns',
    title: 'Количество возвратов закупок',
    width: W.cell,
    numeric: true,
    value: (p) => String(p.purchase_returns),
  },
  {
    key: 'purchaseReturnsSum',
    title: 'Сумма возвратов закупок',
    width: W.cell,
    numeric: true,
    value: (p) => formatMoneyWeb(p.purchase_returns_sum),
  },
  {
    key: 'debit',
    title: 'Сумма приходов',
    width: W.cell,
    numeric: true,
    value: (p) => formatMoneyWeb(p.debit_sum),
    sort: (p) => p.debit_sum,
  },
];

export const LOYALTY_LABEL: Record<string, string> = {
  discount: 'Скидка',
  bonus: 'Бонусы',
};

/** Какие наборы есть у этого вида контрагента и что в каждом. */
export function partySets(kind: PartyKind): { key: PartySet; columns: PartyColumn[] }[] {
  if (kind === 'supplier') {
    return [
      { key: 'basic', columns: BASIC_SUPPLIER },
      { key: 'stats', columns: STATS_SUPPLIER },
    ];
  }

  return [
    { key: 'basic', columns: BASIC_CUSTOMER },
    { key: 'loyalty', columns: LOYALTY },
    { key: 'stats', columns: STATS_CUSTOMER },
  ];
}

/** «08/07/2023» — так дата подписана у него, через косые черты. */
function day(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}
