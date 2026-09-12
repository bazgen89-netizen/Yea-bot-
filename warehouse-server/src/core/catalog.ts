import { randomUUID } from 'node:crypto';

import type { SqlDb } from '../db/driver.ts';
import { conflict, notFound } from './errors.ts';
import { nextSeq } from './seq.ts';

export interface Location {
  id: string;
  org_id: string;
  name: string;
  address: string | null;
  archived: boolean;
  seq: number;
}

export interface Category {
  id: string;
  org_id: string;
  name: string;
  deleted: boolean;
  seq: number;
}

export interface Product {
  id: string;
  org_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category_id: string | null;
  unit: string;
  cost_price: number;
  sale_price: number;
  min_qty: number;
  photo_uri: string | null;
  archived: boolean;
  seq: number;
}

export interface ProductWithStock extends Product {
  /** Остаток по выбранной точке или по всем точкам, тысячные. */
  stock: number;
  category_name: string | null;
}

// --- Точки --------------------------------------------------------------

export async function listLocations(db: SqlDb, orgId: string): Promise<Location[]> {
  return db.query<Location>(
    'SELECT * FROM locations WHERE org_id = $1 ORDER BY archived, name',
    [orgId],
  );
}

export async function createLocation(
  db: SqlDb,
  orgId: string,
  input: { id?: string; name: string; address?: string | null },
): Promise<Location> {
  return db.tx(async (tx) => {
    const seq = await nextSeq(tx, orgId);
    const row = await tx.one<Location>(
      `INSERT INTO locations (id, org_id, name, address, seq)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [input.id ?? randomUUID(), orgId, input.name.trim(), input.address?.trim() || null, seq],
    );
    return row!;
  });
}

export async function updateLocation(
  db: SqlDb,
  orgId: string,
  id: string,
  patch: { name?: string; address?: string | null; archived?: boolean },
): Promise<Location> {
  const sets: string[] = [];
  const params: unknown[] = [id, orgId];

  const assign = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (patch.name !== undefined) assign('name', patch.name.trim());
  if (patch.address !== undefined) assign('address', patch.address?.trim() || null);
  if (patch.archived !== undefined) assign('archived', patch.archived);

  if (sets.length === 0) {
    const current = await db.one<Location>('SELECT * FROM locations WHERE id = $1 AND org_id = $2', [
      id,
      orgId,
    ]);
    if (!current) throw notFound('Точка не найдена');
    return current;
  }

  return db.tx(async (tx) => {
    const seq = await nextSeq(tx, orgId);
    params.push(seq);

    const row = await tx.one<Location>(
      `UPDATE locations SET ${sets.join(', ')}, updated_at = now(), seq = $${params.length}
       WHERE id = $1 AND org_id = $2
       RETURNING *`,
      params,
    );
    if (!row) throw notFound('Точка не найдена');
    return row;
  });
}

/** Точка по умолчанию — первая неархивная. Создаётся при регистрации организации. */
export async function defaultLocation(db: SqlDb, orgId: string): Promise<Location> {
  const row = await db.one<Location>(
    'SELECT * FROM locations WHERE org_id = $1 AND archived = false ORDER BY created_at LIMIT 1',
    [orgId],
  );
  if (!row) throw notFound('У организации нет ни одной точки');
  return row;
}

export async function assertLocation(db: SqlDb, orgId: string, id: string): Promise<void> {
  const row = await db.one('SELECT 1 FROM locations WHERE id = $1 AND org_id = $2', [id, orgId]);
  if (!row) throw notFound('Точка не найдена');
}

// --- Категории ----------------------------------------------------------

export async function listCategories(db: SqlDb, orgId: string): Promise<Category[]> {
  return db.query<Category>(
    'SELECT * FROM categories WHERE org_id = $1 AND deleted = false ORDER BY name',
    [orgId],
  );
}

/** Возвращает категорию с таким названием, создавая её при необходимости. */
export async function ensureCategory(db: SqlDb, orgId: string, name: string): Promise<Category> {
  const trimmed = name.trim();

  return db.tx(async (tx) => {
    const existing = await tx.one<Category>(
      'SELECT * FROM categories WHERE org_id = $1 AND name = $2 AND deleted = false',
      [orgId, trimmed],
    );
    if (existing) return existing;

    const seq = await nextSeq(tx, orgId);
    const row = await tx.one<Category>(
      'INSERT INTO categories (id, org_id, name, seq) VALUES ($1, $2, $3, $4) RETURNING *',
      [randomUUID(), orgId, trimmed, seq],
    );
    return row!;
  });
}

export async function deleteCategory(db: SqlDb, orgId: string, id: string): Promise<void> {
  await db.tx(async (tx) => {
    const seq = await nextSeq(tx, orgId);
    const row = await tx.one(
      `UPDATE categories SET deleted = true, updated_at = now(), seq = $3
       WHERE id = $1 AND org_id = $2 RETURNING id`,
      [id, orgId, seq],
    );
    if (!row) throw notFound('Категория не найдена');
  });
}

// --- Товары -------------------------------------------------------------

export interface ProductFilter {
  search?: string;
  /** Остаток считать по этой точке. Если не задано — по всем сразу. */
  locationId?: string;
  categoryId?: string;
  includeArchived?: boolean;
  lowStockOnly?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Остаток считается подзапросом по движениям — отдельного поля с остатком нет
 * ни здесь, ни в телефоне. Так остаток невозможно рассинхронизировать
 * с историей движений.
 */
function stockSubquery(locationParam: number | null): string {
  const byLocation = locationParam ? ` AND m.location_id = $${locationParam}` : '';
  return `COALESCE((
    SELECT SUM(m.qty_delta) FROM stock_moves m
    WHERE m.product_id = p.id${byLocation}
  ), 0)::bigint AS stock`;
}

export async function listProducts(
  db: SqlDb,
  orgId: string,
  filter: ProductFilter = {},
): Promise<ProductWithStock[]> {
  const params: unknown[] = [orgId];
  const where = ['p.org_id = $1'];

  let locationParam: number | null = null;
  if (filter.locationId) {
    params.push(filter.locationId);
    locationParam = params.length;
  }

  if (!filter.includeArchived) where.push('p.archived = false');

  if (filter.search?.trim()) {
    params.push(`%${filter.search.trim().toLowerCase()}%`);
    // lower() в PostgreSQL работает и с кириллицей — отдельная колонка для
    // поиска, как в SQLite на телефоне, здесь не нужна.
    where.push(`(lower(p.name) LIKE $${params.length}
                 OR lower(p.sku) LIKE $${params.length}
                 OR p.barcode LIKE $${params.length})`);
  }

  if (filter.categoryId) {
    params.push(filter.categoryId);
    where.push(`p.category_id = $${params.length}`);
  }

  params.push(Math.min(filter.limit ?? 500, 1000));
  const limitParam = params.length;
  params.push(filter.offset ?? 0);
  const offsetParam = params.length;

  const having = filter.lowStockOnly ? 'WHERE min_qty > 0 AND stock <= min_qty' : '';

  return db.query<ProductWithStock>(
    `SELECT * FROM (
       SELECT p.*, ${stockSubquery(locationParam)}, c.name AS category_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE ${where.join(' AND ')}
     ) rows
     ${having}
     ORDER BY name
     LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params,
  );
}

export async function getProduct(
  db: SqlDb,
  orgId: string,
  id: string,
  locationId?: string,
): Promise<ProductWithStock> {
  const params: unknown[] = [orgId, id];
  let locationParam: number | null = null;
  if (locationId) {
    params.push(locationId);
    locationParam = params.length;
  }

  const row = await db.one<ProductWithStock>(
    `SELECT p.*, ${stockSubquery(locationParam)}, c.name AS category_name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.org_id = $1 AND p.id = $2`,
    params,
  );
  if (!row) throw notFound('Товар не найден');
  return row;
}

export async function findByBarcode(
  db: SqlDb,
  orgId: string,
  barcode: string,
  locationId?: string,
): Promise<ProductWithStock | null> {
  const params: unknown[] = [orgId, barcode];
  let locationParam: number | null = null;
  if (locationId) {
    params.push(locationId);
    locationParam = params.length;
  }

  return db.one<ProductWithStock>(
    `SELECT p.*, ${stockSubquery(locationParam)}, c.name AS category_name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.org_id = $1 AND p.barcode = $2 AND p.archived = false`,
    params,
  );
}

export interface ProductInput {
  id?: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  category_id?: string | null;
  unit?: string;
  cost_price?: number;
  sale_price?: number;
  min_qty?: number;
  photo_uri?: string | null;
}

export async function createProduct(
  db: SqlDb,
  orgId: string,
  input: ProductInput,
): Promise<Product> {
  return db.tx(async (tx) => {
    const seq = await nextSeq(tx, orgId);
    try {
      const row = await tx.one<Product>(
        `INSERT INTO products
           (id, org_id, name, sku, barcode, category_id, unit,
            cost_price, sale_price, min_qty, photo_uri, seq)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          input.id ?? randomUUID(),
          orgId,
          input.name.trim(),
          blank(input.sku),
          blank(input.barcode),
          input.category_id ?? null,
          input.unit?.trim() || 'шт',
          input.cost_price ?? 0,
          input.sale_price ?? 0,
          input.min_qty ?? 0,
          blank(input.photo_uri),
          seq,
        ],
      );
      return row!;
    } catch (error) {
      throw translateProductError(error);
    }
  });
}

export type ProductPatch = Partial<ProductInput> & { archived?: boolean };

/**
 * Меняются только те поля, что реально переданы.
 *
 * Через COALESCE это не выразить: тогда `barcode: null` («стереть штрихкод»)
 * и отсутствие поля («не трогать») выглядят одинаково, и очистить поле
 * становится невозможно.
 */
export async function updateProduct(
  db: SqlDb,
  orgId: string,
  id: string,
  patch: ProductPatch,
): Promise<Product> {
  const sets: string[] = [];
  const params: unknown[] = [id, orgId];

  const assign = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (patch.name !== undefined) assign('name', patch.name.trim());
  if (patch.sku !== undefined) assign('sku', blank(patch.sku));
  if (patch.barcode !== undefined) assign('barcode', blank(patch.barcode));
  if (patch.category_id !== undefined) assign('category_id', patch.category_id);
  if (patch.unit !== undefined) assign('unit', patch.unit.trim() || 'шт');
  if (patch.cost_price !== undefined) assign('cost_price', patch.cost_price);
  if (patch.sale_price !== undefined) assign('sale_price', patch.sale_price);
  if (patch.min_qty !== undefined) assign('min_qty', patch.min_qty);
  if (patch.photo_uri !== undefined) assign('photo_uri', blank(patch.photo_uri));
  if (patch.archived !== undefined) assign('archived', patch.archived);

  if (sets.length === 0) return getProduct(db, orgId, id);

  return db.tx(async (tx) => {
    const seq = await nextSeq(tx, orgId);
    params.push(seq);

    try {
      const row = await tx.one<Product>(
        `UPDATE products SET ${sets.join(', ')}, updated_at = now(), seq = $${params.length}
         WHERE id = $1 AND org_id = $2
         RETURNING *`,
        params,
      );
      if (!row) throw notFound('Товар не найден');
      return row;
    } catch (error) {
      throw translateProductError(error);
    }
  });
}

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Единственный уникальный индекс на товарах — штрихкод. */
function translateProductError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('idx_products_barcode')) {
    return conflict('Такой штрихкод уже есть у другого товара');
  }
  return error;
}
