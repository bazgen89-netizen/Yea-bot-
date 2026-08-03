import type { SqlDriver, SqlParam } from './driver';
import type { Category, Id, Product, ProductWithStock } from '../domain/types';

/**
 * Остаток берётся подзапросом по stock_moves, а не хранимым полем.
 * COALESCE — потому что у товара без движений SUM даёт NULL.
 */
const STOCK_SUBQUERY = `
  COALESCE((SELECT SUM(m.qty_delta) FROM stock_moves m WHERE m.product_id = p.id), 0) AS stock
`;

const SELECT_PRODUCT = `
  SELECT p.*, ${STOCK_SUBQUERY}, c.name AS category_name
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
`;

export interface ProductFilter {
  /** Поиск по названию, артикулу или штрихкоду. */
  search?: string;
  categoryId?: Id | null;
  /** Показывать архивные товары. По умолчанию — нет. */
  includeArchived?: boolean;
  /** Только товары, где остаток <= min_qty и min_qty > 0. */
  lowStockOnly?: boolean;
}

export function listProducts(db: SqlDriver, filter: ProductFilter = {}): ProductWithStock[] {
  const where: string[] = [];
  const params: SqlParam[] = [];

  if (!filter.includeArchived) where.push('p.archived = 0');

  if (filter.search?.trim()) {
    where.push('p.search_text LIKE ?');
    params.push(`%${normalize(filter.search)}%`);
  }

  if (filter.categoryId != null) {
    where.push('p.category_id = ?');
    params.push(filter.categoryId);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // Фильтр по остатку — через HAVING: stock это агрегат, в WHERE он недоступен.
  const havingSql = filter.lowStockOnly ? 'HAVING p.min_qty > 0 AND stock <= p.min_qty' : '';

  return db.all<ProductWithStock>(
    `${SELECT_PRODUCT} ${whereSql} GROUP BY p.id ${havingSql} ORDER BY p.name COLLATE NOCASE`,
    params,
  );
}

export function getProduct(db: SqlDriver, id: Id): ProductWithStock | null {
  return db.get<ProductWithStock>(`${SELECT_PRODUCT} WHERE p.id = ?`, [id]);
}

export function findByBarcode(db: SqlDriver, barcode: string): ProductWithStock | null {
  return db.get<ProductWithStock>(`${SELECT_PRODUCT} WHERE p.barcode = ? AND p.archived = 0`, [
    barcode,
  ]);
}

export type ProductInput = Omit<Product, 'id' | 'created_at' | 'archived'>;

export function createProduct(db: SqlDriver, input: ProductInput): Id {
  db.run(
    `INSERT INTO products
       (name, sku, barcode, category_id, unit, cost_price, sale_price, min_qty,
        photo_uri, created_at, search_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      emptyToNull(input.sku),
      emptyToNull(input.barcode),
      input.category_id,
      input.unit,
      input.cost_price,
      input.sale_price,
      input.min_qty,
      emptyToNull(input.photo_uri),
      new Date().toISOString(),
      searchText(input),
    ],
  );
  return db.lastInsertId();
}

export function updateProduct(db: SqlDriver, id: Id, input: ProductInput): void {
  db.run(
    `UPDATE products SET
       name = ?, sku = ?, barcode = ?, category_id = ?, unit = ?,
       cost_price = ?, sale_price = ?, min_qty = ?, photo_uri = ?, search_text = ?
     WHERE id = ?`,
    [
      input.name,
      emptyToNull(input.sku),
      emptyToNull(input.barcode),
      input.category_id,
      input.unit,
      input.cost_price,
      input.sale_price,
      input.min_qty,
      emptyToNull(input.photo_uri),
      searchText(input),
      id,
    ],
  );
}

/**
 * Товары не удаляются, а архивируются: на них ссылаются позиции проданных чеков,
 * и удаление сломало бы историю продаж и отчёты за прошлые периоды.
 */
export function archiveProduct(db: SqlDriver, id: Id): void {
  db.run('UPDATE products SET archived = 1 WHERE id = ?', [id]);
}

export function restoreProduct(db: SqlDriver, id: Id): void {
  db.run('UPDATE products SET archived = 0 WHERE id = ?', [id]);
}

export function listCategories(db: SqlDriver): Category[] {
  return db.all<Category>('SELECT * FROM categories ORDER BY name COLLATE NOCASE');
}

/** Возвращает id категории, создавая её при необходимости. */
export function ensureCategory(db: SqlDriver, name: string): Id {
  const trimmed = name.trim();
  const existing = db.get<Category>('SELECT * FROM categories WHERE name = ?', [trimmed]);
  if (existing) return existing.id;

  db.run('INSERT INTO categories (name) VALUES (?)', [trimmed]);
  return db.lastInsertId();
}

export function deleteCategory(db: SqlDriver, id: Id): void {
  db.run('DELETE FROM categories WHERE id = ?', [id]);
}

/** Приводит строку к виду, пригодному для поиска без учёта регистра. */
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Собирает содержимое колонки search_text из полей товара. */
function searchText(input: ProductInput): string {
  return [input.name, input.sku, input.barcode]
    .filter((v): v is string => Boolean(v?.trim()))
    .map(normalize)
    .join(' ');
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
