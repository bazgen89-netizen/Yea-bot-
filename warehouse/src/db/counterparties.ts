import type { SqlDriver, SqlParam } from './driver';
import type { CounterpartyWithTotals, Id, PartyKind } from '../domain/types';

/**
 * Клиенты и поставщики. Итоги по чекам считаются из самих чеков, а не хранятся
 * полями: сумма покупок, которую можно рассинхронизировать с историей, ничего
 * не объясняет — ровно как остаток, лежащий отдельным числом.
 *
 * Соединение с чеками одно на весь список, а не подзапрос на строку: в базе
 * несколько тысяч клиентов, и три коррелированных подзапроса на каждого
 * заметно тормозили бы прокрутку.
 */
function selectParties(where: string[], params: SqlParam[], order = 'p.name COLLATE NOCASE') {
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return {
    sql: `
      SELECT p.*,
             COALESCE(SUM(s.total), 0) AS purchases,
             COUNT(s.id)               AS receipts,
             MAX(s.created_at)         AS last_sale_at,
             -- Возвраты и деньги — подзапросами, а не ещё двумя соединениями:
             -- две таблицы «многие ко многим» в одном GROUP BY перемножили бы
             -- строки, и суммы покупок выросли бы в разы.
             (SELECT COUNT(DISTINCT m.sale_id)
                FROM stock_moves m JOIN sales r ON r.id = m.sale_id
               WHERE m.reason = 'return' AND r.customer_id = p.id) AS returns,
             (SELECT COALESCE(SUM(CAST(ROUND(m.qty_delta * m.price / 1000.0) AS INTEGER)), 0)
                FROM stock_moves m JOIN sales r ON r.id = m.sale_id
               WHERE m.reason = 'return' AND r.customer_id = p.id) AS returns_sum,
             (SELECT COALESCE(SUM(amount), 0) FROM money_docs d
               WHERE d.counterparty_id = p.id AND d.type = 'income')  AS debit_sum,
             (SELECT COALESCE(SUM(amount), 0) FROM money_docs d
               WHERE d.counterparty_id = p.id AND d.type = 'expense') AS credit_sum,
             -- Закупки у поставщика: сами документы и их суммы по движениям.
             (SELECT COUNT(*) FROM docs k
               WHERE k.counterparty_id = p.id AND k.subtype = 'purchase') AS purchases_count,
             (SELECT COALESCE(SUM(CAST(ROUND(m.qty_delta * m.price / 1000.0) AS INTEGER)), 0)
                FROM docs k JOIN stock_moves m ON m.doc_id = k.id
               WHERE k.counterparty_id = p.id AND k.subtype = 'purchase') AS purchases_sum,
             (SELECT COUNT(*) FROM docs k
               WHERE k.counterparty_id = p.id AND k.subtype = 'purchase_return') AS purchase_returns,
             (SELECT COALESCE(SUM(CAST(ROUND(-m.qty_delta * m.price / 1000.0) AS INTEGER)), 0)
                FROM docs k JOIN stock_moves m ON m.doc_id = k.id
               WHERE k.counterparty_id = p.id AND k.subtype = 'purchase_return') AS purchase_returns_sum
      FROM counterparties p
      LEFT JOIN sales s ON s.customer_id = p.id
      ${whereSql}
      GROUP BY p.id
      ORDER BY ${order}
    `,
    params,
  };
}

export interface PartyFilter {
  /** Клиенты, поставщики или все. Записи 'both' попадают в оба списка. */
  kind?: PartyKind;
  /** Поиск по имени, телефону или почте. */
  search?: string;
  includeArchived?: boolean;
}

export function listCounterparties(
  db: SqlDriver,
  filter: PartyFilter = {},
): CounterpartyWithTotals[] {
  const where: string[] = [];
  const params: SqlParam[] = [];

  if (!filter.includeArchived) where.push('p.archived = 0');

  if (filter.kind && filter.kind !== 'both') {
    where.push("(p.kind = ? OR p.kind = 'both')");
    params.push(filter.kind);
  }

  if (filter.search?.trim()) {
    where.push('p.search_text LIKE ?');
    params.push(`%${normalize(filter.search)}%`);
  }

  const query = selectParties(where, params);
  return db.all<CounterpartyWithTotals>(query.sql, query.params);
}

export function countCounterparties(db: SqlDriver, kind: PartyKind): number {
  const row = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM counterparties
     WHERE archived = 0 AND (kind = ? OR kind = 'both')`,
    [kind],
  );
  return row?.n ?? 0;
}

export function getCounterparty(db: SqlDriver, id: Id): CounterpartyWithTotals | null {
  const query = selectParties(['p.id = ?'], [id]);
  return db.get<CounterpartyWithTotals>(query.sql, query.params);
}

export interface PartyInput {
  kind: PartyKind;
  name: string;
  phone?: string | null;
  email?: string | null;
  note?: string | null;
  discount_bp?: number;
  /** День рождения строкой, как в выгрузке: «13/07/2006». */
  birthday?: string | null;
  gender?: string | null;
  address?: string | null;
  /** Кто завёл карточку. */
  created_by?: string | null;
}

export function createCounterparty(db: SqlDriver, input: PartyInput): Id {
  db.run(
    `INSERT INTO counterparties
       (kind, name, phone, email, note, discount_bp,
        birthday, gender, address, created_by, created_at, search_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.kind,
      input.name.trim(),
      emptyToNull(input.phone),
      emptyToNull(input.email),
      emptyToNull(input.note),
      input.discount_bp ?? 0,
      emptyToNull(input.birthday),
      emptyToNull(input.gender),
      emptyToNull(input.address),
      emptyToNull(input.created_by),
      new Date().toISOString(),
      searchText(input),
    ],
  );
  return db.lastInsertId();
}

export function updateCounterparty(db: SqlDriver, id: Id, input: PartyInput): void {
  db.run(
    `UPDATE counterparties SET
       kind = ?, name = ?, phone = ?, email = ?, note = ?, discount_bp = ?,
       birthday = ?, gender = ?, address = ?, search_text = ?
     WHERE id = ?`,
    [
      input.kind,
      input.name.trim(),
      emptyToNull(input.phone),
      emptyToNull(input.email),
      emptyToNull(input.note),
      input.discount_bp ?? 0,
      emptyToNull(input.birthday),
      emptyToNull(input.gender),
      emptyToNull(input.address),
      searchText(input),
      id,
    ],
  );
}

/**
 * Контрагенты не удаляются, а прячутся: на клиента ссылаются пробитые чеки,
 * и удаление стёрло бы «кто это купил» из истории продаж.
 */
export function archiveCounterparty(db: SqlDriver, id: Id): void {
  db.run('UPDATE counterparties SET archived = 1 WHERE id = ?', [id]);
}

export function restoreCounterparty(db: SqlDriver, id: Id): void {
  db.run('UPDATE counterparties SET archived = 0 WHERE id = ?', [id]);
}

export interface ImportPartyResult {
  created: number;
  updated: number;
  /** Строки без имени — заводить безымянного клиента бессмысленно. */
  skipped: number;
}

/**
 * Загрузка клиентской базы из выгрузки другой программы.
 *
 * Запись опознаётся по телефону (только цифры: «+7 (999) 123-45-67» и
 * «8 999 1234567» — один человек), а без телефона — по имени. Совпало —
 * карточка дополняется, не совпало — заводится новая. Поэтому повторная
 * загрузка того же файла не плодит дубли.
 *
 * Что уже есть в базе, читается один раз в память: на нескольких тысячах строк
 * поиск запросом на каждую превратился бы в тысячи проходов по таблице.
 */
export function importCounterparties(db: SqlDriver, rows: PartyInput[]): ImportPartyResult {
  const result: ImportPartyResult = { created: 0, updated: 0, skipped: 0 };

  const byPhone = new Map<string, Id>();
  const byName = new Map<string, Id>();

  for (const known of db.all<{ id: Id; name: string; phone: string | null }>(
    'SELECT id, name, phone FROM counterparties',
  )) {
    const digits = phoneDigits(known.phone);
    if (digits && !byPhone.has(digits)) byPhone.set(digits, known.id);

    const key = normalize(known.name);
    if (!byName.has(key)) byName.set(key, known.id);
  }

  db.tx(() => {
    for (const row of rows) {
      if (!row.name?.trim()) {
        result.skipped++;
        continue;
      }

      const digits = phoneDigits(row.phone);
      // Телефон есть, но не нашёлся — это новый человек. Дальше искать по имени
      // нельзя: полных тёзок с разными номерами в базе хватает.
      const existing = digits ? byPhone.get(digits) : byName.get(normalize(row.name));

      if (existing !== undefined) {
        const current = db.get<{
          phone: string | null;
          email: string | null;
          note: string | null;
          discount_bp: number;
        }>('SELECT phone, email, note, discount_bp FROM counterparties WHERE id = ?', [existing]);

        // Пустые поля в выгрузке не должны затирать заполненные в базе.
        updateCounterparty(db, existing, {
          kind: row.kind,
          name: row.name,
          phone: emptyToNull(row.phone) ?? current?.phone ?? null,
          email: emptyToNull(row.email) ?? current?.email ?? null,
          note: emptyToNull(row.note) ?? current?.note ?? null,
          discount_bp: row.discount_bp ?? current?.discount_bp ?? 0,
        });
        result.updated++;
      } else {
        const id = createCounterparty(db, row);
        if (digits) byPhone.set(digits, id);
        byName.set(normalize(row.name), id);
        result.created++;
      }
    }
  });

  return result;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Последние десять цифр номера. В выгрузках один и тот же телефон записан
 * и как «+7 999…», и как «8 999…» — по хвосту они совпадают.
 */
export function phoneDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

/** Телефон в привычном виде: +7 (999) 123-45-67. */
export function formatPhone(phone: string | null | undefined): string {
  const digits = phoneDigits(phone);
  if (!digits) return phone?.trim() ?? '';
  return `+7 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`;
}

function searchText(input: PartyInput): string {
  const parts = [input.name, input.phone, input.email]
    .filter((v): v is string => Boolean(v?.trim()))
    .map(normalize);

  const digits = phoneDigits(input.phone);
  if (digits) parts.push(digits);

  return parts.join(' ');
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Итоги бонусной программы — два числа над её настройками.
 *
 * Считаются по счетам клиентов, а не хранятся отдельно: «сгенерировано» —
 * это всё, что сейчас лежит на счетах плюс уже потраченное, и складывать
 * его третьим счётчиком значило бы завести число, которое рано или поздно
 * разойдётся с двумя первыми.
 */
export function bonusStats(db: SqlDriver): { generated: number; spent: number } {
  const row = db.get<{ balance: number; spent: number }>(
    `SELECT COALESCE(SUM(bonus_balance), 0) AS balance,
            COALESCE(SUM(bonus_spent), 0)   AS spent
     FROM counterparties`,
  );
  const balance = row?.balance ?? 0;
  const spent = row?.spent ?? 0;
  return { generated: balance + spent, spent };
}
