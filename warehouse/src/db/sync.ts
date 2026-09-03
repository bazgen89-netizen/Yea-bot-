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
  counterparties: ['name', 'kind', 'phone', 'email', 'note', 'archived', 'created_at'],
  docs: ['type', 'subtype', 'counterparty', 'note', 'created_at', 'location_id', 'location_to'],
  sales: ['discount', 'total', 'cost_total', 'payment', 'created_at', 'location_id'],
  sale_items: ['sale_id', 'product_id', 'qty', 'price', 'cost_price'],
  stock_moves: [
    'product_id', 'qty_delta', 'reason', 'doc_id', 'sale_id', 'price',
    'location_id', 'created_at',
  ],
};

/**
 * Чем запись узнаётся, если общего имени не сошлось.
 *
 * Так бывает при первой встрече двух баз: магазин «Чайный бар» заведён и на
 * кассе, и на сервере, но заведён порознь — и `uid` у них разные. Вставить
 * второй «Чайный бар» нельзя: имя занято (`locations.name UNIQUE`), да и в
 * жизни он один. Значит, запись надо узнать по существу — по названию, по
 * штрихкоду, по телефону.
 *
 * Ключи перебираются по порядку, до первого, который есть в присланной
 * строке. Штрихкод надёжнее названия, поэтому он первый; но у половины
 * товаров его нет вовсе, и тогда остаётся название.
 *
 * Совпасть должна ровно одна местная строка. Если одинаковых две, то какая
 * из них «та самая» — неизвестно, и угадывать нельзя: пусть лучше заведётся
 * ещё одна, чем чужой товар молча сольётся не с тем.
 */
const NATURAL: Partial<Record<SyncTable, string[]>> = {
  locations: ['name'],
  categories: ['name'],
  products: ['barcode', 'name'],
  counterparties: ['phone'],
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

/** Что уже помечено к отправке: по этим меткам потом и вычёркиваем. */
export interface Marks {
  table: SyncTable;
  row_id: Id;
}

/**
 * Что отправить серверу.
 *
 * Только изменённое. Раньше уезжало всё подряд — пять тысяч строк в каждый
 * обмен; на столе незаметно, а с телефона по мобильному интернету это
 * мегабайт туда и столько же обратно, потому что сервер честно пересказывает
 * нам наши же правки.
 *
 * Что изменилось, помнит сама база (`sync_outbox`, заполняется триггерами).
 * Вычёркивается это не здесь, а после удачной отправки — и вычёркиваются
 * именно те строки, что уехали, а не таблица целиком: пока идёт обмен, на
 * кассе могли пробить чек, и он должен уехать следующим разом, а не пропасть.
 */
export function outbox(db: SqlDriver): { payload: Payload; marks: Marks[] } {
  const payload: Payload = {};
  const marks: Marks[] = [];

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

    const rows = db.all<Row & { row_id: Id }>(
      `SELECT t.id AS row_id, t.uid AS id${select ? `, ${select}` : ''}
         FROM ${table} t
         JOIN sync_outbox o ON o.table_name = ? AND o.row_id = t.id
        WHERE t.uid IS NOT NULL`,
      [table],
    );

    if (rows.length === 0) continue;

    for (const row of rows) marks.push({ table, row_id: row.row_id });
    payload[table] = rows.map(({ row_id: _, ...rest }) => rest);
  }

  return { payload, marks };
}

/** Вычеркнуть отправленное — после того, как сервер сказал «принял». */
export function forgetOutbox(db: SqlDriver, marks: Marks[]): void {
  if (marks.length === 0) return;

  db.tx(() => {
    for (const mark of marks) {
      db.run('DELETE FROM sync_outbox WHERE table_name = ? AND row_id = ?', [
        mark.table,
        mark.row_id,
      ]);
    }
  });
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

/**
 * Наш номер строки по имени, каким её знают снаружи.
 *
 * Имён у записи может быть два: своё, под которым её завели здесь, и чужое,
 * под которым её знает другое устройство. Оба ведут к одной строке.
 */
export function localIdOf(db: SqlDriver, table: SyncTable, uid: string): Id | null {
  const own = db.get<{ id: Id }>(`SELECT id FROM ${table} WHERE uid = ?`, [uid]);
  if (own) return own.id;

  const alias = db.get<{ row_id: Id }>(
    'SELECT row_id FROM uid_alias WHERE table_name = ? AND uid = ?',
    [table, uid],
  );
  return alias ? alias.row_id : null;
}

/**
 * Узнать присланную запись по существу и связать её с нашей.
 *
 * Два случая, и они разные:
 *
 *   • у нашей строки имени ещё нет — берём присланное. Так проще всего:
 *     дальше обе базы зовут её одинаково;
 *   • имя у нашей строки уже есть, и другое — своё не трогаем (на него уже
 *     ссылается сервер и наши же чеки), а чужое запоминаем как второе.
 *
 * Возвращает номер нашей строки или `null`, если такой у нас нет.
 */
function recognize(db: SqlDriver, table: SyncTable, row: Row, uid: string): Id | null {
  for (const key of NATURAL[table] ?? []) {
    const value = row[key];
    if (value == null || value === '') continue;

    const twins = db.all<{ id: Id; uid: string | null }>(
      `SELECT id, uid FROM ${table} WHERE ${key} = ?`,
      [value as SqlParam],
    );
    if (twins.length !== 1) continue;

    const twin = twins[0];
    if (twin.uid == null) db.run(`UPDATE ${table} SET uid = ? WHERE id = ?`, [uid, twin.id]);
    else {
      db.run('INSERT OR REPLACE INTO uid_alias (table_name, uid, row_id) VALUES (?, ?, ?)', [
        table,
        uid,
        twin.id,
      ]);
    }
    return twin.id;
  }

  return null;
}

export function applyPull(db: SqlDriver, changes: Payload): Applied {
  const result: Applied = { added: 0, updated: 0, skipped: 0 };

  db.tx(() => {
    // Тихо: принятое с сервера обратно не отправляется. Иначе обмен гонял бы
    // одни и те же строки по кругу и никогда не затихал.
    db.run('INSERT OR REPLACE INTO sync_quiet (id) VALUES (1)');

    for (const table of SYNC_TABLES) {
      const rows = changes[table];
      if (!rows?.length) continue;

      for (const row of rows) {
        const uid = String(row.id ?? '').trim();
        if (!uid) {
          result.skipped += 1;
          continue;
        }

        let id = localIdOf(db, table, uid);

        // Под этим именем записи нет — но, может быть, она у нас есть под
        // другим: магазин узнаётся по названию, товар по штрихкоду.
        if (id === null) id = recognize(db, table, row, uid);
        const known = id === null ? null : { id };

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

    db.run('DELETE FROM sync_quiet');
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
  docs: { created_at: '', type: 'correction' },
  sales: { created_at: '', total: 0, cost_total: 0 },
  sale_items: { qty: 0, price: 0, cost_price: 0 },
  stock_moves: { created_at: '', qty_delta: 0, reason: 'correction' },
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
        // На сервере «в архиве» — это да/нет, у нас 1 и 0. Оставить как есть
        // нельзя: часть драйверов такое значение просто не примет.
        values[column] =
          typeof incoming === 'boolean' ? (incoming ? 1 : 0) : (incoming as SqlParam);
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

    const found = localIdOf(db, target, uid);
    if (found === null) return null;
    values[column] = found;
  }

  return values;
}
