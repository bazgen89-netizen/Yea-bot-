import type { SqlDriver } from './driver';
import { ensureLocation, listLocations } from './locations';
import CLIENTS from './seed/clients.json';
import CATALOG from './seed/products.json';

/**
 * Первичное наполнение базы данными WAYSTEA.
 *
 * Чтобы приложение было на чём проверять, оно приходит с настоящими данными:
 * 661 позиция каталога с остатками по трём магазинам и 3184 карточки клиентов —
 * те же выгрузки, что делает рабочая программа. Каждая загружается один раз:
 * отметка в `app_state` не даёт повторить её при следующем запуске и затереть
 * то, что успели наработать.
 *
 * Числа в файлах уже приведены к внутренним единицам: цены — копейки,
 * количества — тысячные. Так разбор не повторяется на каждом запуске телефона.
 */

interface SeedProduct {
  /** Наименование. */
  n: string;
  /** Код. */
  c: string | null;
  /** Артикул. */
  s: string | null;
  /** Единица измерения. */
  u: string;
  /** Цена продажи, копейки. */
  p: number;
  /** Скидка, сотые доли процента. */
  d: number;
  /** Остатки: название магазина → количество в тысячных. */
  q: Record<string, number>;
}

interface SeedClient {
  /** Наименование — так колонка называется в выгрузке. */
  n: string;
  /** Телефон. */
  p: string | null;
  e: string | null;
  /** День рождения строкой, как в выгрузке: «13/07/2006». */
  b: string | null;
  /** Пол: «Мужской» / «Женский». */
  g: string | null;
  /** Описание. */
  d: string | null;
  /** Адрес. */
  a: string | null;
  /** Кто завёл карточку. */
  by: string | null;
}

/** Загружает всё, что ещё не загружено. Безопасно звать при каждом запуске. */
export function seedCatalog(db: SqlDriver): void {
  seedProducts(db);
  seedClients(db);
  seedRegisters(db);
}

/**
 * По кассе на магазин.
 *
 * Заводится после товаров: магазины появляются вместе с остатками, и до
 * этого привязывать кассу не к чему. Пустой раздел «Кассы» выглядел бы
 * поломкой, а не свежей установкой.
 */
function seedRegisters(db: SqlDriver): void {
  const DONE_KEY = 'registers_seeded';
  const done = db.get<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [DONE_KEY]);
  if (done) return;

  const now = new Date().toISOString();

  db.tx(() => {
    for (const location of listLocations(db)) {
      db.run('INSERT INTO registers (name, location_id, created_at) VALUES (?, ?, ?)', [
        `Касса — ${location.name}`,
        location.id,
        now,
      ]);
    }

    db.run('INSERT INTO app_state (key, value) VALUES (?, ?)', [DONE_KEY, now]);
  });
}

function seedProducts(db: SqlDriver): void {
  const DONE_KEY = 'catalog_seeded';
  const done = db.get<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [DONE_KEY]);
  if (done) return;

  const products = CATALOG as SeedProduct[];
  const now = new Date().toISOString();

  db.tx(() => {
    const locations = new Map<string, number>();
    // Документ, которым остатки попали на склад. Без него движения висели бы
    // сами по себе, а на вопрос «откуда тут 416 грамм» ответить было бы нечем.
    const docs = new Map<number, number>();

    const documentFor = (locationId: number): number => {
      const known = docs.get(locationId);
      if (known !== undefined) return known;

      db.run(
        `INSERT INTO docs (type, counterparty, note, created_at, location_id)
         VALUES ('adjust', NULL, 'Загрузка каталога', ?, ?)`,
        [now, locationId],
      );
      const id = db.lastInsertId();
      docs.set(locationId, id);
      return id;
    };

    for (const item of products) {
      const search = [item.n, item.s, item.c]
        .filter((v): v is string => Boolean(v?.trim()))
        .map((v) => v.trim().toLowerCase())
        .join(' ');

      db.run(
        `INSERT INTO products
           (name, sku, barcode, category_id, unit, cost_price, sale_price, min_qty,
            photo_uri, created_at, search_text)
         VALUES (?, ?, NULL, NULL, ?, 0, ?, 0, NULL, ?, ?)`,
        [item.n, item.s, item.u, item.p, now, search],
      );
      const productId = db.lastInsertId();

      for (const [store, qty] of Object.entries(item.q)) {
        // Ноль остатка движением не записываем: движения нет — и строки быть
        // не должно, иначе история засоряется пустыми записями.
        if (qty === 0) continue;

        let locationId = locations.get(store);
        if (locationId === undefined) {
          locationId = ensureLocation(db, store);
          locations.set(store, locationId);
        }

        // Инвентаризация, а не приход: в выгрузке остаток уже итоговый,
        // и «сколько пришло» из неё неизвестно.
        db.run(
          `INSERT INTO stock_moves
             (product_id, qty_delta, reason, price, created_at, location_id, doc_id)
           VALUES (?, ?, 'adjust', ?, ?, ?, ?)`,
          [productId, qty, item.p, now, locationId, documentFor(locationId)],
        );
      }
    }

    db.run('INSERT INTO app_state (key, value) VALUES (?, ?)', [DONE_KEY, now]);
  });
}

/**
 * Клиентская база.
 *
 * Данные переносятся как есть, даже когда они странные: в выгрузке хватает
 * карточек, где в имени записан телефон, а в телефоне имя. Это ошибки ввода,
 * но чинить их за пользователя нельзя — он ищет клиента ровно по тому, что
 * когда-то набрал, и «исправленная» карточка просто перестанет находиться.
 */
function seedClients(db: SqlDriver): void {
  const DONE_KEY = 'clients_seeded';
  const done = db.get<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [DONE_KEY]);
  if (done) return;

  const clients = CLIENTS as SeedClient[];
  const now = new Date().toISOString();

  db.tx(() => {
    for (const client of clients) {
      const digits = (client.p ?? '').replace(/\D/g, '');
      const search = [client.n, client.p, client.e]
        .filter((v): v is string => Boolean(v?.trim()))
        .map((v) => v.trim().toLowerCase())
        .concat(digits.length >= 10 ? [digits.slice(-10)] : [])
        .join(' ');

      db.run(
        `INSERT INTO counterparties
           (kind, name, phone, email, note, discount_bp, created_at, search_text,
            birthday, gender, address, created_by)
         VALUES ('customer', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        [
          client.n,
          client.p,
          client.e,
          client.d,
          now,
          search,
          client.b,
          client.g,
          client.a,
          client.by,
        ],
      );
    }

    db.run('INSERT INTO app_state (key, value) VALUES (?, ?)', [DONE_KEY, now]);
  });
}

/** Сколько позиций и карточек в поставляемых данных — для сообщений и тестов. */
export const SEED_PRODUCTS = (CATALOG as SeedProduct[]).length;
export const SEED_CLIENTS = (CLIENTS as SeedClient[]).length;
