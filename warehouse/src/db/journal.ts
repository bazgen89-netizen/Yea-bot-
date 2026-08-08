import type { SqlDriver, SqlParam } from './driver';
import type { Id } from '../domain/types';
import type { Kopecks } from '../domain/money';

/**
 * Единая лента движения товара: чеки и документы вперемешку, новые сверху.
 *
 * Собирается одним UNION, а не двумя запросами со склейкой в памяти: строки
 * нужно расположить по времени вместе, и сортировать их должна база — иначе
 * постраничная навигация врала бы, показывая на второй странице то, что уже
 * было на первой.
 */

export type JournalKind = 'sale' | 'refund' | 'receipt' | 'writeoff' | 'adjust';

export interface JournalEntry {
  /** Идентификатор внутри своего вида — чеки и документы нумеруются отдельно. */
  id: Id;
  kind: JournalKind;
  created_at: string;
  /** Сколько позиций в документе. */
  positions: number;
  /** Сумма документа, копейки. */
  amount: Kopecks;
  /** Сколько оплачено, копейки. У документов склада оплаты нет. */
  paid: Kopecks | null;
  /** Кто отдал товар: магазин или поставщик. */
  sender: string | null;
  /** Кто получил: покупатель или магазин. */
  receiver: string | null;
}

export function listJournal(db: SqlDriver, limit = 500): JournalEntry[] {
  const params: SqlParam[] = [limit];

  return db.all<JournalEntry>(
    `SELECT * FROM (
       SELECT s.id                                        AS id,
              CASE WHEN EXISTS (
                SELECT 1 FROM stock_moves m
                WHERE m.sale_id = s.id AND m.reason = 'return'
              ) THEN 'refund' ELSE 'sale' END              AS kind,
              s.created_at                                 AS created_at,
              (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id) AS positions,
              s.total                                      AS amount,
              s.total                                      AS paid,
              (SELECT l.name FROM locations l WHERE l.id = s.location_id) AS sender,
              COALESCE(
                (SELECT c.name FROM counterparties c WHERE c.id = s.customer_id),
                'Розничный покупатель'
              )                                            AS receiver
       FROM sales s

       UNION ALL

       SELECT d.id,
              d.type,
              d.created_at,
              (SELECT COUNT(*) FROM stock_moves m WHERE m.doc_id = d.id),
              CAST(ROUND(COALESCE((
                SELECT SUM(ABS(m.qty_delta) * m.price) FROM stock_moves m
                WHERE m.doc_id = d.id
              ), 0) / 1000.0) AS INTEGER),
              NULL,
              d.counterparty,
              (SELECT l.name FROM locations l WHERE l.id = d.location_id)
       FROM docs d
     )
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    params,
  );
}

/** Заголовки в журнале — по дню. Ключ группировки берём из даты без времени. */
export function groupByDay(entries: JournalEntry[]): { day: string; entries: JournalEntry[] }[] {
  const groups: { day: string; entries: JournalEntry[] }[] = [];

  for (const entry of entries) {
    const day = entry.created_at.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }

  return groups;
}

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** «2026-08-08» → «8 августа». */
export function formatDay(day: string): string {
  const [, month, date] = day.split('-');
  const name = MONTHS[Number(month) - 1];
  return name ? `${Number(date)} ${name}` : day;
}

/** «2026-08-08T11:27:03.000Z» → «11:27». */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Название документа в журнале: «Продажа #4784». */
const KIND_LABEL: Record<JournalKind, string> = {
  sale: 'Продажа',
  refund: 'Возврат продажи',
  receipt: 'Закупка',
  writeoff: 'Списание',
  adjust: 'Корректировка',
};

export function entryTitle(entry: JournalEntry): string {
  return `${KIND_LABEL[entry.kind]} #${entry.id}`;
}
