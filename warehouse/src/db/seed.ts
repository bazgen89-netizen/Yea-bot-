import type { SqlDriver } from './driver';
import { ensureLocation, listLocations } from './locations';
import CLIENTS from './seed/clients.json';
import PHOTOS from './seed/photos.json';
import CATALOG from './seed/products.json';
import SALES from './seed/sales.json';

/**
 * Пример данных — каталог одной чайной: 590 позиций с остатками по магазинам
 * и 3184 карточки клиентов. Он лежит рядом с программой, но **сам не
 * загружается**: программой пользуется не один магазин, и чужой каталог в
 * свежей установке пришлось бы вычищать вручную, по позиции.
 *
 * Загружают его руками — «Товары и услуги → Импорт → Загрузить пример», —
 * когда хочется посмотреть на экраны до того, как появились свои данные.
 * Каждая часть заводится один раз: отметка в `app_state` не даёт повторить
 * загрузку и затереть то, что успели наработать.
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
  /** Категория. Пусто — товар без категории. */
  g?: string | null;
  /** Остатки: название магазина → количество в тысячных. */
  q: Record<string, number>;

  // Ниже — то, что приезжает из CloudShop вместе с карточкой. Поля
  // необязательные: старая выгрузка их не знает, и падать из-за этого
  // программа не должна.

  /** Штрихкод — по нему товар находит сканер. */
  bc?: string | null;
  /** Код весов, PLU. */
  plu?: string | null;
  /** Описание из карточки. */
  desc?: string | null;
  /** Вес, граммы. */
  wg?: number | null;
  /** Размеры, миллиметры. */
  hm?: number | null;
  wm?: number | null;
  dm?: number | null;
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

  /** Идентификатор в CloudShop — по нему к клиенту привязываются его чеки. */
  id?: string | null;
  /** Остальные телефоны, если их несколько. */
  ph?: string[] | null;
  /** Личная скидка, сотые доли процента. */
  dc?: number | null;
  /** Бонусный счёт и уже потраченные бонусы, копейки. */
  bo?: number | null;
  bs?: number | null;
  /** Вид лояльности: скидка или бонусы. */
  lt?: string | null;
}

/** Чек из истории покупок CloudShop. */
interface SeedSale {
  /** Когда пробит. */
  at: string | null;
  /** Клиент — идентификатором CloudShop. */
  c: string | null;
  /** Итог и скидка, копейки. */
  t: number;
  disc: number;
  pay: string;
  /** Магазин. */
  st: string | null;
  /** Номер документа. */
  no: string | null;
  ln: {
    code: string | null;
    n: string | null;
    q: number;
    p: number;
    d: number;
  }[];
}

/**
 * Пример данных — каталог и клиенты одной чайной.
 *
 * **Не загружается сам.** Программа предназначена не одному магазину: чужой
 * каталог, приехавший вместе с установкой, пришлось бы удалять вручную, по
 * позиции. Новая база пуста, а свои товары и клиентов заводят импортом из
 * файла (`Товары и услуги → Импорт`) или руками.
 *
 * Пример остаётся, чтобы было на чём посмотреть программу до того, как
 * появились свои данные: «Товары и услуги → Импорт → Загрузить пример».
 */
export function seedCatalog(db: SqlDriver): void {
  seedProducts(db);
  seedClients(db);
  seedRegisters(db);
  seedHistory(db);
}

/**
 * Кто есть кто: идентификатор клиента в CloudShop → наш.
 *
 * Заполняется при загрузке клиентов и нужен ровно для одного — разложить
 * историю покупок по карточкам. Имена для этого не годятся: тёзок в базе на
 * три тысячи человек хватает.
 */
const cloudCustomers = new Map<string, number>();

/** Пустая ли база: по ней экран данных решает, предлагать ли пример. */
export function isEmpty(db: SqlDriver): boolean {
  const row = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM products');
  return (row?.n ?? 0) === 0;
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
    // Категории заводятся по мере встречи, а не отдельным списком: список
    // и товары разошлись бы при первой же выгрузке, где категорию убрали.
    const categories = new Map<string, number>();
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
      const search = [item.n, item.s, item.c, item.bc]
        .filter((v): v is string => Boolean(v?.trim()))
        .map((v) => v.trim().toLowerCase())
        .join(' ');

      let categoryId: number | null = null;
      if (item.g?.trim()) {
        const name = item.g.trim();
        categoryId = categories.get(name) ?? null;
        if (categoryId === null) {
          db.run(
            `INSERT INTO categories (name, sort)
             VALUES (?, (SELECT COALESCE(MAX(sort) + 1, 0) FROM categories))`,
            [name],
          );
          categoryId = db.lastInsertId();
          categories.set(name, categoryId);
        }
      }

      // Фотография ищется по коду товара: артикул и штрихкод есть не у всех,
      // код есть всегда. Пока `scripts/sync-photos.mjs` не запускали, файл
      // пуст, и товары идут без картинок — как и было.
      const photo = item.c ? ((PHOTOS as Record<string, string>)[item.c] ?? null) : null;

      db.run(
        `INSERT INTO products
           (name, sku, code, barcode, category_id, unit, cost_price, sale_price, min_qty,
            discount_bp, photo_uri, created_at, search_text,
            plu_code, description, weight_g, height_mm, width_mm, depth_mm)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.n,
          item.s,
          item.c,
          item.bc ?? null,
          categoryId,
          item.u,
          item.p,
          item.d,
          photo,
          now,
          search,
          item.plu ?? null,
          item.desc ?? null,
          item.wg ?? null,
          item.hm ?? null,
          item.wm ?? null,
          item.dm ?? null,
        ],
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
            birthday, gender, address, created_by,
            loyalty_type, bonus_balance, bonus_spent, phones)
         VALUES ('customer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          client.n,
          client.p,
          client.e,
          client.d,
          client.dc ?? 0,
          now,
          search,
          client.b,
          client.g,
          client.a,
          client.by,
          client.lt ?? null,
          client.bo ?? 0,
          client.bs ?? 0,
          JSON.stringify(client.ph ?? (client.p ? [client.p] : [])),
        ],
      );

      // Кто есть кто в CloudShop — нужно, чтобы разложить историю покупок.
      if (client.id) cloudCustomers.set(client.id, db.lastInsertId());
    }

    db.run('INSERT INTO app_state (key, value) VALUES (?, ?)', [DONE_KEY, now]);
  });
}

/** Сколько позиций и карточек в поставляемых данных — для сообщений и тестов. */
export const SEED_PRODUCTS = (CATALOG as SeedProduct[]).length;
export const SEED_CLIENTS = (CLIENTS as SeedClient[]).length;

/**
 * История покупок из CloudShop.
 *
 * Чеки заводятся **без движений склада**, и это главное в этой функции.
 * Остатки, которые пришли вместе с каталогом, уже учитывают все эти продажи:
 * если списать товар ещё раз, склад уйдёт в минус ровно на всё, что магазин
 * когда-либо продал.
 *
 * То есть история здесь — это память о том, кто что покупал: она нужна
 * карточке клиента, отчётам по продажам и подсказкам «покупают вместе».
 * Складом распоряжается каталог, а не она.
 */
function seedHistory(db: SqlDriver): void {
  const DONE_KEY = 'history_seeded';
  const done = db.get<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [DONE_KEY]);
  if (done) return;

  const sales = SALES as SeedSale[];
  if (sales.length === 0) return;

  const now = new Date().toISOString();

  // Товары ищутся по коду: он есть у каждой позиции и не меняется.
  const byCode = new Map<string, { id: number; cost: number }>();
  for (const row of db.all<{ id: number; code: string | null; cost_price: number }>(
    'SELECT id, code, cost_price FROM products WHERE code IS NOT NULL',
  )) {
    if (row.code) byCode.set(row.code, { id: row.id, cost: row.cost_price });
  }

  const stores = new Map(
    listLocations(db).map((location) => [location.name, location.id as number]),
  );

  db.tx(() => {
    for (const sale of sales) {
      const lines = sale.ln
        .map((line) => ({ line, product: line.code ? byCode.get(line.code) : undefined }))
        .filter((row): row is { line: SeedSale['ln'][number]; product: { id: number; cost: number } } =>
          Boolean(row.product),
        );

      // Чек, в котором не нашлось ни одного товара, не заводим: пустая
      // строка в истории ничего не рассказывает, а в отчётах мешает.
      if (lines.length === 0) continue;

      const cost = lines.reduce(
        (sum, row) => sum + Math.round((row.product.cost * row.line.q) / 1000),
        0,
      );

      db.run(
        `INSERT INTO sales (discount, total, cost_total, payment, created_at, customer_id, note, location_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sale.disc,
          sale.t,
          cost,
          sale.pay === 'card' || sale.pay === 'transfer' ? sale.pay : 'cash',
          sale.at ?? now,
          sale.c ? (cloudCustomers.get(sale.c) ?? null) : null,
          sale.no ? `CloudShop №${sale.no}` : null,
          sale.st ? (stores.get(sale.st) ?? null) : null,
        ],
      );
      const saleId = db.lastInsertId();

      for (const { line, product } of lines) {
        db.run(
          `INSERT INTO sale_items (sale_id, product_id, qty, price, cost_price)
           VALUES (?, ?, ?, ?, ?)`,
          [saleId, product.id, line.q, line.p, product.cost],
        );
      }
    }

    db.run('INSERT INTO app_state (key, value) VALUES (?, ?)', [DONE_KEY, now]);
  });
}
