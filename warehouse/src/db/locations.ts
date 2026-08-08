import type { SqlDriver } from './driver';
import type { Id } from '../domain/types';
import type { Milli } from '../domain/qty';

export interface Location {
  id: Id;
  name: string;
  archived: number;
  created_at: string;
}

export function listLocations(db: SqlDriver): Location[] {
  return db.all<Location>('SELECT * FROM locations WHERE archived = 0 ORDER BY id');
}

/** Возвращает id магазина, заводя его при необходимости. */
export function ensureLocation(db: SqlDriver, name: string): Id {
  const trimmed = name.trim();
  const existing = db.get<Location>('SELECT * FROM locations WHERE name = ?', [trimmed]);
  if (existing) return existing.id;

  db.run('INSERT INTO locations (name, created_at) VALUES (?, ?)', [
    trimmed,
    new Date().toISOString(),
  ]);
  return db.lastInsertId();
}

export interface LocationWithTotals extends Location {
  /** Сколько позиций с ненулевым остатком лежит в этом магазине. */
  positions: number;
  /** Суммарное количество, тысячные. Может быть отрицательным. */
  quantity: number;
  /** Стоимость положительных остатков в розничных ценах, копейки. */
  retailValue: number;
}

/** Магазины вместе с тем, что в них лежит — для раздела «Компания / магазины». */
export function listLocationsWithTotals(db: SqlDriver): LocationWithTotals[] {
  return db.all<LocationWithTotals>(
    `SELECT l.*,
            COALESCE(SUM(CASE WHEN s.stock <> 0 THEN 1 ELSE 0 END), 0) AS positions,
            COALESCE(SUM(s.stock), 0) AS quantity,
            CAST(ROUND(COALESCE(SUM(CASE WHEN s.stock > 0 THEN s.stock * p.sale_price END), 0)
                 / 1000.0) AS INTEGER) AS retailValue
     FROM locations l
     LEFT JOIN (
       SELECT location_id, product_id, SUM(qty_delta) AS stock
       FROM stock_moves
       WHERE location_id IS NOT NULL
       GROUP BY location_id, product_id
     ) s ON s.location_id = l.id
     LEFT JOIN products p ON p.id = s.product_id
     WHERE l.archived = 0
     GROUP BY l.id
     ORDER BY l.id`,
  );
}

export function createLocation(db: SqlDriver, name: string): Id {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('У магазина должно быть название');
  if (db.get('SELECT id FROM locations WHERE name = ?', [trimmed])) {
    throw new Error(`Магазин «${trimmed}» уже есть`);
  }
  return ensureLocation(db, trimmed);
}

export function renameLocation(db: SqlDriver, id: Id, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('У магазина должно быть название');
  db.run('UPDATE locations SET name = ? WHERE id = ?', [trimmed, id]);
}

/**
 * Убирает магазин из списков.
 *
 * Именно убирает, а не удаляет: движения товара и чеки на него ссылаются,
 * и удаление либо утащило бы их за собой, либо оставило висеть без магазина.
 * Магазин с остатком не архивируется — товар не может лежать нигде.
 */
export function archiveLocation(db: SqlDriver, id: Id): void {
  const row = db.get<{ stock: number }>(
    'SELECT COALESCE(SUM(qty_delta), 0) AS stock FROM stock_moves WHERE location_id = ?',
    [id],
  );
  if ((row?.stock ?? 0) !== 0) {
    throw new Error('В магазине есть остаток — сначала переместите или спишите товар');
  }
  db.run('UPDATE locations SET archived = 1 WHERE id = ?', [id]);
}

/**
 * Остатки по магазинам одним запросом: `{ [product_id]: { [location_id]: остаток } }`.
 *
 * Считаем на все товары сразу, а не по одному: в каталоге несколько сотен
 * позиций, и запрос на строку превратил бы прокрутку в слайд-шоу.
 */
export function stockByLocation(db: SqlDriver): Map<Id, Map<Id, Milli>> {
  const rows = db.all<{ product_id: Id; location_id: Id | null; stock: Milli }>(
    `SELECT product_id, location_id, SUM(qty_delta) AS stock
     FROM stock_moves
     WHERE location_id IS NOT NULL
     GROUP BY product_id, location_id`,
  );

  const result = new Map<Id, Map<Id, Milli>>();
  for (const row of rows) {
    if (row.location_id === null) continue;
    let byLocation = result.get(row.product_id);
    if (!byLocation) {
      byLocation = new Map();
      result.set(row.product_id, byLocation);
    }
    byLocation.set(row.location_id, row.stock);
  }
  return result;
}
