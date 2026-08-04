import type { SqlDb } from './driver.ts';

/**
 * Схема серверной базы.
 *
 * Отличия от базы в телефоне, все ради синхронизации:
 *
 * 1. Идентификаторы — UUID, а не автоинкремент. Телефон генерирует их сам,
 *    ещё не имея связи с сервером, и они не столкнутся с идентификаторами
 *    другого телефона.
 * 2. У каждой строки есть `seq` — номер в общей очереди изменений организации.
 *    Клиент помнит последний полученный номер и просит «всё, что больше».
 * 3. Всё удаление — мягкое (`archived`, `deleted`). Иначе устройство, которое
 *    было офлайн, никогда не узнает, что запись исчезла.
 * 4. Появился `location_id`: у каждой точки свои остатки.
 */
export const MIGRATIONS: string[] = [
  // 1 — начальная схема
  `
  CREATE TABLE orgs (
    id         UUID PRIMARY KEY,
    name       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Счётчик изменений организации. Растёт при каждой записи, задаёт
    -- строгий порядок событий для синхронизации.
    seq        BIGINT      NOT NULL DEFAULT 0
  );

  CREATE TABLE users (
    id            UUID PRIMARY KEY,
    org_id        UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    name          TEXT        NOT NULL,
    role          TEXT        NOT NULL CHECK (role IN ('owner','seller')),
    disabled      BOOLEAN     NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    seq           BIGINT      NOT NULL DEFAULT 0
  );

  CREATE INDEX idx_users_org ON users(org_id);

  -- Сессии устройств. Храним только хеш токена: утечка дампа базы не даёт
  -- войти в чужой аккаунт.
  CREATE TABLE tokens (
    id           UUID PRIMARY KEY,
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT        NOT NULL UNIQUE,
    device_name  TEXT,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
  );

  CREATE INDEX idx_tokens_user ON tokens(user_id);

  -- Ключи для интеграций: сайт, 1С, Telegram-бот.
  CREATE TABLE api_keys (
    id           UUID PRIMARY KEY,
    org_id       UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name         TEXT        NOT NULL,
    key_hash     TEXT        NOT NULL UNIQUE,
    key_prefix   TEXT        NOT NULL,
    scopes       TEXT[]      NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ
  );

  CREATE INDEX idx_api_keys_org ON api_keys(org_id);

  CREATE TABLE locations (
    id         UUID PRIMARY KEY,
    org_id     UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name       TEXT        NOT NULL,
    address    TEXT,
    archived   BOOLEAN     NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    seq        BIGINT      NOT NULL
  );

  CREATE INDEX idx_locations_sync ON locations(org_id, seq);

  CREATE TABLE categories (
    id         UUID PRIMARY KEY,
    org_id     UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name       TEXT        NOT NULL,
    deleted    BOOLEAN     NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    seq        BIGINT      NOT NULL
  );

  CREATE INDEX idx_categories_sync ON categories(org_id, seq);

  CREATE TABLE products (
    id          UUID PRIMARY KEY,
    org_id      UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name        TEXT        NOT NULL,
    sku         TEXT,
    barcode     TEXT,
    category_id UUID        REFERENCES categories(id) ON DELETE SET NULL,
    unit        TEXT        NOT NULL DEFAULT 'шт',
    -- Копейки. Хранятся целыми: см. warehouse/src/domain/money.ts.
    cost_price  BIGINT      NOT NULL DEFAULT 0,
    sale_price  BIGINT      NOT NULL DEFAULT 0,
    -- Тысячные единицы. 1000 = 1 шт/кг.
    min_qty     BIGINT      NOT NULL DEFAULT 0,
    photo_uri   TEXT,
    archived    BOOLEAN     NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    seq         BIGINT      NOT NULL
  );

  CREATE INDEX idx_products_sync ON products(org_id, seq);
  -- Штрихкод уникален внутри организации, но только у неархивных товаров:
  -- архивный товар не должен мешать завести новый с тем же кодом.
  CREATE UNIQUE INDEX idx_products_barcode
    ON products(org_id, barcode)
    WHERE barcode IS NOT NULL AND archived = false;

  CREATE TABLE docs (
    id              UUID PRIMARY KEY,
    org_id          UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    location_id     UUID        NOT NULL REFERENCES locations(id),
    -- transfer: перемещение между точками, вторая точка в to_location_id
    type            TEXT        NOT NULL
                                CHECK (type IN ('receipt','writeoff','adjust','transfer')),
    to_location_id  UUID        REFERENCES locations(id),
    counterparty    TEXT,
    note            TEXT,
    created_by      UUID        REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    seq             BIGINT      NOT NULL,
    CHECK ((type = 'transfer') = (to_location_id IS NOT NULL))
  );

  CREATE INDEX idx_docs_sync ON docs(org_id, seq);

  CREATE TABLE sales (
    id          UUID PRIMARY KEY,
    org_id      UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    location_id UUID        NOT NULL REFERENCES locations(id),
    discount    BIGINT      NOT NULL DEFAULT 0,
    total       BIGINT      NOT NULL,
    cost_total  BIGINT      NOT NULL,
    payment     TEXT        NOT NULL DEFAULT 'cash'
                            CHECK (payment IN ('cash','card','transfer')),
    created_by  UUID        REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL,
    refunded_at TIMESTAMPTZ,
    seq         BIGINT      NOT NULL
  );

  CREATE INDEX idx_sales_sync    ON sales(org_id, seq);
  CREATE INDEX idx_sales_created ON sales(org_id, created_at);

  CREATE TABLE sale_items (
    id         UUID PRIMARY KEY,
    org_id     UUID   NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    sale_id    UUID   NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id UUID   NOT NULL REFERENCES products(id),
    qty        BIGINT NOT NULL,
    price      BIGINT NOT NULL,
    cost_price BIGINT NOT NULL,
    seq        BIGINT NOT NULL
  );

  CREATE INDEX idx_sale_items_sync ON sale_items(org_id, seq);
  CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);

  CREATE TABLE stock_moves (
    id          UUID PRIMARY KEY,
    org_id      UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    location_id UUID        NOT NULL REFERENCES locations(id),
    product_id  UUID        NOT NULL REFERENCES products(id),
    qty_delta   BIGINT      NOT NULL,
    reason      TEXT        NOT NULL
                            CHECK (reason IN ('receipt','writeoff','sale','adjust','return','transfer')),
    doc_id      UUID        REFERENCES docs(id)  ON DELETE CASCADE,
    sale_id     UUID        REFERENCES sales(id) ON DELETE CASCADE,
    price       BIGINT      NOT NULL DEFAULT 0,
    created_by  UUID        REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL,
    seq         BIGINT      NOT NULL
  );

  CREATE INDEX idx_moves_sync     ON stock_moves(org_id, seq);
  CREATE INDEX idx_moves_stock    ON stock_moves(org_id, product_id, location_id);
  CREATE INDEX idx_moves_created  ON stock_moves(org_id, created_at);
  `,

  // 2 — клиенты и поставщики
  `
  CREATE TABLE counterparties (
    id         UUID PRIMARY KEY,
    org_id     UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    -- Один и тот же человек бывает и покупателем, и поставщиком, поэтому
    -- справочник общий, а роль — признак записи.
    kind       TEXT        NOT NULL CHECK (kind IN ('customer','supplier','both')),
    name       TEXT        NOT NULL,
    phone      TEXT,
    email      TEXT,
    note       TEXT,
    archived   BOOLEAN     NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    seq        BIGINT      NOT NULL
  );

  CREATE INDEX idx_counterparties_sync ON counterparties(org_id, seq);
  CREATE INDEX idx_counterparties_name ON counterparties(org_id, lower(name));

  -- Платежи по долгу: клиент вернул часть суммы, мы заплатили поставщику.
  -- Долг нигде не хранится числом — он считается из чеков, документов
  -- и этих платежей, ровно как остаток считается из движений.
  CREATE TABLE counterparty_payments (
    id              UUID PRIMARY KEY,
    org_id          UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    counterparty_id UUID        NOT NULL REFERENCES counterparties(id) ON DELETE CASCADE,
    -- Копейки. Плюс — долг уменьшился, минус — вырос (исправление ошибки).
    amount          BIGINT      NOT NULL,
    note            TEXT,
    created_by      UUID        REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL,
    seq             BIGINT      NOT NULL
  );

  CREATE INDEX idx_payments_sync ON counterparty_payments(org_id, seq);
  CREATE INDEX idx_payments_party ON counterparty_payments(counterparty_id);

  ALTER TABLE sales ADD COLUMN customer_id UUID REFERENCES counterparties(id);
  ALTER TABLE docs  ADD COLUMN supplier_id UUID REFERENCES counterparties(id);

  -- Продажа в долг: деньги за товар ещё не получены.
  ALTER TABLE sales DROP CONSTRAINT sales_payment_check;
  ALTER TABLE sales ADD CONSTRAINT sales_payment_check
    CHECK (payment IN ('cash','card','transfer','credit'));
  `,

  // 3 — карточка товара как в привычных программах учёта
  `
  -- Группы товаров — дерево. Категория остаётся отдельным, плоским признаком:
  -- в CloudShop это разные поля, и объединять их нельзя.
  CREATE TABLE product_groups (
    id         UUID PRIMARY KEY,
    org_id     UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    parent_id  UUID        REFERENCES product_groups(id) ON DELETE SET NULL,
    name       TEXT        NOT NULL,
    deleted    BOOLEAN     NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    seq        BIGINT      NOT NULL
  );

  CREATE INDEX idx_groups_sync ON product_groups(org_id, seq);

  ALTER TABLE products
    -- Короткий человекочитаемый номер, свой в каждой организации. Артикул
    -- задаёт пользователь и может не заполнить — а сослаться на товар надо.
    ADD COLUMN code            INTEGER,
    ADD COLUMN group_id        UUID REFERENCES product_groups(id) ON DELETE SET NULL,
    ADD COLUMN kind            TEXT NOT NULL DEFAULT 'product'
                               CHECK (kind IN ('product','service','bundle')),
    ADD COLUMN country         TEXT,
    ADD COLUMN description     TEXT,
    -- Плановая цена закупки: то, почём договорились с поставщиком.
    ADD COLUMN purchase_price  BIGINT NOT NULL DEFAULT 0,
    -- Скидка на товар, сотые доли процента: 1250 = 12,50 %.
    ADD COLUMN discount_bp     INTEGER NOT NULL DEFAULT 0,
    -- Цена вводится при продаже (услуги, развес под заказ).
    ADD COLUMN free_price      BOOLEAN NOT NULL DEFAULT false,
    -- Продаётся на вес: количество вводится дробным.
    ADD COLUMN weighted        BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN shelf_life_days INTEGER,
    -- Ставка НДС в сотых процента: 2000 = 20 %.
    ADD COLUMN tax_bp          INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN tax_exempt      BOOLEAN NOT NULL DEFAULT false;

  CREATE UNIQUE INDEX idx_products_code ON products(org_id, code) WHERE code IS NOT NULL;

  -- Номер товара выдаётся по организации, а не глобально.
  CREATE TABLE product_code_counters (
    org_id UUID PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
    last   INTEGER NOT NULL DEFAULT 0
  );

  -- Своя цена продажи в отдельной точке. Пусто — действует цена из карточки.
  CREATE TABLE product_prices (
    id          UUID PRIMARY KEY,
    org_id      UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    product_id  UUID        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    location_id UUID        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    sale_price  BIGINT      NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    seq         BIGINT      NOT NULL,
    UNIQUE (product_id, location_id)
  );

  CREATE INDEX idx_product_prices_sync ON product_prices(org_id, seq);

  -- Остаток после операции: в истории товара видно, сколько осталось на тот
  -- момент. Считать это на лету означало бы суммировать все прошлые движения
  -- на каждую строку списка.
  ALTER TABLE stock_moves ADD COLUMN balance_after BIGINT;
  `,
];

/** Применяет неприменённые миграции. Безопасно вызывать при каждом запуске. */
export async function migrate(db: SqlDb): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);

  const row = await db.one<{ version: number }>('SELECT version FROM schema_version LIMIT 1');
  if (row === null) {
    await db.query('INSERT INTO schema_version (version) VALUES (0)');
  }
  const current = row?.version ?? 0;

  for (let i = current; i < MIGRATIONS.length; i++) {
    await db.tx(async (tx) => {
      await tx.exec(MIGRATIONS[i]);
      await tx.query('UPDATE schema_version SET version = $1', [i + 1]);
    });
  }
}
