import type { SqlDriver } from './driver';
import { ensureLocation, listLocations } from './locations';
import CLIENTS from './seed/clients.json';
import STORES from './seed/stores.json';
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
  /** Кешбэк — сколько процентов покупки возвращается бонусами, сотые доли. */
  cb?: number | null;
  /** Вид лояльности: скидка или бонусы. */
  lt?: string | null;
  /** Когда карточку завели, ISO. Пусто — считаем днём загрузки. */
  at?: string | null;
}

/** Чек из истории покупок CloudShop. */
interface SeedSale {
  /** Когда пробит. */
  at: string | null;
  /** Клиент — идентификатором CloudShop. */
  c: string | null;
  /**
   * Как покупатель подписан в самом чеке.
   *
   * Нужен на случай, когда карточки в справочнике уже нет: чек всё равно
   * останется подписанным, а не потеряет покупателя. У розничных продаж поля
   * нет вовсе — там и подписывать нечего.
   */
  cn?: string | null;
  /**
   * Итог и скидка, копейки.
   *
   * Числа необязательные: в файле истории нули не записываются — на сорока
   * пяти тысячах чеков они одни весят мегабайты. Отсутствие поля здесь и
   * означает ноль.
   */
  t?: number;
  disc?: number;
  pay?: string;
  /** Магазин. */
  st?: string | null;
  /** Кто пробил чек — учётная запись. */
  au?: string | null;
  /** Номер документа в CloudShop: «Продажа #45658». */
  no?: number | string | null;
  /** Номер прихода — под ним чек виден в движении денег. */
  ono?: number | null;
  /** Бонусы по чеку: начислено и списано, копейки. */
  be?: number;
  bu?: number;
  ln: {
    code?: string | null;
    /** Имя — только у товаров, которых в справочнике уже нет. */
    n?: string | null;
    q?: number;
    p?: number;
    d?: number;
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
  seedStoreAddresses(db);
  seedClients(db);
  seedRegisters(db);
  seedHistory(db);
}

/**
 * Адреса магазинов.
 *
 * Проставляются после товаров: магазины появляются вместе с остатками, и до
 * этого адрес писать некуда. В выборе магазина адрес стоит второй строкой —
 * без него два «Чайный бар» в списке отличить не по чему.
 */
function seedStoreAddresses(db: SqlDriver): void {
  // Файл писали две разные выгрузки, и поля в нём называются по-разному:
  // старая клала `name`/`address`, новая — короткие `n`/`a`. Читаем оба:
  // ронять наполнение из-за имени поля незачем.
  for (const store of STORES as { n?: string; a?: string; name?: string; address?: string }[]) {
    const name = (store.n ?? store.name ?? '').trim();
    const address = (store.a ?? store.address ?? '').trim();
    if (!name || !address) continue;

    db.run('UPDATE locations SET address = ? WHERE name = ?', [address, name]);
  }
}

/**
 * Кто есть кто: идентификатор клиента в CloudShop → наш.
 *
 * Заполняется при загрузке клиентов и нужен ровно для одного — разложить
 * историю покупок по карточкам. Имена для этого не годятся: тёзок в базе на
 * три тысячи человек хватает.
 */
const cloudCustomers = new Map<string, number>();

/**
 * Восстановить эту таблицу, если клиентов завели не в этот раз.
 *
 * Части наполнения помечаются в `app_state` по отдельности, и порядок бывает
 * любой: клиенты уже загружены прошлым запуском, а история приехала только
 * сейчас. Тогда `seedClients` выходит сразу, таблица остаётся пустой, и вся
 * история легла бы без покупателей.
 *
 * Собственного столбца под идентификатор CloudShop у карточки нет, поэтому
 * сверяем по телефону, а при его отсутствии — по имени. Этого хватает: обе
 * стороны сравнения пришли из одной и той же выгрузки.
 */
function ensureCloudCustomers(db: SqlDriver): void {
  if (cloudCustomers.size > 0) return;

  const byPhone = new Map<string, number>();
  const byName = new Map<string, number>();

  for (const row of db.all<{ id: number; name: string; phone: string | null }>(
    "SELECT id, name, phone FROM counterparties WHERE kind = 'customer'",
  )) {
    const digits = (row.phone ?? '').replace(/\D/g, '');
    if (digits.length >= 10 && !byPhone.has(digits)) byPhone.set(digits, row.id);

    const name = row.name.trim().toLowerCase();
    if (name && !byName.has(name)) byName.set(name, row.id);
  }

  for (const client of CLIENTS as SeedClient[]) {
    if (!client.id) continue;

    const digits = (client.p ?? '').replace(/\D/g, '');
    const found =
      (digits.length >= 10 ? byPhone.get(digits) : undefined) ??
      byName.get(client.n.trim().toLowerCase());

    if (found !== undefined) cloudCustomers.set(client.id, found);
  }
}

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
      // Ищут клиента по имени и по телефону — значит, в подписи должно быть
      // и то, и другое, и все запасные номера тоже: второй телефон человек
      // помнит не хуже первого.
      const phones = [client.p, ...(client.ph ?? [])].filter((v): v is string =>
        Boolean(v?.trim()),
      );

      const parts = [client.n, client.e, ...phones]
        .filter((v): v is string => Boolean(v?.trim()))
        .map((v) => v.trim().toLowerCase());

      // Телефон — ещё и голыми цифрами: «+7 (961) 253-27-57» ищут набором
      // «9612532757».
      for (const phone of phones) {
        const digits = phone.replace(/\D/g, '');
        if (digits.length >= 10) parts.push(digits.slice(-10));
      }

      const search = [...new Set(parts)].join(' ');

      db.run(
        `INSERT INTO counterparties
           (kind, name, phone, email, note, discount_bp, created_at, search_text,
            birthday, gender, address, created_by,
            loyalty_type, bonus_balance, bonus_spent, cashback_bp, phones)
         VALUES ('customer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          client.n,
          client.p,
          client.e,
          client.d,
          client.dc ?? 0,
          client.at ?? now,
          search,
          client.b,
          client.g,
          client.a,
          client.by,
          client.lt ?? null,
          client.bo ?? 0,
          client.bs ?? 0,
          client.cb ?? 0,
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
export const SEED_SALES = (SALES as SeedSale[]).length;

/**
 * Подпись поставляемых данных: «590:3206:45765».
 *
 * Нужна, чтобы новый файл программы **привозил** новые данные, а не делал
 * вид. Каждая часть наполнения помечается в `app_state` и второй раз не
 * заводится — иначе повторный запуск задваивал бы каталог. Но у этой защиты
 * есть обратная сторона: когда приходит файл со свежей выгрузкой, браузер
 * открывает его со старой базой, отметки уже стоят, и ничего не грузится.
 * Снаружи это выглядит так, будто перенос не сработал.
 *
 * Подпись меняется вместе с данными — по ней сборка со своими данными
 * понимает, что выгрузка другая, и заводит её заново.
 */
export const SEED_STAMP = `${SEED_PRODUCTS}:${SEED_CLIENTS}:${SEED_SALES}`;

/** Ключ, под которым подпись лежит в базе. */
const STAMP_KEY = 'seed_stamp';

/** Какая выгрузка сейчас в базе. `null` — наполнения ещё не было. */
export function loadedSeedStamp(db: SqlDriver): string | null {
  const row = db.get<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [STAMP_KEY]);
  return row?.value ?? null;
}

export function rememberSeedStamp(db: SqlDriver): void {
  db.run('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)', [STAMP_KEY, SEED_STAMP]);
}

/**
 * Стереть всё, что завело наполнение, — чтобы завести заново.
 *
 * Вызывается **только** в сборке, которая везёт данные с собой: там вся база
 * и есть эта выгрузка, и заменить её целиком честнее, чем сличать построчно.
 * В обычной установке этого не происходит никогда — там наполнение
 * запускают руками и один раз.
 *
 * Таблицы чистятся от зависимых к главным: сначала строки чеков, потом чеки,
 * иначе ссылки повисают.
 */
export function resetSeed(db: SqlDriver): void {
  // Связи между таблицами на время очистки снимаем.
  //
  // Иначе порядок удаления становится головоломкой, а цена ошибки — «Не
  // удалось открыть исходные данные. Нарушено ограничение внешнего ключа»
  // при запуске программы. Ровно это и вышло: смена ссылается на кассу, а
  // кассы я стирал раньше смен, — и файл не открывался вовсе.
  //
  // Снимать надо **снаружи** транзакции: внутри неё `PRAGMA foreign_keys`
  // молча ничего не делает, и защита осталась бы включённой.
  //
  // Опасности в этом нет: стираются все таблицы разом, и висячих ссылок
  // после очистки не остаётся — их не на что оставлять.
  db.exec('PRAGMA foreign_keys = OFF;');

  try {
    db.tx(() => {
      // Порядок всё равно от зависимых к главным: если проверку однажды
      // не выйдет снять, очистка должна пройти и так.
      for (const table of [
        'sale_items',
        'doc_payments',
        'doc_lines',
        'reco_items',
        'reco_lists',
        'product_set_items',
        'product_packs',
        'product_prices',
        'product_categories',
        'debt_payments',
        'held_receipts',
        'money_docs',
        'stock_moves',
        'sales',
        'docs',
        'shifts',
        'registers',
        'products',
        'categories',
        'counterparties',
        'locations',
      ]) {
        db.run(`DELETE FROM ${table}`);
      }

      // Отметки о том, что часть уже заведена, снимаются вместе с данными:
      // иначе следующий проход снова ничего не сделает.
      db.run(
        `DELETE FROM app_state
          WHERE key IN ('catalog_seeded', 'clients_seeded', 'registers_seeded', 'history_seeded')`,
      );
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }

  // Соответствие «клиент CloudShop → наш» собрано для стёртых карточек и
  // теперь ведёт в никуда. Не очистить его — и вся история легла бы на
  // случайные номера.
  cloudCustomers.clear();
}

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

  ensureCloudCustomers(db);
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
    /**
     * Товар, которого в справочнике уже нет, — заводим в архив.
     *
     * Раньше строка с таким товаром выбрасывалась, а чек, где все строки
     * такие, не заводился вовсе. Из-за этого у клиента вместо шестнадцати
     * покупок оказывалось четырнадцать, а сумма не сходилась с кабинетом —
     * ровно на те чеки, где куплено что-то давно снятое с продажи.
     *
     * Позиция заводится архивной: в справочнике и на витрине её не видно,
     * продать её нельзя, а история остаётся целой. Так же поступает и
     * CloudShop: в карточке клиента такие товары показаны наравне с
     * остальными.
     */
    const gone = new Map<string, number>();
    const now = new Date().toISOString();

    const missingProduct = (code: string, name: string | null, price: number): number => {
      const known = gone.get(code);
      if (known !== undefined) return known;

      const title = name?.trim() || `Товар ${code}`;
      db.run(
        `INSERT INTO products
           (name, sku, code, barcode, category_id, unit, cost_price, sale_price, min_qty,
            discount_bp, photo_uri, created_at, search_text, archived)
         VALUES (?, NULL, ?, NULL, NULL, 'шт', 0, ?, 0, 0, NULL, ?, ?, 1)`,
        [title, code, price, now, `${title} ${code}`.toLowerCase()],
      );

      const id = db.lastInsertId();
      gone.set(code, id);
      return id;
    };

    for (const sale of sales) {
      const lines = sale.ln.map((line) => {
        const found = line.code ? byCode.get(line.code) : undefined;
        if (found) return { line, product: found };

        // Кода нет вовсе — брать нечего: такую строку пропускаем, но чек
        // всё равно заведём, у него есть итог.
        if (!line.code) return null;

        return {
          line,
          product: { id: missingProduct(line.code, line.n ?? null, line.p ?? 0), cost: 0 },
        };
      });

      const kept = lines.filter(
        (row): row is { line: SeedSale['ln'][number]; product: { id: number; cost: number } } =>
          row !== null,
      );

      const cost = kept.reduce(
        (sum, row) => sum + Math.round((row.product.cost * (row.line.q ?? 0)) / 1000),
        0,
      );

      const customerId = sale.c ? (cloudCustomers.get(sale.c) ?? null) : null;

      // Подпись чека. Номер — всегда, имя покупателя — только когда карточку
      // по нему найти не удалось: иначе чек в журнале остался бы безымянным.
      // Номер чека теперь стоит своей колонкой, а не прячется в примечании:
      // «Продажа #45658» — так его называет и ищет хозяин магазина.
      const number = Number(sale.no);
      const note = customerId === null && sale.cn ? sale.cn : null;

      db.run(
        `INSERT INTO sales (discount, total, cost_total, payment, created_at, customer_id, note, location_id, number, money_number, bonus_earned, bonus_used, author)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sale.disc ?? 0,
          sale.t ?? 0,
          cost,
          sale.pay === 'card' || sale.pay === 'transfer' ? sale.pay : 'cash',
          sale.at ?? now,
          customerId,
          note,
          sale.st ? (stores.get(sale.st) ?? null) : null,
          Number.isFinite(number) && number > 0 ? number : null,
          sale.ono ?? null,
          sale.be ?? 0,
          sale.bu ?? 0,
          sale.au ?? null,
        ],
      );
      const saleId = db.lastInsertId();

      for (const { line, product } of kept) {
        db.run(
          `INSERT INTO sale_items (sale_id, product_id, qty, price, cost_price)
           VALUES (?, ?, ?, ?, ?)`,
          [saleId, product.id, line.q ?? 0, line.p ?? 0, product.cost],
        );
      }
    }

    db.run('INSERT INTO app_state (key, value) VALUES (?, ?)', [DONE_KEY, now]);
  });
}
