import type { SqlDriver, SqlParam } from './driver';
import { KIND_SQL, ONE_SIDE } from './stock';
import { DOC_KIND_LABEL, type DocKind, type Id } from '../domain/types';
import { MONEY_TYPE_LABEL, type MoneyType } from './money';
import type { Kopecks } from '../domain/money';

/**
 * Единая лента движения товара: чеки и документы вперемешку, новые сверху.
 *
 * Собирается одним UNION, а не двумя запросами со склейкой в памяти: строки
 * нужно расположить по времени вместе, и сортировать их должна база — иначе
 * постраничная навигация врала бы, показывая на второй странице то, что уже
 * было на первой.
 */

/** Чеки нумеруются и называются отдельно от складских документов. */
export type JournalKind = 'sale' | 'refund' | DocKind;

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
              ${KIND_SQL},
              d.created_at,
              (SELECT COUNT(*) FROM stock_moves m
               WHERE m.doc_id = d.id AND ${ONE_SIDE}),
              CAST(ROUND(COALESCE((
                SELECT SUM(ABS(m.qty_delta) * m.price) FROM stock_moves m
                WHERE m.doc_id = d.id AND ${ONE_SIDE}
              ), 0) / 1000.0) AS INTEGER),
              NULL,
              -- У перемещения отправитель и получатель — магазины, у остальных
              -- документов слева контрагент, справа магазин.
              CASE WHEN d.subtype = 'transfer'
                   THEN (SELECT l.name FROM locations l WHERE l.id = d.location_id)
                   ELSE d.counterparty END,
              CASE WHEN d.subtype = 'transfer'
                   THEN (SELECT l.name FROM locations l WHERE l.id = d.location_to)
                   ELSE (SELECT l.name FROM locations l WHERE l.id = d.location_id) END
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
  ...DOC_KIND_LABEL,
};

export function entryTitle(entry: JournalEntry): string {
  return `${KIND_LABEL[entry.kind] ?? 'Документ'} #${entry.id}`;
}

/**
 * Лента движения денег: приходы и расходы по счетам.
 *
 * Приход по продаже отдельным документом не заводится — он берётся из самого
 * чека: деньги в кассе появляются ровно тогда, когда пробита продажа, и вторая
 * запись об этом событии стала бы вторым источником правды. А аренда, зарплата
 * и перевод между счетами чеком не сопровождаются — они приходят из `money_docs`.
 */
export interface MoneyEntry {
  id: Id;
  /** Из чего строка: из чека или из заведённого руками документа. */
  source: 'sale' | 'doc';
  type: MoneyType;
  created_at: string;
  /** Поступило, копейки. */
  income: Kopecks;
  /** Списано, копейки. */
  expense: Kopecks;
  counterparty: string;
  /** Куда легли деньги: касса магазина, терминал, счёт в банке. */
  account: string;
  category: string;
}

/** Способ оплаты — это и есть счёт, на который попали деньги. */
const ACCOUNT: Record<string, string> = {
  cash: 'Касса магазина',
  card: 'Терминал / Счет в банке',
  transfer: 'Счет в банке',
};

export function listMoney(db: SqlDriver, limit = 500): MoneyEntry[] {
  const rows = db.all<MoneyEntry & { payment: string | null }>(
    `SELECT * FROM (
       SELECT s.id                    AS id,
              'sale'                  AS source,
              'income'                AS type,
              s.created_at            AS created_at,
              s.total                 AS income,
              0                       AS expense,
              COALESCE(
                (SELECT c.name FROM counterparties c WHERE c.id = s.customer_id),
                'Розничный покупатель'
              )                       AS counterparty,
              s.payment               AS payment,
              ''                      AS account,
              'Оплата от клиента'     AS category
       FROM sales s
       WHERE NOT EXISTS (
         SELECT 1 FROM stock_moves m WHERE m.sale_id = s.id AND m.reason = 'return'
       )

       UNION ALL

       SELECT d.id,
              'doc',
              d.type,
              d.created_at,
              CASE WHEN d.type = 'expense' THEN 0 ELSE d.amount END,
              CASE WHEN d.type = 'income'  THEN 0 ELSE d.amount END,
              COALESCE(
                d.counterparty,
                (SELECT c.name FROM counterparties c WHERE c.id = d.counterparty_id),
                ''
              ),
              NULL,
              -- Перевод показывается одной строкой «откуда → куда»: две строки
              -- об одном переводе выглядели бы как два разных движения.
              CASE WHEN d.type = 'transfer'
                   THEN d.account || ' → ' || COALESCE(d.account_to, '')
                   ELSE d.account END,
              COALESCE(d.category, '')
       FROM money_docs d
     )
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [limit],
  );

  return rows.map((row) => ({
    ...row,
    account: row.payment === null ? row.account : (ACCOUNT[row.payment] ?? row.payment),
  }));
}

/** «Приход #45679» — так документ называется в движении денег. */
export function moneyTitle(entry: MoneyEntry): string {
  return `${MONEY_TYPE_LABEL[entry.type]} #${entry.id}`;
}

/** Группировка по дням — та же, что в движении товара. */
export function groupMoneyByDay(entries: MoneyEntry[]): { day: string; entries: MoneyEntry[] }[] {
  const groups: { day: string; entries: MoneyEntry[] }[] = [];

  for (const entry of entries) {
    const day = entry.created_at.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.entries.push(entry);
    else groups.push({ day, entries: [entry] });
  }

  return groups;
}
