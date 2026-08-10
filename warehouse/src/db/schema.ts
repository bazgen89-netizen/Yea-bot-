/**
 * Схема базы и миграции.
 *
 * Остатки нигде не хранятся отдельным числом — они всегда SUM(stock_moves.qty_delta)
 * по товару. Так остаток невозможно рассинхронизировать с историей: любое изменение
 * склада — это запись движения, и «почему тут 3 штуки» всегда можно объяснить.
 */
import type { SqlDriver } from './driver';

/**
 * Каждая миграция применяется один раз, в порядке номеров. Добавлять новые —
 * только в конец массива, не меняя уже выпущенные: они уже применены на телефонах.
 */
export const MIGRATIONS: string[] = [
  // 1 — начальная схема
  `
  CREATE TABLE categories (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    sku         TEXT,
    barcode     TEXT    UNIQUE,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    unit        TEXT    NOT NULL DEFAULT 'шт',
    cost_price  INTEGER NOT NULL DEFAULT 0,
    sale_price  INTEGER NOT NULL DEFAULT 0,
    min_qty     INTEGER NOT NULL DEFAULT 0,
    photo_uri   TEXT,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    -- name + sku + barcode в нижнем регистре, для поиска.
    -- Своя колонка нужна потому, что LIKE и LOWER() в SQLite игнорируют регистр
    -- только для латиницы: по «улун» товар «Улун» иначе не находится.
    search_text TEXT    NOT NULL DEFAULT ''
  );

  CREATE INDEX idx_products_name     ON products(name);
  CREATE INDEX idx_products_archived ON products(archived);

  CREATE TABLE docs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    type         TEXT NOT NULL CHECK (type IN ('receipt','writeoff','adjust')),
    counterparty TEXT,
    note         TEXT,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE sales (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    discount   INTEGER NOT NULL DEFAULT 0,
    total      INTEGER NOT NULL,
    cost_total INTEGER NOT NULL,
    payment    TEXT    NOT NULL DEFAULT 'cash'
                       CHECK (payment IN ('cash','card','transfer')),
    created_at TEXT    NOT NULL
  );

  CREATE INDEX idx_sales_created ON sales(created_at);

  CREATE TABLE sale_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id    INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty        INTEGER NOT NULL,
    price      INTEGER NOT NULL,
    cost_price INTEGER NOT NULL
  );

  CREATE INDEX idx_sale_items_sale    ON sale_items(sale_id);
  CREATE INDEX idx_sale_items_product ON sale_items(product_id);

  CREATE TABLE stock_moves (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    qty_delta  INTEGER NOT NULL,
    reason     TEXT    NOT NULL
                       CHECK (reason IN ('receipt','writeoff','sale','adjust','return')),
    doc_id     INTEGER REFERENCES docs(id)  ON DELETE CASCADE,
    sale_id    INTEGER REFERENCES sales(id) ON DELETE CASCADE,
    price      INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL
  );

  CREATE INDEX idx_moves_product ON stock_moves(product_id);
  CREATE INDEX idx_moves_created ON stock_moves(created_at);
  `,

  // 2 — контрагенты: клиенты и поставщики
  `
  CREATE TABLE counterparties (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    -- 'both' — запись, которая и покупает, и поставляет; попадает в оба списка.
    kind        TEXT    NOT NULL CHECK (kind IN ('customer','supplier','both')),
    name        TEXT    NOT NULL,
    phone       TEXT,
    email       TEXT,
    note        TEXT,
    -- Личная скидка в сотых долях процента: 500 = 5 %.
    discount_bp INTEGER NOT NULL DEFAULT 0,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    -- Как и у товаров: имя, телефон и почта в нижнем регистре, плюс телефон
    -- без разделителей — «+7 (999) 123-45-67» ищется и как «9991234567».
    search_text TEXT    NOT NULL DEFAULT ''
  );

  CREATE INDEX idx_parties_kind ON counterparties(kind, archived);
  CREATE INDEX idx_parties_name ON counterparties(name);

  ALTER TABLE sales ADD COLUMN customer_id INTEGER REFERENCES counterparties(id);

  CREATE INDEX idx_sales_customer ON sales(customer_id);
  `,

  // 3 — магазины: остаток считается по точкам, а не общей кучей
  `
  CREATE TABLE locations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL
  );

  -- NULL означает «до появления магазинов»: у движений, записанных раньше,
  -- точки не было, и придумывать её задним числом нельзя.
  ALTER TABLE stock_moves ADD COLUMN location_id INTEGER REFERENCES locations(id);
  ALTER TABLE sales       ADD COLUMN location_id INTEGER REFERENCES locations(id);
  ALTER TABLE docs        ADD COLUMN location_id INTEGER REFERENCES locations(id);

  CREATE INDEX idx_moves_location ON stock_moves(location_id);

  -- Отметка о том, что каталог уже загружен: иначе при каждом запуске
  -- приложение заводило бы те же товары заново.
  CREATE TABLE app_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  // 4 — поля карточки клиента из выгрузки
  `
  ALTER TABLE counterparties ADD COLUMN birthday    TEXT;
  ALTER TABLE counterparties ADD COLUMN gender      TEXT;
  ALTER TABLE counterparties ADD COLUMN address     TEXT;
  -- Кто завёл карточку. В выгрузке это имя сотрудника или магазина строкой,
  -- а не ссылка: своих сотрудников в базе ещё нет, и связывать пока не с чем.
  ALTER TABLE counterparties ADD COLUMN created_by  TEXT;
  `,

  // 5 — виды документов кабинета
  `
  -- type остаётся про склад: плюс или минус. Но закупка и оприходование
  -- приходуют товар одинаково, а называются и заполняются по-разному —
  -- смысл документа хранится отдельно.
  --
  -- Отдельной колонкой, а не расширением CHECK у type: перебрать значения
  -- в CHECK можно только пересборкой таблицы, а на неё завязаны движения
  -- с ON DELETE CASCADE — сборка стоила бы риска потерять их.
  ALTER TABLE docs ADD COLUMN subtype TEXT;

  -- Куда перемещаем. У всех документов, кроме перемещения, пусто.
  ALTER TABLE docs ADD COLUMN location_to INTEGER REFERENCES locations(id);
  `,

  // 6 — деньги, не рождённые чеком: приход, расход, перевод между счетами
  `
  CREATE TABLE money_docs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    type            TEXT    NOT NULL CHECK (type IN ('income','expense','transfer')),
    -- Всегда положительная: знак задаёт тип, а не сумма. Иначе расход на
    -- «минус пятьсот» означал бы приход, и это никак не поймать.
    amount          INTEGER NOT NULL CHECK (amount > 0),
    account         TEXT    NOT NULL,
    -- Куда переводим. У прихода и расхода пусто.
    account_to      TEXT,
    counterparty_id INTEGER REFERENCES counterparties(id),
    counterparty    TEXT,
    category        TEXT,
    note            TEXT,
    location_id     INTEGER REFERENCES locations(id),
    created_at      TEXT    NOT NULL
  );

  CREATE INDEX idx_money_docs_created ON money_docs(created_at);
  `,

  // 7 — кассы и смены
  `
  CREATE TABLE registers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    location_id INTEGER REFERENCES locations(id),
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL
  );

  CREATE TABLE shifts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    register_id  INTEGER NOT NULL REFERENCES registers(id),
    opened_at    TEXT    NOT NULL,
    -- Пусто, пока смена открыта. Открытая смена — та, у которой здесь NULL,
    -- а не та, у которой стоит какой-нибудь флаг: два способа узнать одно и
    -- то же рано или поздно разойдутся.
    closed_at    TEXT,
    -- Наличные в ящике на момент открытия, копейки.
    opening_cash INTEGER NOT NULL DEFAULT 0,
    -- Сколько насчитали при закрытии. Расхождение с ожидаемым — это Z-отчёт.
    closing_cash INTEGER,
    cashier      TEXT,
    created_at   TEXT    NOT NULL
  );

  CREATE INDEX idx_shifts_register ON shifts(register_id, closed_at);

  -- Чек знает свою смену. У чеков, пробитых до появления смен, её нет.
  ALTER TABLE sales      ADD COLUMN shift_id INTEGER REFERENCES shifts(id);
  ALTER TABLE money_docs ADD COLUMN shift_id INTEGER REFERENCES shifts(id);

  CREATE INDEX idx_sales_shift ON sales(shift_id);
  `,

  // 8 — поля карточки товара, которых не хватало против исходного приложения
  `
  -- Вид позиции. Так их описывает само исходное приложение:
  --   product — «продукт, имеющий остаток, который необходимо восполнять»
  --   service — «продукт, не имеющий остатка на складе»
  --   set     — «продукт, состоящий из нескольких других»
  ALTER TABLE products ADD COLUMN kind TEXT NOT NULL DEFAULT 'product'
    CHECK (kind IN ('product','service','set'));

  -- Код товара — отдельно от артикула: артикул поставщика, код внутренний.
  ALTER TABLE products ADD COLUMN code TEXT;

  -- Ставка НДС в сотых долях процента: 2000 = 20 %. NULL — без НДС.
  ALTER TABLE products ADD COLUMN vat_bp INTEGER;

  -- Срок годности, YYYY-MM-DD. На нём держатся три фильтра каталога.
  ALTER TABLE products ADD COLUMN expires_at TEXT;

  -- Скидка на товар в сотых долях процента: 500 = 5 %. Хранится процентом,
  -- а не готовой ценой: цена продажи меняется, и записанная цена со скидкой
  -- разошлась бы с ней молча.
  ALTER TABLE products ADD COLUMN discount_bp INTEGER NOT NULL DEFAULT 0;

  CREATE INDEX idx_products_expires ON products(expires_at);
  `,

  // 9 — сотрудники и права
  `
  CREATE TABLE staff (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    phone       TEXT,
    email       TEXT,
    -- Пять ролей исходного приложения. Роль задаёт права по умолчанию,
    -- а не заменяет их: у продавца одного магазина и продавца другого
    -- набор может отличаться.
    role        TEXT    NOT NULL DEFAULT 'seller'
                        CHECK (role IN ('owner','manager','cashier','storekeeper','seller')),
    -- Права списком через запятую; пусто — берутся от роли.
    permissions TEXT,
    -- Код, который сотрудник набирает у кассы. Не пароль: файл базы на
    -- планшете читается целиком, и хранить здесь что-то, охраняющее деньги,
    -- было бы обманом. Он защищает от чужого нажатия, а не от злого умысла.
    pin         TEXT,
    location_id INTEGER REFERENCES locations(id),
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL
  );

  CREATE INDEX idx_staff_archived ON staff(archived);

  -- Кто провёл документ. У всего, что заведено до появления сотрудников, пусто.
  ALTER TABLE docs       ADD COLUMN staff_id INTEGER REFERENCES staff(id);
  ALTER TABLE sales      ADD COLUMN staff_id INTEGER REFERENCES staff(id);
  ALTER TABLE money_docs ADD COLUMN staff_id INTEGER REFERENCES staff(id);

  CREATE INDEX idx_sales_staff ON sales(staff_id);
  `,
];

/** Применяет неприменённые миграции. Безопасно вызывать при каждом запуске. */
export function migrate(db: SqlDriver): void {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL
  );`);

  const row = db.get<{ version: number }>('SELECT version FROM schema_version LIMIT 1');
  const current = row?.version ?? 0;

  if (row === null) {
    db.run('INSERT INTO schema_version (version) VALUES (0)');
  }

  // Каждая миграция — отдельная транзакция: при сбое на середине база остаётся
  // на предыдущей версии целиком, а не в половинчатом состоянии.
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.tx(() => {
      db.exec(MIGRATIONS[i]);
      db.run('UPDATE schema_version SET version = ?', [i + 1]);
    });
  }
}
