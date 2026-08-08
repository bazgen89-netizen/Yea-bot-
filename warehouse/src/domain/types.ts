import type { Kopecks } from './money';
import type { Milli } from './qty';

export type Id = number;

export interface Category {
  id: Id;
  name: string;
}

export interface Product {
  id: Id;
  name: string;
  sku: string | null;
  barcode: string | null;
  category_id: Id | null;
  unit: string;
  /** Закупочная цена за единицу, копейки. */
  cost_price: Kopecks;
  /** Розничная цена за единицу, копейки. */
  sale_price: Kopecks;
  /** Порог «заканчивается», тысячные. 0 = не следить. */
  min_qty: Milli;
  photo_uri: string | null;
  archived: number;
  created_at: string;
}

/** Товар вместе с посчитанным остатком — то, что показывается в списках. */
export interface ProductWithStock extends Product {
  /** Остаток, тысячные. */
  stock: Milli;
  category_name: string | null;
}

/** Клиент, поставщик или тот и другой сразу. */
export type PartyKind = 'customer' | 'supplier' | 'both';

export interface Counterparty {
  id: Id;
  kind: PartyKind;
  name: string;
  phone: string | null;
  email: string | null;
  note: string | null;
  /** Личная скидка в сотых долях процента: 500 = 5 %. */
  discount_bp: number;
  /** День рождения строкой, как в выгрузке: «13/07/2006». */
  birthday: string | null;
  /** «Мужской» / «Женский». */
  gender: string | null;
  address: string | null;
  /** Кто завёл карточку — имя сотрудника или магазина строкой. */
  created_by: string | null;
  archived: number;
  created_at: string;
}

/** Контрагент вместе с итогами по чекам — то, что показывается в списке. */
export interface CounterpartyWithTotals extends Counterparty {
  /** Сумма всех покупок, копейки. */
  purchases: Kopecks;
  /** Сколько чеков пробито. */
  receipts: number;
  /** Дата последней покупки или null. */
  last_sale_at: string | null;
}

export type DocType = 'receipt' | 'writeoff' | 'adjust';

export interface Doc {
  id: Id;
  type: DocType;
  counterparty: string | null;
  note: string | null;
  created_at: string;
}

export type MoveReason = 'receipt' | 'writeoff' | 'sale' | 'adjust' | 'return';

export interface StockMove {
  id: Id;
  product_id: Id;
  /** Плюс — приход, минус — расход. Тысячные. */
  qty_delta: Milli;
  reason: MoveReason;
  doc_id: Id | null;
  sale_id: Id | null;
  /** Цена за единицу в этом движении, копейки. */
  price: Kopecks;
  created_at: string;
}

export interface Sale {
  id: Id;
  /** Скидка на весь чек, копейки. */
  discount: Kopecks;
  /** К оплате после скидки, копейки. */
  total: Kopecks;
  /** Себестоимость проданного, копейки. */
  cost_total: Kopecks;
  payment: PaymentMethod;
  created_at: string;
}

export type PaymentMethod = 'cash' | 'card' | 'transfer';

export interface SaleItem {
  id: Id;
  sale_id: Id;
  product_id: Id;
  qty: Milli;
  /** Цена продажи за единицу на момент чека, копейки. */
  price: Kopecks;
  /** Себестоимость за единицу на момент чека, копейки. */
  cost_price: Kopecks;
}

/** Позиция корзины до проведения продажи. */
export interface CartLine {
  product_id: Id;
  name: string;
  unit: string;
  qty: Milli;
  price: Kopecks;
  cost_price: Kopecks;
  /** Остаток на складе на момент добавления, для проверки. */
  stock: Milli;
}

/** Позиция документа прихода/списания. */
export interface DocLine {
  product_id: Id;
  name: string;
  unit: string;
  qty: Milli;
  /** Для прихода — закупочная цена за единицу, копейки. */
  price: Kopecks;
}
