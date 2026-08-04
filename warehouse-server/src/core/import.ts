import type { SqlDb } from '../db/driver.ts';
import { createLocation, createProduct, listLocations, updateProduct } from './catalog.ts';
import { badRequest } from './errors.ts';
import { adjustStock } from './stock.ts';

/**
 * Загрузка каталога из выгрузки другой программы.
 *
 * Строка опознаётся по коду товара. Если кода нет — по штрихкоду, потом по
 * артикулу. Совпало — карточка обновляется, не совпало — заводится новая,
 * поэтому повторная загрузка того же файла не плодит дубли, а обновляет цены.
 */

export interface ImportRow {
  name: string;
  /** Короткий номер товара из выгрузки, например «01444». */
  code?: string | null;
  sku?: string | null;
  barcode?: string | null;
  unit?: string | null;
  /** Цена продажи за единицу, копейки. */
  sale_price?: number;
  /** Закупочная цена за единицу, копейки. */
  purchase_price?: number;
  /** Скидка в сотых процента: 1250 = 12,5 %. */
  discount_bp?: number;
  /**
   * Остатки по магазинам: название точки → количество в тысячных.
   * Точка с незнакомым названием создаётся.
   */
  stocks?: Record<string, number>;
}

export interface ImportResult {
  created: number;
  updated: number;
  locationsCreated: number;
  stockSet: number;
  /** Строки, которые не удалось разобрать, с причиной. */
  skipped: { row: number; reason: string }[];
}

export async function importProducts(
  db: SqlDb,
  orgId: string,
  userId: string | null,
  rows: ImportRow[],
): Promise<ImportResult> {
  if (rows.length === 0) throw badRequest('В файле нет строк');

  const result: ImportResult = {
    created: 0,
    updated: 0,
    locationsCreated: 0,
    stockSet: 0,
    skipped: [],
  };

  // Точки заводим заранее: иначе каждая строка лезла бы в базу за списком.
  const locations = new Map<string, string>();
  for (const location of await listLocations(db, orgId)) {
    locations.set(normalize(location.name), location.id);
  }

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2; // +1 за заголовок, +1 за нумерацию с единицы

    if (!row.name?.trim()) {
      result.skipped.push({ row: rowNumber, reason: 'пустое название' });
      continue;
    }

    try {
      const existing = await findExisting(db, orgId, row);

      const fields = {
        name: row.name.trim(),
        sku: row.sku ?? null,
        barcode: row.barcode ?? null,
        unit: row.unit?.trim() || 'шт',
        sale_price: row.sale_price ?? 0,
      };

      let productId: string;
      if (existing) {
        await updateProduct(db, orgId, existing, fields);
        productId = existing;
        result.updated++;
      } else {
        const created = await createProduct(db, orgId, fields);
        productId = created.id;
        result.created++;
      }

      await applyExtraFields(db, orgId, productId, row);

      for (const [name, qty] of Object.entries(row.stocks ?? {})) {
        const locationId = await ensureLocation(db, orgId, locations, name, result);
        // Инвентаризация, а не приход: в выгрузке остаток уже итоговый,
        // и «сколько пришло» из неё неизвестно.
        await adjustStock(
          db,
          orgId,
          userId,
          {
            product_id: productId,
            location_id: locationId,
            actual_qty: qty,
            note: 'Загрузка каталога',
          },
          // В выгрузке из другой программы остатки бывают отрицательными —
          // переносим как есть, иначе картина не совпадёт с тем, что было.
          { allowNegative: true },
        );
        result.stockSet++;
      }
    } catch (error) {
      result.skipped.push({
        row: rowNumber,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/** Поля, которых нет в общем наборе createProduct — дописываем отдельно. */
async function applyExtraFields(
  db: SqlDb,
  orgId: string,
  productId: string,
  row: ImportRow,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [productId, orgId];

  const assign = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (row.code?.trim()) assign('code', Number(row.code.trim()) || null);
  if (row.discount_bp !== undefined) assign('discount_bp', row.discount_bp);
  if (row.purchase_price !== undefined) {
    assign('purchase_price', row.purchase_price);
    // Себестоимости в выгрузке нет — берём цену закупки как отправную точку,
    // дальше её уточнят приходы.
    assign('cost_price', row.purchase_price);
  }

  if (sets.length === 0) return;

  await db.query(
    `UPDATE products SET ${sets.join(', ')} WHERE id = $1 AND org_id = $2`,
    params,
  );
}

async function findExisting(db: SqlDb, orgId: string, row: ImportRow): Promise<string | null> {
  const code = row.code?.trim() ? Number(row.code.trim()) : null;

  if (code) {
    const byCode = await db.one<{ id: string }>(
      'SELECT id FROM products WHERE org_id = $1 AND code = $2',
      [orgId, code],
    );
    // Код есть, но не совпал — значит товар новый. Искать дальше по артикулу
    // нельзя: в выгрузках один артикул нередко стоит у разных позиций
    // (например, чай на развес и он же в зале), и они склеились бы в одну.
    return byCode?.id ?? null;
  }

  if (row.barcode?.trim()) {
    const byBarcode = await db.one<{ id: string }>(
      'SELECT id FROM products WHERE org_id = $1 AND barcode = $2',
      [orgId, row.barcode.trim()],
    );
    if (byBarcode) return byBarcode.id;
  }

  if (row.sku?.trim()) {
    const bySku = await db.one<{ id: string }>(
      'SELECT id FROM products WHERE org_id = $1 AND sku = $2',
      [orgId, row.sku.trim()],
    );
    if (bySku) return bySku.id;
  }

  return null;
}

async function ensureLocation(
  db: SqlDb,
  orgId: string,
  cache: Map<string, string>,
  name: string,
  result: ImportResult,
): Promise<string> {
  const key = normalize(name);
  const known = cache.get(key);
  if (known) return known;

  const created = await createLocation(db, orgId, { name: name.trim() });
  cache.set(key, created.id);
  result.locationsCreated++;
  return created.id;
}

function normalize(value: string): string {
  // В выгрузках названия магазинов приходят с лишними пробелами внутри.
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
