import type { SqlDb } from '../db/driver.ts';
import { badRequest } from './errors.ts';
import { reserveSeq } from './seq.ts';

/**
 * Синхронизация офлайн-устройств.
 *
 * Модель простая и намеренно несимметричная:
 *
 * - **Справочники** (точки, категории, товары) изменяемы. Конфликт решается
 *   по времени последней правки: побеждает более поздняя. Для каталога это
 *   достаточно — два человека редко правят одну карточку одновременно.
 *
 * - **События** (документы, движения, чеки) неизменяемы. Их не нужно сливать:
 *   достаточно не вставить дважды. Идентификатор придумывает телефон, поэтому
 *   повторная отправка той же продажи ничего не меняет.
 *
 * Продажа, пришедшая с телефона, не проверяется на остаток. Она уже случилась:
 * товар отдан, деньги взяты. Отклонить её — значит потерять выручку из учёта.
 * Если из-за офлайна остаток ушёл в минус, это видно в отчёте и правится
 * инвентаризацией.
 */

export interface PushPayload {
  locations?: Row[];
  categories?: Row[];
  products?: Row[];
  docs?: Row[];
  sales?: Row[];
  sale_items?: Row[];
  stock_moves?: Row[];
}

export type Row = Record<string, unknown>;

export interface PushResult {
  /** Номер, до которого сервер учёл изменения. */
  cursor: number;
  applied: Record<string, number>;
}

/** Колонки, которые клиент вправе прислать. Остальное игнорируется. */
const WRITABLE: Record<keyof PushPayload, string[]> = {
  locations: ['id', 'name', 'address', 'archived', 'updated_at'],
  categories: ['id', 'name', 'deleted', 'updated_at'],
  products: [
    'id', 'name', 'sku', 'barcode', 'category_id', 'unit',
    'cost_price', 'sale_price', 'min_qty', 'photo_uri', 'archived', 'updated_at',
  ],
  docs: ['id', 'location_id', 'type', 'to_location_id', 'counterparty', 'note', 'created_at'],
  sales: ['id', 'location_id', 'discount', 'total', 'cost_total', 'payment', 'created_at', 'refunded_at'],
  sale_items: ['id', 'sale_id', 'product_id', 'qty', 'price', 'cost_price'],
  stock_moves: [
    'id', 'location_id', 'product_id', 'qty_delta', 'reason',
    'doc_id', 'sale_id', 'price', 'created_at',
  ],
};

/** Справочники сливаются по времени правки, события — только вставляются. */
const MUTABLE = new Set(['locations', 'categories', 'products']);

/**
 * Порядок важен: движение ссылается на товар, точку и документ, поэтому
 * справочники и документы должны попасть в базу раньше.
 */
const ORDER: (keyof PushPayload)[] = [
  'locations',
  'categories',
  'products',
  'docs',
  'sales',
  'sale_items',
  'stock_moves',
];

export async function push(
  db: SqlDb,
  orgId: string,
  userId: string | null,
  payload: PushPayload,
): Promise<PushResult> {
  const total = ORDER.reduce((sum, table) => sum + (payload[table]?.length ?? 0), 0);
  if (total === 0) {
    const current = await db.one<{ seq: number }>('SELECT seq FROM orgs WHERE id = $1', [orgId]);
    return { cursor: Number(current?.seq ?? 0), applied: {} };
  }

  return db.tx(async (tx) => {
    await assertOwnReferences(tx, orgId, payload);

    const seqs = await reserveSeq(tx, orgId, total);
    let cursor = 0;
    const applied: Record<string, number> = {};

    for (const table of ORDER) {
      const rows = payload[table];
      if (!rows?.length) continue;

      let count = 0;
      for (const row of rows) {
        const inserted = await upsert(tx, table, orgId, userId, row, seqs[cursor++]);
        if (inserted) count++;
      }
      applied[table] = count;
    }

    const current = await tx.one<{ seq: number }>('SELECT seq FROM orgs WHERE id = $1', [orgId]);
    return { cursor: Number(current?.seq ?? 0), applied };
  });
}

/**
 * Внешние ключи в базе смотрят на таблицы целиком, а не на организацию.
 * Без этой проверки клиент, угадавший чужой идентификатор точки, привязал бы
 * к ней своё движение. Проверяем принадлежность до записи.
 */
async function assertOwnReferences(
  db: SqlDb,
  orgId: string,
  payload: PushPayload,
): Promise<void> {
  const locationIds = new Set<string>();
  const productIds = new Set<string>();

  const collect = (rows: Row[] | undefined, fields: string[], into: Set<string>) => {
    for (const row of rows ?? []) {
      for (const field of fields) {
        const value = row[field];
        if (typeof value === 'string') into.add(value);
      }
    }
  };

  collect(payload.docs, ['location_id', 'to_location_id'], locationIds);
  collect(payload.sales, ['location_id'], locationIds);
  collect(payload.stock_moves, ['location_id'], locationIds);
  collect(payload.stock_moves, ['product_id'], productIds);
  collect(payload.sale_items, ['product_id'], productIds);

  // Товары и точки из этой же посылки ещё не в базе — они появятся раньше
  // событий, поэтому из проверки их исключаем.
  for (const row of payload.locations ?? []) {
    if (typeof row.id === 'string') locationIds.delete(row.id);
  }
  for (const row of payload.products ?? []) {
    if (typeof row.id === 'string') productIds.delete(row.id);
  }

  await assertBelongs(db, orgId, 'locations', locationIds, 'точка');
  await assertBelongs(db, orgId, 'products', productIds, 'товар');
}

async function assertBelongs(
  db: SqlDb,
  orgId: string,
  table: 'locations' | 'products',
  ids: Set<string>,
  label: string,
): Promise<void> {
  if (ids.size === 0) return;

  const rows = await db.query<{ id: string }>(
    `SELECT id FROM ${table} WHERE org_id = $1 AND id = ANY($2::uuid[])`,
    [orgId, [...ids]],
  );

  const known = new Set(rows.map((row) => row.id));
  const unknown = [...ids].filter((id) => !known.has(id));

  if (unknown.length > 0) {
    throw badRequest(`Неизвестная ${label}: ${unknown.join(', ')}`);
  }
}

async function upsert(
  db: SqlDb,
  table: keyof PushPayload,
  orgId: string,
  userId: string | null,
  row: Row,
  seq: number,
): Promise<boolean> {
  const allowed = WRITABLE[table];
  const columns: string[] = ['org_id', 'seq'];
  const values: unknown[] = [orgId, seq];

  for (const column of allowed) {
    if (row[column] === undefined) continue;
    columns.push(column);
    values.push(row[column]);
  }

  // Автор события — тот, чьим токеном пришла синхронизация.
  if ((table === 'docs' || table === 'sales' || table === 'stock_moves') && userId) {
    columns.push('created_by');
    values.push(userId);
  }

  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');

  const conflict = MUTABLE.has(table)
    ? `ON CONFLICT (id) DO UPDATE SET ${allowed
        .filter((column) => column !== 'id' && row[column] !== undefined)
        .map((column) => `${column} = EXCLUDED.${column}`)
        .concat('seq = EXCLUDED.seq')
        .join(', ')}
       WHERE ${table}.org_id = EXCLUDED.org_id
         AND ${table}.updated_at <= EXCLUDED.updated_at`
    : 'ON CONFLICT (id) DO NOTHING';

  const result = await db.query<{ id: string }>(
    `INSERT INTO ${table} (${columns.join(', ')})
     VALUES (${placeholders})
     ${conflict}
     RETURNING id`,
    values,
  );

  return result.length > 0;
}

export interface PullResult {
  changes: Record<string, Row[]>;
  /** Номер, до которого клиент получил изменения. */
  cursor: number;
  /** Остались ли ещё изменения за курсором. */
  has_more: boolean;
}

const PULL_TABLES = [
  'locations',
  'categories',
  'products',
  'docs',
  'sales',
  'sale_items',
  'stock_moves',
] as const;

/**
 * Отдаёт всё, что изменилось после `since`.
 *
 * Тонкость с ограничением размера ответа: у таблиц общий счётчик, но выбираем
 * мы их по отдельности. Если какая-то таблица упёрлась в лимит, курсор нельзя
 * двигать дальше её последней строки — иначе то, что не поместилось,
 * будет пропущено навсегда. Поэтому курсор = минимальный «последний номер»
 * среди упёршихся таблиц, а лишние строки отбрасываются.
 */
export async function pull(
  db: SqlDb,
  orgId: string,
  since: number,
  limit = 500,
): Promise<PullResult> {
  const org = await db.one<{ seq: number }>('SELECT seq FROM orgs WHERE id = $1', [orgId]);
  const head = Number(org?.seq ?? 0);

  const fetched: Record<string, Row[]> = {};
  let cursor = head;

  for (const table of PULL_TABLES) {
    const rows = await db.query<Row>(
      `SELECT * FROM ${table} WHERE org_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
      [orgId, since, limit],
    );
    fetched[table] = rows;

    if (rows.length === limit) {
      const lastSeq = Number(rows[rows.length - 1].seq);
      cursor = Math.min(cursor, lastSeq);
    }
  }

  const changes: Record<string, Row[]> = {};
  for (const table of PULL_TABLES) {
    changes[table] = fetched[table].filter((row) => Number(row.seq) <= cursor);
  }

  return { changes, cursor, has_more: cursor < head };
}
