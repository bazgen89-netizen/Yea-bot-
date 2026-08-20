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
             -- Сколько за ним осталось: долг живёт в самом чеке, отдельной
             -- колонкой, и складывается тем же соединением, что и покупки.
             COALESCE(SUM(s.debt), 0)  AS debt_sales,
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

  for (const condition of searchWhere(filter.search, params)) where.push(condition);

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

  /** 'person' или 'company': от этого зависит половина карточки. */
  party_type?: string;
  is_default?: boolean;
  /** Считать скидку по накопительным правилам компании. */
  enable_savings?: boolean;
  /** Телефоны списком; первый попадает и в phone — по нему ищут. */
  phones?: string[];
  discount_card?: string | null;
  loyalty_type?: string | null;
  cashback_bp?: number;
  /** Бонусный счёт и потраченные бонусы, копейки. */
  bonus_balance?: number;
  bonus_spent?: number;
  /** Реквизиты организации и банковские. */
  details?: Requisite[];
  bank_details?: Requisite[];
  account_number?: string | null;
  legal_address?: string | null;
}

/** Строка реквизита: «ИНН → 5702001741». */
export interface Requisite {
  key: string;
  value: string;
}

/** Пустые пары не сохраняются — так же, как в реквизитах компании. */
function cleanPairs(pairs: Requisite[] | undefined): string {
  return JSON.stringify((pairs ?? []).filter((item) => item.key.trim() && item.value.trim()));
}

/** Пустые строки в списке телефонов не сохраняются. */
function cleanList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

/** Разбирает JSON-поле карточки, не падая на мусоре. */
export function parsePairs(json: string | null | undefined): Requisite[] {
  try {
    const parsed = JSON.parse(json || '[]') as Requisite[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseList(json: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(json || '[]') as string[];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Поля карточки, общие для заведения и правки.
 *
 * Первый телефон списка попадает и в старую колонку `phone`: по ней ищут,
 * её показывают списки и на неё смотрит касса. Держать её в стороне от
 * списка значило бы завести второй ответ на вопрос «какой у него телефон».
 */
function fields(input: PartyInput): SqlParam[] {
  const phones = cleanList(input.phones);
  const phone = phones[0] ?? emptyToNull(input.phone);

  return [
    input.kind,
    input.name.trim(),
    phone,
    emptyToNull(input.email),
    emptyToNull(input.note),
    input.discount_bp ?? 0,
    emptyToNull(input.birthday),
    emptyToNull(input.gender),
    emptyToNull(input.address),
    input.party_type ?? 'person',
    input.is_default ? 1 : 0,
    input.enable_savings ? 1 : 0,
    JSON.stringify(phones),
    emptyToNull(input.discount_card),
    emptyToNull(input.loyalty_type),
    input.cashback_bp ?? 0,
    input.bonus_balance ?? 0,
    input.bonus_spent ?? 0,
    cleanPairs(input.details),
    cleanPairs(input.bank_details),
    emptyToNull(input.account_number),
    emptyToNull(input.legal_address),
    searchText({ ...input, phone }),
  ];
}

const FIELD_NAMES = `kind, name, phone, email, note, discount_bp,
        birthday, gender, address, party_type, is_default, enable_savings,
        phones, discount_card, loyalty_type, cashback_bp,
        bonus_balance, bonus_spent,
        details, bank_details, account_number, legal_address, search_text`;

export function createCounterparty(db: SqlDriver, input: PartyInput): Id {
  return db.tx(() => {
    // Контрагент по умолчанию один на вид: включая его здесь, снимаем
    // отметку с прежнего — иначе документ подставлял бы то одного, то другого.
    if (input.is_default) {
      db.run("UPDATE counterparties SET is_default = 0 WHERE kind = ? OR kind = 'both'", [
        input.kind,
      ]);
    }

    db.run(
      `INSERT INTO counterparties (${FIELD_NAMES}, created_by, created_at)
       VALUES (${FIELD_NAMES.split(',').map(() => '?').join(', ')}, ?, ?)`,
      [...fields(input), emptyToNull(input.created_by), new Date().toISOString()],
    );
    return db.lastInsertId();
  });
}

export function updateCounterparty(db: SqlDriver, id: Id, input: PartyInput): void {
  db.tx(() => {
    if (input.is_default) {
      db.run(
        `UPDATE counterparties SET is_default = 0
         WHERE (kind = ? OR kind = 'both') AND id <> ?`,
        [input.kind, id],
      );
    }

    const assignments = FIELD_NAMES.split(',')
      .map((name) => `${name.trim()} = ?`)
      .join(', ');

    db.run(`UPDATE counterparties SET ${assignments} WHERE id = ?`, [...fields(input), id]);
  });
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
        const current = getCounterparty(db, existing);

        // Пустые поля в выгрузке не затирают заполненные в базе: файл чаще
        // всего неполный — в нём донесли дни рождения, а адреса не трогали.
        //
        // Обновлять надо **всю** карточку, а не четыре поля: раньше здесь
        // стояли только телефон, почта, описание и скидка, и обратная
        // загрузка собственной же выгрузки обнуляла бонусы, кешбэк, день
        // рождения и вторые телефоны — молча, без единой жалобы.
        updateCounterparty(db, existing, {
          kind: row.kind,
          name: row.name,
          phone: emptyToNull(row.phone) ?? current?.phone ?? null,
          email: emptyToNull(row.email) ?? current?.email ?? null,
          note: emptyToNull(row.note) ?? current?.note ?? null,
          discount_bp: row.discount_bp || (current?.discount_bp ?? 0),
          birthday: emptyToNull(row.birthday) ?? current?.birthday ?? null,
          gender: emptyToNull(row.gender) ?? current?.gender ?? null,
          address: emptyToNull(row.address) ?? current?.address ?? null,
          created_by: emptyToNull(row.created_by) ?? current?.created_by ?? null,
          party_type: row.party_type ?? current?.party_type,
          phones: row.phones?.length ? row.phones : parseList(current?.phones),
          discount_card: emptyToNull(row.discount_card) ?? current?.discount_card ?? null,
          loyalty_type: emptyToNull(row.loyalty_type) ?? current?.loyalty_type ?? null,
          cashback_bp: row.cashback_bp || (current?.cashback_bp ?? 0),
          bonus_balance: row.bonus_balance ?? current?.bonus_balance ?? 0,
          bonus_spent: row.bonus_spent ?? current?.bonus_spent ?? 0,
          details: parsePairs(current?.details),
          bank_details: parsePairs(current?.bank_details),
          account_number: current?.account_number ?? null,
          legal_address: current?.legal_address ?? null,
          is_default: Boolean(current?.is_default),
          enable_savings: Boolean(current?.enable_savings),
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

/** Строка для поиска: как её кладут в `search_text`, так и ищут. */
export function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Условия поиска — по слову за раз.
 *
 * Одной строкой искать нельзя, и вот почему. Клиента зовут «Рудник Михаил»,
 * а вспоминают его то «Михаил Рудник», то «Рудник» и четыре цифры телефона.
 * Одно `LIKE '%михаил рудник%'` не найдёт ничего: в подписи слова стоят в
 * другом порядке. Поэтому запрос разбирается на слова, и каждое ищется
 * само по себе — найтись должны все.
 *
 * Слово из цифр ищется ещё и без разделителей: набрали «+7 (961) 253» —
 * ищем и «961253», потому что в подписи телефон лежит и слитно тоже.
 */
export function searchWhere(search: string | undefined, params: SqlParam[]): string[] {
  const query = normalize(search ?? '');
  if (!query) return [];

  const conditions: string[] = [];

  // Запрос без единой буквы — это телефон, и разбирать его на слова нельзя:
  // «8 961 253 27 57» распалось бы на «8», «961», «253» и нашло бы пол-базы.
  if (!/\p{L}/u.test(query)) {
    const digits = query.replace(/\D/g, '');
    if (digits.length < 2) return [];

    conditions.push('p.search_text LIKE ?');
    params.push(`%${tail(digits)}%`);
    return conditions;
  }

  for (const word of query.split(/\s+/).filter(Boolean)) {
    // Скобки и дефисы сами по себе — не запрос.
    const bare = word.replace(/[^\p{L}\p{N}@._-]/gu, '');
    const digits = word.replace(/\D/g, '');
    if (!bare && !digits) continue;

    if (digits.length >= 3 && digits !== bare) {
      conditions.push('(p.search_text LIKE ? OR p.search_text LIKE ?)');
      params.push(`%${bare}%`, `%${tail(digits)}%`);
    } else {
      conditions.push('p.search_text LIKE ?');
      params.push(`%${bare || digits}%`);
    }
  }

  return conditions;
}

/**
 * Хвост номера — последние десять цифр.
 *
 * В подписи телефон лежит и так: «+7 999…» и «8 999…» — это один и тот же
 * номер, и отличаются они только началом. Ищем по хвосту — находится любой.
 */
function tail(digits: string): string {
  return digits.length >= 10 ? digits.slice(-10) : digits;
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

/**
 * По чему ищут контрагента.
 *
 * Его подпись поиска на кассе перечисляет всё: «Поиск покупателя по имени,
 * телефону, email и дисконтной карте». Значит, и в строке поиска должно
 * лежать всё — включая второй телефон и номер карты, иначе обещание в
 * подписи не выполняется.
 */
function searchText(input: PartyInput): string {
  const phones = [input.phone, ...(input.phones ?? [])];

  const parts = [input.name, input.email, input.discount_card, ...phones]
    .filter((v): v is string => Boolean(v?.trim()))
    .map(normalize);

  // Телефон ищется и без разделителей: «+7 (999) 123-45-67» находится по
  // «9991234567».
  for (const phone of phones) {
    const digits = phoneDigits(phone);
    if (digits) parts.push(digits);
  }

  return [...new Set(parts)].join(' ');
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
