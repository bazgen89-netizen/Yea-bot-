import type { SqlDriver, SqlParam } from './driver';
import type { Id } from '../domain/types';

/**
 * Обмен с сервером: что отдать и как принять чужое.
 *
 * Модель — сервера (`warehouse-server/src/core/sync.ts`), и она намеренно
 * несимметрична:
 *
 *   • **справочники** (точки, категории, товары, контрагенты) правятся, и
 *     спор решается временем последней правки — побеждает та, что позже;
 *   • **события** (документы, чеки, строки чеков, движения склада) не
 *     правятся вовсе. Их не надо сливать: достаточно не вставить дважды.
 *
 * Продажа, приехавшая с другого устройства, не проверяется на остаток. Она
 * уже случилась: товар отдан, деньги взяты. Отклонить её — значит потерять
 * выручку из учёта. Если из-за офлайна остаток ушёл в минус, это видно в
 * отчёте и правится инвентаризацией.
 *
 * Записи узнаются по `uid` — общему имени, которое придумало то устройство,
 * где запись завели. Внутренний номер строки остаётся внутренним делом
 * каждой базы: на кассе товар №417 и на телефоне кладовщика №417 — разные
 * вещи, и сливать их по номеру нельзя.
 */

/** Таблицы, которые ездят на сервер. Порядок важен: ссылки идут первыми. */
export const SYNC_TABLES = [
  'locations',
  'categories',
  'products',
  'counterparties',
  'docs',
  'sales',
  'sale_items',
  'stock_moves',
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

/** Справочники сливаются по времени правки, события — только вставляются. */
const MUTABLE = new Set<SyncTable>(['locations', 'categories', 'products', 'counterparties']);

/**
 * Колонки, которые уезжают. Список свой, а не «всё подряд»: на сервере у
 * записи свои поля (`org_id`, `seq`), и слать ему наши внутренние номера
 * незачем — он их не поймёт и не примет.
 */
const COLUMNS: Record<SyncTable, string[]> = {
  locations: ['name', 'address', 'archived', 'created_at'],
  categories: ['name'],
  products: [
    'name', 'sku', 'barcode', 'category_id', 'unit',
    'cost_price', 'sale_price', 'min_qty', 'photo_uri', 'archived', 'created_at',
  ],
  counterparties: ['name', 'kind', 'phone', 'email', 'note', 'created_at'],
  docs: ['type', 'subtype', 'counterparty', 'note', 'created_at', 'location_id', 'location_to'],
  sales: ['discount', 'total', 'cost_total', 'payment', 'created_at', 'location_id'],
  sale_items: ['sale_id', 'product_id', 'qty', 'price', 'cost_price'],
  stock_moves: [
    'product_id', 'qty_delta', 'reason', 'doc_id', 'sale_id', 'price',
    'location_id', 'created_at',
  ],
};

/** Ссылки на другие таблицы: наружу они уезжают чужим `uid`, а не номером. */
const LINKS: Partial<Record<SyncTable, Record<string, SyncTable>>> = {
  products: { category_id: 'categories' },
  docs: { location_id: 'locations', location_to: 'locations' },
  sales: { location_id: 'locations' },
  sale_items: { sale_id: 'sales', product_id: 'products' },
  stock_moves: {
    product_id: 'products',
    doc_id: 'docs',
    sale_id: 'sales',
    location_id: 'locations',
  },
};

export type Row = Record<string, unknown>;
export type Payload = Partial<Record<SyncTable, Row[]>>;

/**
 * Имя записи, общее для всех устройств.
 *
 * `crypto.randomUUID` есть и в браузере, и в Node, и на телефоне. Запасной
 * путь на случай очень старого окружения — не «почти случайное» число, а
 * честная склейка времени и двух случайных кусков: столкнуться им негде,
 * а читать его никто не будет.
 */
export function newUid(): string {
  const random = globalThis.crypto?.randomUUID;
  if (typeof random === 'function') return random.call(globalThis.crypto);

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/**
 * Проставить `uid` всему, у чего его ещё нет.
 *
 * Нужно один раз после обновления программы: база, заведённая до
 * синхронизации, полна записей без общего имени, и первая же отправка
 * увезла бы их как новые — а на сервере они, может быть, уже есть.
 */
export function fillUids(db: SqlDriver): number {
  let touched = 0;

  db.tx(() => {
    for (const table of SYNC_TABLES) {
      const rows = db.all<{ id: Id }>(`SELECT id FROM ${table} WHERE uid IS NULL`);
      for (const row of rows) {
        db.run(`UPDATE ${table} SET uid = ? WHERE id = ?`, [newUid(), row.id]);
        touched += 1;
      }
    }
  });

  return touched;
}

/**
 * Что отправить серверу.
 *
 * Пока отправляется всё: у устройства нет своего счётчика изменений, и
 * заводить его — отдельная работа. Сервер к повторам готов: справочник он
 * сливает по времени правки, событие узнаёт по `uid` и второй раз не
 * вставляет. Хуже отправить лишнее, чем потерять чек.
 */
export function outbox(db: SqlDriver): Payload {
  const payload: Payload = {};

  for (const table of SYNC_TABLES) {
    const links = LINKS[table] ?? {};
    const columns = COLUMNS[table];

    // Ссылки уезжают чужим `uid`: номер строки на сервере ничего не значит.
    const select = columns
      .map((column) => {
        const target = links[column];
        if (!target) return `t.${column}`;
        return `(SELECT r.uid FROM ${target} r WHERE r.id = t.${column}) AS ${column}`;
      })
      .join(', ');

    const rows = db.all<Row>(
      `SELECT t.uid AS id${select ? `, ${select}` : ''} FROM ${table} t WHERE t.uid IS NOT NULL`,
    );

    if (rows.length > 0) payload[table] = rows;
  }

  return payload;
}

/**
 * Принять чужое.
 *
 * Возвращает, сколько строк завелось и сколько обновилось, — это то, что
 * потом показывается человеку: «приехало 12 товаров и 3 чека».
 */
export interface Applied {
  added: number;
  updated: number;
  skipped: number;
}

export function applyPull(db: SqlDriver, changes: Payload): Applied {
  const result: Applied = { added: 0, updated: 0, skipped: 0 };

  db.tx(() => {
    for (const table of SYNC_TABLES) {
      const rows = changes[table];
      if (!rows?.length) continue;

      for (const row of rows) {
        const uid = String(row.id ?? '').trim();
        if (!uid) {
          result.skipped += 1;
          continue;
        }

        const known = db.get<{ id: Id }>(`SELECT id FROM ${table} WHERE uid = ?`, [uid]);

        // Событие правке не подлежит: чек, который уже лежит, второй раз не
        // переписывается — он случился ровно один раз.
        if (known && !MUTABLE.has(table)) {
          result.skipped += 1;
          continue;
        }

        const values = fields(db, table, row);
        if (values === null) {
          // Ссылка ведёт на запись, которой у нас ещё нет: строка чека
          // приехала раньше самого чека. Пропускаем — довезём следующим
          // обменом, когда чек уже будет.
          result.skipped += 1;
          continue;
        }

        if (known) {
          const set = Object.keys(values).map((column) => `${column} = ?`).join(', ');
          db.run(`UPDATE ${table} SET ${set} WHERE id = ?`, [
            ...(Object.values(values) as SqlParam[]),
            known.id,
          ]);
          result.updated += 1;
        } else {
          const columns = ['uid', ...Object.keys(values)];
          const marks = columns.map(() => '?').join(', ');
          db.run(
            `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${marks})`,
            [uid, ...(Object.values(values) as SqlParam[])],
          );
          result.added += 1;
        }
      }
    }
  });

  return result;
}

/**
 * Чем заполнить обязательное поле, которого в присланной строке нет.
 *
 * У наших таблиц есть колонки, без которых строка не заводится вовсе:
 * `created_at` у справочников, `kind` у контрагента. Другое устройство их
 * пришлёт — но программа обязана пережить и запись, пришедшую без них
 * (со старой версии, из чужой выгрузки). Пустая база лучше упавшего обмена.
 */
const REQUIRED: Partial<Record<SyncTable, Record<string, SqlParam>>> = {
  locations: { created_at: '' },
  products: { created_at: '' },
  counterparties: { created_at: '', kind: 'customer' },
};

/**
 * Разложить присланную строку по колонкам нашей базы.
 *
 * `null`, если ссылка ведёт в пустоту: такую строку принимать нельзя — она
 * повиснет без товара или без чека.
 */
function fields(db: SqlDriver, table: SyncTable, row: Row): Record<string, SqlParam> | null {
  const links = LINKS[table] ?? {};
  const values: Record<string, SqlParam> = {};

  const required = REQUIRED[table] ?? {};

  for (const column of COLUMNS[table]) {
    const incoming = row[column];
    const target = links[column];

    if (!target) {
      if (incoming !== undefined && incoming !== null) {
        values[column] = incoming as SqlParam;
      } else if (column in required) {
        // Обязательное поле: пустое значение — не «ничего», а «сегодня».
        values[column] = required[column] === '' ? new Date().toISOString() : required[column];
      } else if (incoming !== undefined) {
        values[column] = null;
      }
      continue;
    }

    // Ссылка приехала чужим `uid` — переводим в наш номер.
    const uid = incoming == null ? null : String(incoming);
    if (uid === null) {
      values[column] = null;
      continue;
    }

    const found = db.get<{ id: Id }>(`SELECT id FROM ${target} WHERE uid = ?`, [uid]);
    if (!found) return null;
    values[column] = found.id;
  }

  return values;
}
