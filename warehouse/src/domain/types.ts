import type { Kopecks } from './money';
import type { Milli } from './qty';

export type Id = number;

export interface Category {
  id: Id;
  name: string;
}

/**
 * Вид позиции — так их описывает исходное приложение:
 * товар имеет остаток, услуга не имеет, комплект состоит из других.
 */
export type ProductKind = 'product' | 'service' | 'set';

export const PRODUCT_KIND_LABEL: Record<ProductKind, string> = {
  product: 'Товар',
  service: 'Услуга',
  set: 'Комплект',
};

export const PRODUCT_KIND_HINT: Record<ProductKind, string> = {
  product: 'Продукт, имеющий остаток, который необходимо восполнять',
  service: 'Продукт, не имеющий остатка на складе',
  set: 'Продукт, состоящий из нескольких других',
};

export interface Product {
  id: Id;
  name: string;
  kind: ProductKind;
  sku: string | null;
  /** Внутренний код товара — отдельно от артикула поставщика. */
  code: string | null;
  barcode: string | null;
  category_id: Id | null;
  unit: string;
  /** Закупочная цена за единицу, копейки. */
  cost_price: Kopecks;
  /** Розничная цена за единицу, копейки. */
  sale_price: Kopecks;
  /** Порог «заканчивается», тысячные. 0 = не следить. */
  min_qty: Milli;
  /** Ставка НДС в сотых долях процента: 2000 = 20 %. NULL — без НДС. */
  vat_bp: number | null;
  /** Срок годности, YYYY-MM-DD. */
  expires_at: string | null;
  /** Скидка на товар в сотых долях процента: 500 = 5 %. */
  discount_bp: number;
  /** Цена последней закупки, копейки. Отдельно от средней себестоимости. */
  purchase_price: Kopecks;
  country: string | null;
  supplier_id: Id | null;
  description: string | null;
  /** Код для весов. */
  plu_code: string | null;
  gtin: string | null;
  /** Продаётся долями единицы. */
  weighted: number;
  height_mm: number | null;
  width_mm: number | null;
  depth_mm: number | null;
  weight_g: number | null;
  /** Кассир может изменить цену в чеке. */
  free_price: number;
  /** Продаётся по цене магазина. */
  store_price: number;
  /** Код товарной группы «Честного знака»: «01» — обувь, «12» — молоко. */
  marking_type: string | null;
  /** Система налогообложения: «04» — УСН Доход. */
  tax_system: string | null;
  /** Подакцизный товар. */
  excisable: number;
  photo_uri: string | null;
  archived: number;
  created_at: string;
}

/** Товар вместе с посчитанным остатком — то, что показывается в списках. */
export interface ProductWithStock extends Product {
  /** Остаток, тысячные. */
  stock: Milli;
  category_name: string | null;
  supplier_name: string | null;
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
  /** Номер карты лояльности. */
  discount_card: string | null;
  /** 'discount' — скидка процентом, 'bonus' — бонусный счёт, null — ничего. */
  loyalty_type: string | null;
  /** Бонусный счёт, копейки: бонус приравнен к рублю. */
  bonus_balance: Kopecks;
  bonus_spent: Kopecks;
  /** Кешбэк в сотых долях процента. */
  cashback_bp: number;
  /** 'person' — физическое лицо, 'company' — организация. */
  party_type: string;
  /** Подставляется в документ по умолчанию. */
  is_default: number;
  /** Считать скидку по накопительным правилам, а не по личному проценту. */
  enable_savings: number;
  /** Телефоны списком, JSON: рабочий и личный. */
  phones: string;
  /** Реквизиты организации и банковские — списки «название → номер», JSON. */
  details: string;
  bank_details: string;
  account_number: string | null;
  legal_address: string | null;
  archived: number;
  created_at: string;
}

/** Контрагент вместе с итогами по чекам — то, что показывается в списке. */
export interface CounterpartyWithTotals extends Counterparty {
  /** Сумма всех покупок, копейки. */
  purchases: Kopecks;
  /** Сколько по этим покупкам осталось за ним, копейки. */
  debt_sales: Kopecks;
  /** Сколько чеков пробито. */
  receipts: number;
  /** Дата последней покупки или null. */
  last_sale_at: string | null;
  /** Сколько чеков вернули и на какую сумму. */
  returns: number;
  returns_sum: Kopecks;
  /** Деньги, пришедшие от него и ушедшие ему, копейки. */
  debit_sum: Kopecks;
  credit_sum: Kopecks;
  /** Закупки у поставщика: сколько документов и на какую сумму. */
  purchases_count: number;
  purchases_sum: Kopecks;
  purchase_returns: number;
  purchase_returns_sum: Kopecks;
}

/** Что документ делает со складом: приходует, списывает или выравнивает. */
export type DocType = 'receipt' | 'writeoff' | 'adjust';

/**
 * Чем документ является для пользователя.
 *
 * Отделено от `DocType` потому, что складское действие и название документа —
 * разные вещи: закупка и оприходование одинаково приходуют товар, но у первой
 * есть поставщик и цена, а вторая объясняет, откуда товар взялся без закупки.
 */
export type DocKind =
  | 'sale'
  | 'sale_return'
  | 'purchase'
  | 'purchase_return'
  | 'stock_in'
  | 'writeoff'
  | 'transfer'
  | 'inventory'
  | 'adjustment';

/** Название документа так, как оно написано в кабинете. */
export const DOC_KIND_LABEL: Record<DocKind, string> = {
  sale: 'Продажа',
  sale_return: 'Возврат продажи',
  purchase: 'Закупка',
  purchase_return: 'Возврат закупки',
  stock_in: 'Оприходование',
  writeoff: 'Списание',
  transfer: 'Перемещение',
  inventory: 'Инвентаризация',
  adjustment: 'Корректировка',
};

/** Как вид документа двигает склад. */
export const DOC_KIND_TYPE: Record<DocKind, DocType> = {
  // Продажа документом — не чек: её проводят из кабинета, когда товар
  // отгружают по накладной. Склад она двигает так же, как чек.
  sale: 'writeoff',
  sale_return: 'receipt',
  purchase: 'receipt',
  purchase_return: 'writeoff',
  stock_in: 'receipt',
  writeoff: 'writeoff',
  // Перемещение списывает в одном магазине и приходует в другом; ведущей
  // считаем расходную сторону, чтобы документ не удваивался в сводках.
  transfer: 'writeoff',
  inventory: 'adjust',
  adjustment: 'adjust',
};

/**
 * Вид документа по тому, что записано в базе.
 *
 * У документов, заведённых до появления видов, `subtype` пуст — тогда вид
 * восстанавливается по складскому действию.
 */
export function docKind(doc: { type: DocType; subtype?: string | null }): DocKind {
  if (doc.subtype && doc.subtype in DOC_KIND_LABEL) return doc.subtype as DocKind;
  if (doc.type === 'receipt') return 'purchase';
  if (doc.type === 'writeoff') return 'writeoff';
  return 'adjustment';
}

export interface Doc {
  id: Id;
  type: DocType;
  /** Вид документа; пусто у документов, заведённых до появления видов. */
  subtype: DocKind | null;
  counterparty: string | null;
  note: string | null;
  created_at: string;
  location_id: Id | null;
  /** Магазин-получатель у перемещения. */
  location_to: Id | null;
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
  /** Свой номер документа — у перенесённых чеков номер CloudShop. */
  number: number | null;
  /** Номер прихода: под ним чек виден в движении денег. */
  money_number: number | null;
  /** Кто пробил чек — учётная запись, если своего сотрудника нет. */
  author: string | null;
  /** Сколько осталось за покупателем, копейки. */
  debt: Kopecks;
  /** Бонусы по чеку: начислено и списано, копейки. */
  bonus_earned: Kopecks;
  bonus_used: Kopecks;
  /**
   * Покупатель чека; `null` — розничный.
   *
   * Нужен просмотру документа: у него имя клиента — ссылка в его карточку,
   * а по имени карточку не найти, тёзок в базе на три тысячи человек хватает.
   */
  customer_id: Id | null;
  /**
   * Комментарий к чеку — их поле `comment`.
   *
   * По нему в журнале стоит значок у названия документа, а в самом документе
   * — кремовая плашка над «Оплатой». Имя покупателя без карточки сюда не
   * пишется: для него есть своё поле, иначе значок загорался бы у чеков, где
   * комментария никто не оставлял.
   */
  note: string | null;
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
  /**
   * Скидка по этой строке, копейки.
   *
   * У него скидка стоит в строке документа, а не одной суммой на чек: одну
   * позицию можно отдать даром, а остальные продать по цене.
   */
  discount: Kopecks;
}

/** Позиция корзины до проведения продажи. */
export interface CartLine {
  product_id: Id;
  name: string;
  unit: string;
  qty: Milli;
  price: Kopecks;
  cost_price: Kopecks;
  /**
   * Скидка на саму позицию, сотые доли процента: 1000 = 10 %.
   *
   * Берётся из карточки товара. Это не то же самое, что скидка на чек: её
   * дают на конкретный товар — распродажа, уценка, — и она действует
   * независимо от того, кто покупает и что ещё лежит в чеке.
   */
  discount_bp?: number;
  /** Остаток на складе на момент добавления, для проверки. */
  stock: Milli;
  /**
   * Снимок товара — чтобы касса показывала его в чеке справа.
   *
   * Кассир выбирает товар по картинке в плитке, а в чеке видел только
   * название: «Чай с собой большой стакан» и «Чай с собой средний стакан»
   * различаются одним словом, и на бегу их легко перепутать.
   */
  photo_uri?: string | null;
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
