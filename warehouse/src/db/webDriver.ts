import type { SqlDriver, SqlParam } from './driver';
import { migrate } from './schema';

/**
 * База для браузера — на sql.js вместо expo-sqlite.
 *
 * Зачем свой драйвер: веб-версия expo-sqlite держит базу в воркере и общается
 * с ним через `SharedArrayBuffer`. Такой буфер браузер выдаёт только странице
 * с заголовками `Cross-Origin-Opener-Policy` и `Cross-Origin-Embedder-Policy`,
 * а обычный статический хостинг их не ставит — приложение просто не открылось
 * бы по ссылке. Заодно у того канала фиксированный буфер ответа в мегабайт:
 * длинный список товаров в него не помещался и приходил обрезанным.
 *
 * sql.js — та же SQLite, собранная в WebAssembly, работает прямо в странице
 * и синхронно. То есть ровно то, чего ждёт `SqlDriver`.
 *
 * На телефоне этот файл не используется: там нативный SQLite (`expoDriver`).
 */

/** Минимум из API sql.js, который нам нужен. Пакет типизируем сами: */
interface SqlJsStatement {
  bind(params: SqlParam[]): void;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}

interface SqlJsDatabase {
  run(sql: string, params?: SqlParam[]): void;
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  prepare(sql: string): SqlJsStatement;
  export(): Uint8Array;
  close(): void;
}

export const DATABASE_NAME = 'warehouse.db';

/**
 * Ссылка на базу, которую можно подменить.
 *
 * Касса открывается отдельным окном, и в каждом окне своя копия базы в
 * памяти. Когда одно окно сохранило файл, второе перечитывает его целиком —
 * для этого экраны не должны держать ссылку на прежний объект sql.js.
 */
export interface DbBox {
  current: SqlJsDatabase;
}

export function createWebDriver(box: DbBox, onChange: () => void): SqlDriver {
  /**
   * Глубина вложенности транзакций. SQLite не умеет вкладывать BEGIN в BEGIN,
   * а `db.tx()` у нас вызывается и снаружи, и внутри (например, загрузка
   * клиентской базы зовёт создание карточки). Считаем уровень сами.
   */
  let depth = 0;

  const rows = <T>(sql: string, params: SqlParam[]): T[] => {
    const statement = box.current.prepare(sql);
    try {
      statement.bind(params);
      const result: T[] = [];
      while (statement.step()) result.push(statement.getAsObject() as T);
      return result;
    } finally {
      statement.free();
    }
  };

  return {
    run(sql, params = []) {
      box.current.run(sql, params);
      if (depth === 0) onChange();
    },
    all<T>(sql: string, params: SqlParam[] = []): T[] {
      return rows<T>(sql, params);
    },
    get<T>(sql: string, params: SqlParam[] = []): T | null {
      return rows<T>(sql, params)[0] ?? null;
    },
    lastInsertId(): number {
      const row = rows<{ id: number }>('SELECT last_insert_rowid() AS id', []);
      return Number(row[0]?.id ?? 0);
    },
    tx<T>(fn: () => T): T {
      if (depth > 0) return fn();

      box.current.run('BEGIN');
      depth++;
      try {
        const result = fn();
        depth--;
        box.current.run('COMMIT');
        onChange();
        return result;
      } catch (error) {
        depth--;
        box.current.run('ROLLBACK');
        throw error;
      }
    },
    exec(sql) {
      box.current.exec(sql);
      if (depth === 0) onChange();
    },
    snapshot() {
      return box.current.export();
    },
    async restore(bytes) {
      // Копия кладётся сразу в хранилище, минуя базу в памяти: подменить её
      // на живой странице нельзя — экраны держат ссылку на прежнюю. Поэтому
      // сохраняем файл и перезагружаемся, чтобы приложение открыло его как
      // обычную сохранённую базу.
      await writeSaved(bytes);
      globalThis.location?.reload();
    },
  };
}

/**
 * Открывает базу браузера и приводит её к актуальной схеме.
 *
 * Файл базы лежит в IndexedDB целиком: sql.js держит её в памяти, поэтому после
 * изменений её надо выгрузить и сохранить. Сохранение отложенное — иначе каждая
 * строка чека переписывала бы весь файл.
 */
export async function openWebDatabase(): Promise<SqlDriver> {
  const SQL = await loadSqlJs();
  const saved = await readSaved();

  const box: DbBox = { current: saved ? new SQL.Database(saved) : new SQL.Database() };

  /**
   * Разговор между окнами.
   *
   * Касса открывается своим окном, а кабинет остаётся в первом. База у них
   * одна — файл в IndexedDB, — но в памяти у каждого окна своя копия. Значит,
   * сохранив, надо сказать соседу: перечитай. Иначе кассир пробьёт чек, а в
   * кабинете остаток останется прежним до перезагрузки.
   */
  const channel =
    typeof globalThis.BroadcastChannel === 'function'
      ? new globalThis.BroadcastChannel('wayshop-db')
      : null;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const stamp = `${WRITER}:${Date.now()}`;
      lastStamp = stamp;
      void writeSaved(box.current.export(), stamp).then(() => channel?.postMessage('saved'));
    }, 300);
  };

  const driver = createWebDriver(box, save);

  /** Перечитать файл целиком — соседнее окно его переписало. */
  const reload = () => {
    // Своя несохранённая правка живёт не дольше трёхсот миллисекунд — столько
    // же, сколько ждёт отложенное сохранение. Поэтому перечитываем файл
    // целиком: это проще и честнее, чем сводить две копии.
    if (timer) return;

    void readSaved().then((bytes) => {
      if (!bytes) return;
      box.current.close();
      box.current = new SQL.Database(bytes);
      for (const listener of reloaded) listener();
    });
  };

  if (channel) {
    channel.onmessage = (event: MessageEvent) => {
      if (event.data === 'saved') reload();
    };
  }

  /**
   * Опрос метки — на случай, когда окна друг друга не слышат.
   *
   * Так и выходит, когда страницу открыли **файлом с диска**: у каждого окна
   * свой «источник», и `BroadcastChannel` между ними молчит. Хранилище при
   * этом общее — значит, узнать о чужой записи можно, поглядывая на короткую
   * метку рядом с файлом базы. Читается она за миллисекунды, сам файл
   * перечитывается только когда метка чужая.
   */
  setInterval(() => {
    void readStamp().then((stamp) => {
      if (!stamp || stamp === lastStamp) return;
      lastStamp = stamp;
      reload();
    });
  }, 2000);

  migrate(driver);

  // Пример данных при запуске не грузится: программой пользуется не один
  // магазин, и чужой каталог в свежей установке пришлось бы вычищать руками.
  // Исключение — сборка для показа: в ней флаг ставится при сборке, и пустая
  // витрина не имела бы смысла.
  if ((globalThis as { __DEMO__?: boolean }).__DEMO__) {
    const { seedCatalog } = await import('./seed');
    seedCatalog(driver);
  }

  save();

  return driver;
}

/**
 * Кто хочет знать, что база перечитана из-за соседнего окна.
 *
 * Провайдер базы подписывается сюда и поднимает ревизию — экраны
 * перечитывают запросы, как после обычной записи.
 */
const reloaded = new Set<() => void>();

export function onDatabaseReloaded(listener: () => void): () => void {
  reloaded.add(listener);
  return () => reloaded.delete(listener);
}

// --- загрузка sql.js ------------------------------------------------------

interface SqlJsStatic {
  Database: new (data?: Uint8Array) => SqlJsDatabase;
}

declare global {
  // eslint-disable-next-line no-var
  var initSqlJs: ((config?: { wasmBinary?: ArrayBuffer; locateFile?: (f: string) => string }) => Promise<SqlJsStatic>) | undefined;
  // eslint-disable-next-line no-var
  var __SQL_WASM_BASE64__: string | undefined;
}

let loading: Promise<SqlJsStatic> | null = null;

function loadSqlJs(): Promise<SqlJsStatic> {
  loading ??= (async () => {
    const init = globalThis.initSqlJs;
    if (!init) {
      throw new Error(
        'Не найден sql.js. Страница должна подключать sql-wasm.js до кода приложения.',
      );
    }

    // Когда страница собрана одним файлом, wasm лежит в ней же строкой base64 —
    // так ссылке не нужен ни один сторонний запрос.
    const inlined = globalThis.__SQL_WASM_BASE64__;
    if (inlined) return init({ wasmBinary: base64ToBytes(inlined).buffer as ArrayBuffer });

    return init({ locateFile: (file: string) => file });
  })();

  return loading;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// --- хранение файла базы --------------------------------------------------

const STORE = 'files';

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('warehouse-web', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readSaved(): Promise<Uint8Array | null> {
  try {
    const store = await openStore();
    return await new Promise((resolve, reject) => {
      const request = store.transaction(STORE, 'readonly').objectStore(STORE).get(DATABASE_NAME);
      request.onsuccess = () => {
        const value = request.result as ArrayBuffer | Uint8Array | undefined;
        if (!value) resolve(null);
        else resolve(value instanceof Uint8Array ? value : new Uint8Array(value));
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    // Приватный режим браузера может не дать IndexedDB. База тогда живёт
    // до закрытия вкладки — это лучше, чем не открыться вовсе.
    return null;
  }
}

/**
 * Кто пишет и что записано последним.
 *
 * `WRITER` — случайное имя этого окна на время его жизни; метка `writer:время`
 * ложится рядом с файлом при каждом сохранении. Своя метка — свои же данные,
 * перечитывать нечего; чужая — соседнее окно что-то записало.
 */
const WRITER = Math.random().toString(36).slice(2);
const STAMP_KEY = `${DATABASE_NAME}.stamp`;

let lastStamp = '';

async function readStamp(): Promise<string | null> {
  try {
    const store = await openStore();
    return await new Promise<string | null>((resolve) => {
      const request = store.transaction(STORE).objectStore(STORE).get(STAMP_KEY);
      request.onsuccess = () => resolve((request.result as string) ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writeSaved(bytes: Uint8Array, stamp?: string): Promise<void> {
  try {
    const store = await openStore();
    await new Promise<void>((resolve, reject) => {
      const tx = store.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(bytes, DATABASE_NAME);
      if (stamp) tx.objectStore(STORE).put(stamp, STAMP_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Не сохранилось — работать это не мешает, данные останутся в памяти.
  }
}
