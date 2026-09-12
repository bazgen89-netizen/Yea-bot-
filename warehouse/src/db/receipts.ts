import type { SqlDriver } from './driver';
import type { Kopecks } from '../domain/money';
import type { Milli } from '../domain/qty';
import type { Id, PaymentMethod } from '../domain/types';

/**
 * Журнал чеков кассы.
 *
 * Отдельно от `listSales`, которым живёт кабинет: там нужна короткая строка
 * в таблице, а здесь — карточка чека целиком. Кассир открывает журнал не
 * ради статистики, а чтобы найти конкретную покупку: кто её пробил, в каком
 * магазине, кому и что именно, чтобы напечатать заново или вернуть.
 *
 * Поэтому запрос сразу подтягивает имена сотрудника, магазина и покупателя.
 * Дотягивать их потом, по одному запросу на карточку, значило бы сто
 * запросов на сотню чеков.
 */
export interface Receipt {
  id: Id;
  total: Kopecks;
  discount: Kopecks;
  debt: Kopecks;
  payment: PaymentMethod;
  note: string | null;
  created_at: string;
  /** Кто пробил. Пусто — чек до появления сотрудников. */
  staff: string | null;
  /** Магазин. Пусто — чек до появления магазинов. */
  location: string | null;
  /** Покупатель. Пусто — розничный. */
  customer: string | null;
  /** Сколько позиций в чеке. */
  positions: number;
  /** Был ли по чеку возврат. */
  refunded: number;
}

/** Позиция чека — для раскрытого «Списка товаров». */
export interface ReceiptLine {
  name: string;
  qty: Milli;
  price: Kopecks;
  total: Kopecks;
}

export interface ReceiptFilter {
  /**
   * День, за который смотрим, в виде `YYYY-MM-DD`. Пусто — все дни подряд.
   *
   * День, а не отрезок: у них в фильтре одна кнопка «Выберите дату», и
   * кассир ищет чек, который помнит по дню, а не по неделе.
   */
  date?: string | null;
  /** Номер документа. Ищется вхождением: «48» найдёт и 48, и 4880. */
  number?: string | null;
  /** Покупатель. */
  customerId?: Id | null;
  /** Товар: остаются чеки, в которых он есть. */
  productId?: Id | null;
  limit?: number;
}

export function receiptJournal(db: SqlDriver, filter: ReceiptFilter = {}): Receipt[] {
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (filter.date) {
    // Время чека хранится по Гринвичу, а день кассир выбирает свой. В Москве
    // чек, пробитый в 02:30, лежит в базе вчерашним — по строке ISO он бы в
    // выбранный день не попал. Поэтому день сравниваем после перевода
    // во время машины, а не отрезаем первые десять знаков строки.
    where.push("date(s.created_at, 'localtime') = ?");
    params.push(filter.date);
  }

  if (filter.number) {
    where.push('CAST(s.id AS TEXT) LIKE ?');
    params.push(`%${filter.number}%`);
  }

  if (filter.customerId) {
    where.push('s.customer_id = ?');
    params.push(filter.customerId);
  }

  if (filter.productId) {
    where.push('EXISTS (SELECT 1 FROM sale_items i WHERE i.sale_id = s.id AND i.product_id = ?)');
    params.push(filter.productId);
  }

  params.push(filter.limit ?? 200);

  return db.all<Receipt>(
    `SELECT s.id, s.total, s.discount, s.debt, s.payment, s.note, s.created_at,
            e.name AS staff,
            l.name AS location,
            c.name AS customer,
            (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) AS positions,
            (SELECT COUNT(*) FROM stock_moves m
              WHERE m.sale_id = s.id AND m.reason = 'return') > 0 AS refunded
       FROM sales s
       LEFT JOIN staff e         ON e.id = s.staff_id
       LEFT JOIN locations l     ON l.id = s.location_id
       LEFT JOIN counterparties c ON c.id = s.customer_id
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT ?`,
    params,
  );
}

export function receiptLines(db: SqlDriver, saleId: Id): ReceiptLine[] {
  return db.all<ReceiptLine>(
    `SELECT p.name AS name, i.qty AS qty, i.price AS price,
            i.qty * i.price / 1000 AS total
       FROM sale_items i
       JOIN products p ON p.id = i.product_id
      WHERE i.sale_id = ?
      ORDER BY i.id`,
    [saleId],
  );
}

/**
 * День чека по местному времени, `YYYY-MM-DD`.
 *
 * Отрезать первые десять знаков от строки ISO нельзя: там время по Гринвичу,
 * и ночные чеки уехали бы в соседний день — тот самый, по которому кассир их
 * потом не найдёт.
 */
export function localDay(iso: string): string {
  const when = new Date(iso);
  return `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`;
}

/**
 * Дни, в которые были чеки, — для подписей-разделителей в журнале.
 *
 * Считается из тех же чеков, что уже загружены, а не отдельным запросом:
 * иначе в списке появился бы день, чеков которого в нём нет.
 */
export function groupByDay(receipts: Receipt[]): { day: string; receipts: Receipt[] }[] {
  const days: { day: string; receipts: Receipt[] }[] = [];

  for (const receipt of receipts) {
    const day = localDay(receipt.created_at);
    const last = days[days.length - 1];
    if (last && last.day === day) last.receipts.push(receipt);
    else days.push({ day, receipts: [receipt] });
  }

  return days;
}
