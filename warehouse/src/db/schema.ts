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
