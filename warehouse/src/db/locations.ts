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
