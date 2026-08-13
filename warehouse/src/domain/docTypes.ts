import { DOC_KIND_LABEL, type DocKind } from './types';

/**
 * Чем виды документов отличаются друг от друга.
 *
 * Таблица снята с их собственной: в кабинете это объект `l` в `docService` —
 * у каждого вида там цвет, заголовок, откуда и куда идёт товар, какая цена
 * подставляется, бывает ли скидка и бывает ли оплата. Форма документа у них
 * одна на все восемь видов и читает эту таблицу; у нас так же, поэтому и
 * таблица перенесена целиком, а не разобрана по экранам.
 */

/** Справочник, из которого выбирается сторона документа. */
export type Party = 'stores' | 'clients' | 'suppliers';

/** Куда попадает оплата документа: в приход счёта или в расход. */
export interface PaySide {
  type: 'debit' | 'credit';
  /** Их код источника: 100 — продажа, 200 — закупка, 201 — возврат продажи. */
  source: number;
}

export interface DocTypeSpec {
  /** Виден ли вид в меню «Создать документ». */
  active: boolean;
  /** Цвет вида — им покрашены значок в журнале и заголовок формы. */
  color: string;
  /** Заголовок формы: «Продажа». */
  title: string;
  /** Он же во множественном числе: «Продажи» — заголовок журнала. */
  title2: string;
  from: Party;
  to?: Party;
  /** Какая цена подставляется в позицию: продажная или закупочная. */
  price?: 'price' | 'purchase';
  /** Бывает ли у документа скидка. */
  discount?: boolean;
  /** Бывает ли вкладка «Счета и оплаты». */
  pay?: PaySide;
  /** Можно ли вставить позиции таблицей. */
  excel?: boolean;
}

export const DOC_TYPES: Record<DocKind, DocTypeSpec> = {
  sale: {
    active: true,
    color: '#02A99C',
    title: DOC_KIND_LABEL.sale,
    title2: 'Продажи',
    pay: { type: 'debit', source: 100 },
    from: 'stores',
    to: 'clients',
    discount: true,
    price: 'price',
  },
  purchase: {
    active: true,
    color: '#02A8F8',
    title: DOC_KIND_LABEL.purchase,
    title2: 'Закупки',
    pay: { type: 'credit', source: 200 },
    excel: true,
    from: 'suppliers',
    to: 'stores',
    price: 'purchase',
  },
  sale_return: {
    active: true,
    color: '#FF5350',
    title: DOC_KIND_LABEL.sale_return,
    title2: 'Возвраты продаж',
    pay: { type: 'credit', source: 201 },
    from: 'clients',
    to: 'stores',
    price: 'price',
  },
  purchase_return: {
    active: true,
    color: '#FF723F',
    title: DOC_KIND_LABEL.purchase_return,
    title2: 'Возвраты закупок',
    pay: { type: 'debit', source: 101 },
    from: 'stores',
    to: 'suppliers',
    price: 'purchase',
  },
  inventory: {
    active: true,
    color: '#8C57C6',
    title: DOC_KIND_LABEL.inventory,
    title2: 'Инвентаризации',
    from: 'stores',
  },
  stock_in: {
    active: true,
    color: '#8C57C6',
    title: DOC_KIND_LABEL.stock_in,
    title2: 'Оприходования',
    excel: true,
    from: 'stores',
    price: 'purchase',
  },
  writeoff: {
    active: true,
    color: '#8C57C6',
    title: DOC_KIND_LABEL.writeoff,
    title2: 'Списания',
    excel: true,
    from: 'stores',
    price: 'price',
  },
  transfer: {
    active: true,
    color: '#FF7E02',
    title: DOC_KIND_LABEL.transfer,
    title2: 'Перемещения',
    from: 'stores',
    to: 'stores',
  },
  // Корректировка у них — родительский вид инвентаризации, оприходования и
  // списания, и своей кнопки в меню у неё нет.
  adjustment: {
    active: false,
    color: '#8C57C6',
    title: DOC_KIND_LABEL.adjustment,
    title2: 'Корректировки',
    from: 'stores',
  },
};

/** Подпись поля стороны документа: у перемещения она своя. */
export function partyTitle(kind: DocKind, side: 'from' | 'to'): string {
  if (kind === 'transfer') return side === 'from' ? 'Магазин отправитель' : 'Магазин получатель';
  const spec = DOC_TYPES[kind];
  const party = side === 'from' ? spec.from : spec.to;
  if (party === 'clients') return 'Клиент';
  if (party === 'suppliers') return 'Поставщик';
  return 'Магазин';
}

/**
 * Статус заказа.
 *
 * Их пять, и они не про склад: документ может быть проведён и при этом
 * «В работе». Отдельно от проведения и хранится.
 */
export interface DocState {
  id: number;
  name: string;
  color: string;
}

export const DOC_STATES: DocState[] = [
  { id: 0, name: 'Без статуса', color: '#FFFFFF' },
  { id: 1, name: 'Новый', color: '#A333C8' },
  { id: 2, name: 'В работе', color: '#2185D0' },
  { id: 3, name: 'Закрыт', color: '#21BA45' },
  { id: 4, name: 'Отменен', color: '#DB2828' },
];

/** Заказ бывает только у продажи и закупки — как у них. */
export function hasOrderState(kind: DocKind): boolean {
  return kind === 'sale' || kind === 'purchase';
}

export function stateById(id: number): DocState {
  return DOC_STATES.find((state) => state.id === id) ?? DOC_STATES[0];
}
