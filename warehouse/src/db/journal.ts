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
  /**
   * Свой номер документа.
   *
   * У перенесённой истории он уже был: тот же чек в CloudShop называется
   * «Продажа #45658», и человек ищет его именно по этому номеру. Пусто — у
   * документов, заведённых здесь: у них номер и есть внутренний.
   */
  number: number | null;
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
  /** Кто провёл документ. */
  author: string | null;
  /** Комментарий — по нему тоже ищут. */
  note: string | null;
  /**
   * Скидка по документу, копейки.
   *
   * Нужна журналу: в кабинете сразу за суммой стоит узкая колонка со
   * значком «%», и он отмечает те документы, где скидка была. У складских
   * документов скидки нет — там всегда ноль.
   */
  discount: Kopecks;
  /** 1 — проведён, 0 — отложен. У чеков всегда 1. */
  posted: number;
}

/**
 * Отбор в журнале движения товара.
 *
 * Поля — его: поиск по номеру или комментарию, дата, отправитель, получатель,
 * автор, тип документа, оплата, статус. Одного его поля нет — «Фискальный
 * чек»: мы чеки не фискализируем, и фильтр по тому, чего не бывает, только
 * мешает.
 */
export interface JournalFilter {
  /** Номер документа или слово из комментария. */
  search?: string;
  /** Диапазон дат, YYYY-MM-DD включительно. */
  from?: string;
  to?: string;
  sender?: string;
  receiver?: string;
  author?: string;
  kinds?: JournalKind[];
  /** Оплаченные или неоплаченные. У складских документов оплаты нет. */
  paid?: 'paid' | 'unpaid';
  /** Проведённые или отложенные. */
  status?: 'posted' | 'draft';
}

export function listJournal(
  db: SqlDriver,
  limit = 500,
  filter: JournalFilter = {},
): JournalEntry[] {
  const params: SqlParam[] = [];
  const where: string[] = [];

  const add = (sql: string, ...values: SqlParam[]) => {
    where.push(sql);
    params.push(...values);
  };

  if (filter.search?.trim()) {
    const text = filter.search.trim().toLowerCase();
    // Номер ищется точным совпадением, остальное — по вхождению: «12» не
    // должно находить документ №120, иначе поиск по номеру бесполезен.
    add("(CAST(id AS TEXT) = ? OR LOWER(COALESCE(note, '')) LIKE ?)", text, `%${text}%`);
  }
  if (filter.from) add('date(created_at) >= ?', filter.from);
  if (filter.to) add('date(created_at) <= ?', filter.to);
  if (filter.sender) add('sender = ?', filter.sender);
  if (filter.receiver) add('receiver = ?', filter.receiver);
  if (filter.author) add('author = ?', filter.author);
  if (filter.kinds?.length) {
    add(`kind IN (${filter.kinds.map(() => '?').join(', ')})`, ...filter.kinds);
  }
  if (filter.paid === 'paid') add('paid IS NOT NULL AND paid >= amount');
  if (filter.paid === 'unpaid') add('(paid IS NULL OR paid < amount)');
  if (filter.status === 'posted') add('posted = 1');
  if (filter.status === 'draft') add('posted = 0');

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);

  return db.all<JournalEntry>(
    `SELECT * FROM (
       SELECT s.id                                        AS id,
              s.number                                     AS number,
              -- Свой возврат узнаётся по движению склада, перенесённый —
              -- по признаку в самом чеке: у перенесённой истории движений
              -- нет вовсе, она склад не трогает.
              CASE WHEN s.is_return = 1 OR EXISTS (
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
              )                                            AS receiver,
              -- Свой сотрудник, если чек пробит здесь; иначе учётная запись,
              -- из которой он пришёл при переносе.
              COALESCE(
                (SELECT f.name FROM staff f WHERE f.id = s.staff_id),
                s.author
              )                                            AS author,
              s.note                                       AS note,
              s.discount                                   AS discount,
              1                                            AS posted
       FROM sales s

       UNION ALL

       SELECT d.id,
              NULL,
              ${KIND_SQL},
              d.created_at,
              -- У отложенного документа движений нет вовсе, и позиции с суммой
              -- берутся из его строк: иначе он показался бы пустым.
              CASE WHEN d.posted = 1
                   THEN (SELECT COUNT(*) FROM stock_moves m
                         WHERE m.doc_id = d.id AND ${ONE_SIDE})
                   ELSE (SELECT COUNT(*) FROM doc_lines l WHERE l.doc_id = d.id) END,
              CASE WHEN d.posted = 1
                   THEN CAST(ROUND(COALESCE((
                          SELECT SUM(ABS(m.qty_delta) * m.price) FROM stock_moves m
                          WHERE m.doc_id = d.id AND ${ONE_SIDE}
                        ), 0) / 1000.0) AS INTEGER)
                   ELSE CAST(ROUND(COALESCE((
                          SELECT SUM(l.qty * l.price) FROM doc_lines l
                          WHERE l.doc_id = d.id
                        ), 0) / 1000.0) AS INTEGER) END,
              (SELECT SUM(p.amount) FROM doc_payments p
               WHERE p.doc_id = d.id AND p.paid = 1),
              -- У перемещения отправитель и получатель — магазины, у остальных
              -- документов слева контрагент, справа магазин.
              CASE WHEN d.subtype = 'transfer'
                   THEN (SELECT l.name FROM locations l WHERE l.id = d.location_id)
                   ELSE d.counterparty END,
              CASE WHEN d.subtype = 'transfer'
                   THEN (SELECT l.name FROM locations l WHERE l.id = d.location_to)
                   ELSE (SELECT l.name FROM locations l WHERE l.id = d.location_id) END,
              (SELECT f.name FROM staff f WHERE f.id = d.staff_id),
              d.note,
              0,
              d.posted
       FROM docs d
     )
     ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    params,
  );
}

/**
 * Что предложить в выпадающих списках фильтра.
 *
 * Значения берутся из самих документов, а не из справочников: в списке
 * «Отправитель» должны стоять те, от кого хоть что-то приходило, а не все
 * заведённые поставщики — иначе выбирать придётся из трёх тысяч строк, из
 * которых сработают пять.
 */
/**
 * Последний день, за который в базе вообще есть документы.
 *
 * Нужен журналу, чтобы открыться неделей **с документами**, а не неделей,
 * в которой мы сейчас. Перенесённая история кончается двадцатым августа, а
 * календарь показывал двадцать четвёртое — журнал открывался пустым, и он
 * спросил, куда всё делось. В его кабинете такого не бывает просто потому,
 * что там торгуют сегодня.
 *
 * Пусто — значит база пуста; тогда пусть решает вызывающий.
 */
export function lastJournalDay(db: SqlDriver): string | null {
  const row = db.get<{ day: string | null }>(
    `SELECT MAX(day) AS day FROM (
       SELECT MAX(date(created_at)) AS day FROM sales
       UNION ALL
       SELECT MAX(date(created_at)) FROM docs
     )`,
  );

  return row?.day ?? null;
}

export function journalOptions(db: SqlDriver): {
  senders: string[];
  receivers: string[];
  authors: string[];
} {
  const column = (name: string) =>
    db
      .all<{ value: string }>(
        `SELECT DISTINCT ${name} AS value FROM (
           SELECT (SELECT l.name FROM locations l WHERE l.id = s.location_id) AS sender,
                  COALESCE((SELECT c.name FROM counterparties c WHERE c.id = s.customer_id),
                           'Розничный покупатель') AS receiver,
                  (SELECT f.name FROM staff f WHERE f.id = s.staff_id) AS author
           FROM sales s
           UNION ALL
           SELECT d.counterparty,
                  (SELECT l.name FROM locations l WHERE l.id = d.location_id),
                  (SELECT f.name FROM staff f WHERE f.id = d.staff_id)
           FROM docs d
         )
         WHERE ${name} IS NOT NULL AND ${name} <> ''
         ORDER BY value COLLATE NOCASE`,
      )
      .map((row) => row.value);

  return { senders: column('sender'), receivers: column('receiver'), authors: column('author') };
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
  ...DOC_KIND_LABEL,
  // Чек-возврат называется так же, как документ возврата: покупателю всё
  // равно, вернули ему деньги на кассе или накладной.
  refund: DOC_KIND_LABEL.sale_return,
};

export function entryTitle(entry: JournalEntry): string {
  // Свой номер, если он есть, — важнее внутреннего. У перенесённой истории
  // номер уже был, и человек ищет чек именно по нему.
  return `${KIND_LABEL[entry.kind] ?? 'Документ'} #${entry.number ?? entry.id}`;
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
  /** Свой номер прихода: у перенесённых — тот, что был в CloudShop. */
  number: number | null;
  /** Из чего строка: из чека или из заведённого руками документа. */
  source: 'sale' | 'doc';
  type: MoneyType;
  created_at: string;
  /** Поступило, копейки. */
  income: Kopecks;
  /** Списано, копейки. */
  expense: Kopecks;
  counterparty: string;
  /** Кто он в справочнике — чтобы имя в столбце открывало его карточку. */
  counterparty_id: Id | null;
  /** Куда легли деньги: касса магазина, терминал, счёт в банке. */
  account: string;
  category: string;
  author: string | null;
  note: string | null;
}

/** Способ оплаты — это и есть счёт, на который попали деньги. */
const ACCOUNT: Record<string, string> = {
  cash: 'Касса магазина',
  card: 'Терминал / Счет в банке',
  transfer: 'Счет в банке',
};

/** Обратно: по названию счёта — способ оплаты, если такой счёт из чеков. */
function accountKey(account: string): string {
  return Object.keys(ACCOUNT).find((key) => ACCOUNT[key] === account) ?? '';
}

/** Что предложить в списках фильтра денег — по тому, что уже есть в ленте. */
export function moneyOptions(db: SqlDriver): {
  accounts: string[];
  counterparties: string[];
  categories: string[];
  authors: string[];
} {
  const list = (sql: string) =>
    db.all<{ value: string }>(sql).map((row) => row.value).filter(Boolean);

  return {
    accounts: [
      ...new Set([
        ...Object.values(ACCOUNT),
        ...list('SELECT DISTINCT account AS value FROM money_docs ORDER BY value'),
      ]),
    ],
    counterparties: list(
      `SELECT DISTINCT COALESCE(counterparty,
         (SELECT c.name FROM counterparties c WHERE c.id = counterparty_id)) AS value
       FROM money_docs ORDER BY value COLLATE NOCASE`,
    ),
    categories: list(
      'SELECT DISTINCT category AS value FROM money_docs ORDER BY value COLLATE NOCASE',
    ),
    authors: list(
      `SELECT DISTINCT (SELECT f.name FROM staff f WHERE f.id = staff_id) AS value
       FROM money_docs ORDER BY value COLLATE NOCASE`,
    ),
  };
}

/**
 * Отбор в движении денег.
 *
 * Поля — его: поиск, дата, счёт, контрагент, автор, тип, категория платежа.
 * Его «Статуса» (проведён / не проведён / удалён) у нас нет: ордер заводится
 * сразу проведённым.
 */
export interface MoneyFilter {
  search?: string;
  from?: string;
  to?: string;
  account?: string;
  counterparty?: string;
  author?: string;
  types?: MoneyType[];
  category?: string;
}

export function listMoney(db: SqlDriver, limit = 500, filter: MoneyFilter = {}): MoneyEntry[] {
  const params: SqlParam[] = [];
  const where: string[] = [];

  const add = (sql: string, ...values: SqlParam[]) => {
    where.push(sql);
    params.push(...values);
  };

  if (filter.search?.trim()) {
    const text = filter.search.trim().toLowerCase();
    add("(CAST(id AS TEXT) = ? OR LOWER(COALESCE(note, '')) LIKE ?)", text, `%${text}%`);
  }
  if (filter.from) add('date(created_at) >= ?', filter.from);
  if (filter.to) add('date(created_at) <= ?', filter.to);
  // Счёт у чека выводится из способа оплаты уже после запроса, поэтому здесь
  // сравнивается то же самое правило, а не готовая строка.
  if (filter.account) add('account = ? OR payment = ?', filter.account, accountKey(filter.account));
  if (filter.counterparty) add('counterparty = ?', filter.counterparty);
  if (filter.author) add('author = ?', filter.author);
  if (filter.category) add('category = ?', filter.category);
  if (filter.types?.length) {
    add(`type IN (${filter.types.map(() => '?').join(', ')})`, ...filter.types);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);

  const rows = db.all<MoneyEntry & { payment: string | null }>(
    `SELECT * FROM (
       SELECT s.id                    AS id,
              s.money_number          AS number,
              'sale'                  AS source,
              'income'                AS type,
              s.created_at            AS created_at,
              s.total                 AS income,
              0                       AS expense,
              COALESCE(
                (SELECT c.name FROM counterparties c WHERE c.id = s.customer_id),
                'Розничный покупатель'
              )                       AS counterparty,
              s.customer_id           AS counterparty_id,
              s.payment               AS payment,
              ''                      AS account,
              'Оплата от клиента'     AS category,
              COALESCE(
                (SELECT f.name FROM staff f WHERE f.id = s.staff_id),
                s.author
              )                       AS author,
              NULL                    AS note
       FROM sales s
       WHERE NOT EXISTS (
         SELECT 1 FROM stock_moves m WHERE m.sale_id = s.id AND m.reason = 'return'
       )

       UNION ALL

       SELECT d.id,
              NULL,
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
              d.counterparty_id,
              NULL,
              -- Перевод показывается одной строкой «откуда → куда»: две строки
              -- об одном переводе выглядели бы как два разных движения.
              CASE WHEN d.type = 'transfer'
                   THEN d.account || ' → ' || COALESCE(d.account_to, '')
                   ELSE d.account END,
              COALESCE(d.category, ''),
              (SELECT f.name FROM staff f WHERE f.id = d.staff_id),
              d.note
       FROM money_docs d
     )
     ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    params,
  );

  return rows.map((row) => ({
    ...row,
    account: row.payment === null ? row.account : (ACCOUNT[row.payment] ?? row.payment),
  }));
}

/**
 * История бонусов клиента: за что начислено и когда списано.
 *
 * Начисление и списание лежат в самом чеке — их приносит выгрузка построчно,
 * а мы складываем по чеку. Отдельной таблицы бонусных операций нет и не
 * нужно: второй источник правды разошёлся бы с чеками при первой же правке.
 *
 * Остаток считается на ходу, от старых к новым, и возвращается вместе с
 * каждой строкой — в карточке важно не «сколько сейчас», а «как накопилось».
 */
export interface BonusEntry {
  id: Id;
  number: number | null;
  created_at: string;
  /** Начислено и списано по этому чеку, копейки. */
  earned: Kopecks;
  used: Kopecks;
  /** Сколько стало на счету после этого чека. */
  balance: Kopecks;
  /** Сумма чека — чтобы видеть, с чего начислено. */
  total: Kopecks;
  store: string | null;
}

export function bonusHistory(db: SqlDriver, customerId: Id, limit = 200): BonusEntry[] {
  const rows = db.all<Omit<BonusEntry, 'balance'>>(
    `SELECT s.id                AS id,
            s.number            AS number,
            s.created_at        AS created_at,
            s.bonus_earned      AS earned,
            s.bonus_used        AS used,
            s.total             AS total,
            (SELECT l.name FROM locations l WHERE l.id = s.location_id) AS store
       FROM sales s
      WHERE s.customer_id = ?
        AND (s.bonus_earned <> 0 OR s.bonus_used <> 0)
      ORDER BY s.created_at
      LIMIT ?`,
    [customerId, limit],
  );

  let balance = 0;
  const withBalance = rows.map((row) => {
    balance += row.earned - row.used;
    return { ...row, balance };
  });

  // Показываем новыми сверху — но считали снизу, иначе остаток не сложить.
  return withBalance.reverse();
}

/** «Приход #45679» — так документ называется в движении денег. */
export function moneyTitle(entry: MoneyEntry): string {
  return `${MONEY_TYPE_LABEL[entry.type]} #${entry.number ?? entry.id}`;
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
