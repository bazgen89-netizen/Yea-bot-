import type { SqlDriver, SqlParam } from './driver';
import { dayShift, today } from '../domain/pricing';
import type { Category, Id, Product, ProductKind, ProductWithStock } from '../domain/types';

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

/**
 * Готовые фильтры каталога — те же и с теми же названиями, что в исходном
 * приложении. Названия важны не меньше условий: по ним пользователь ищет
 * знакомую строчку в списке.
 */
export type ProductPreset =
  | 'out_of_stock'
  | 'negative'
  | 'zero_cost'
  | 'below_min'
  | 'not_sold_3m'
  | 'discounted'
  | 'expired'
  | 'expiring_7d';

export const PRESET_LABEL: Record<ProductPreset, string> = {
  out_of_stock: 'Нет в наличии',
  negative: 'Отрицательный остаток',
  zero_cost: 'Нулевая себестоимость',
  below_min: 'Общий остаток меньше минимального',
  not_sold_3m: 'Не продаются 3 месяца',
  discounted: 'Товары со скидкой',
  expired: 'Истёк срок годности',
  expiring_7d: 'Истекает в течение 7 дней',
};

export const PRESETS: ProductPreset[] = Object.keys(PRESET_LABEL) as ProductPreset[];

export interface ProductFilter {
  /** Поиск по названию, артикулу или штрихкоду. */
  search?: string;
  categoryId?: Id | null;
  kind?: ProductKind;
  /** Показывать архивные товары. По умолчанию — нет. */
  includeArchived?: boolean;
  /** Только товары, где остаток <= min_qty и min_qty > 0. */
  lowStockOnly?: boolean;
  /** Готовые фильтры. Несколько складываются по «и», как в исходнике. */
  presets?: ProductPreset[];
  /**
   * Какой день считать сегодняшним — для сроков годности и «не продаётся
   * три месяца». Передаётся снаружи, чтобы отчёт о просрочке можно было
   * проверить тестом, а не ждать нужного числа календаря.
   */
  today?: string;
}

/**
 * Условия пресетов, разложенные на две кучи: те, что проверяются по колонкам
 * товара, и те, что смотрят на остаток. Остаток — сумма движений, то есть
 * агрегат, и в WHERE он недоступен; такие условия уходят в HAVING.
 */
function presetSql(
  preset: ProductPreset,
  now: string,
): { where?: string; having?: string; params: SqlParam[] } {
  switch (preset) {
    // «Нет в наличии» — нечего продать, включая уход в минус: отрицательный
    // остаток тоже означает, что товара на полке нет.
    case 'out_of_stock':
      return { having: 'stock <= 0', params: [] };
    case 'negative':
      return { having: 'stock < 0', params: [] };
    case 'zero_cost':
      return { where: 'p.cost_price = 0', params: [] };
    case 'below_min':
      return { having: 'p.min_qty > 0 AND stock < p.min_qty', params: [] };
    case 'not_sold_3m':
      return {
        where: `NOT EXISTS (
          SELECT 1 FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          WHERE si.product_id = p.id AND s.created_at >= ?
        )`,
        params: [`${dayShift(-90, now)}T00:00:00.000Z`],
      };
    case 'discounted':
      return { where: 'p.discount_bp > 0', params: [] };
    case 'expired':
      return { where: 'p.expires_at IS NOT NULL AND p.expires_at < ?', params: [now] };
    case 'expiring_7d':
      return {
        where: 'p.expires_at IS NOT NULL AND p.expires_at >= ? AND p.expires_at <= ?',
        params: [now, dayShift(7, now)],
      };
  }
}

export function listProducts(db: SqlDriver, filter: ProductFilter = {}): ProductWithStock[] {
  const where: string[] = [];
  const having: string[] = [];
  const whereParams: SqlParam[] = [];
  const havingParams: SqlParam[] = [];

  if (!filter.includeArchived) where.push('p.archived = 0');

  if (filter.search?.trim()) {
    where.push('p.search_text LIKE ?');
    whereParams.push(`%${normalize(filter.search)}%`);
  }

  if (filter.categoryId != null) {
    where.push('p.category_id = ?');
    whereParams.push(filter.categoryId);
  }

  if (filter.kind) {
    where.push('p.kind = ?');
    whereParams.push(filter.kind);
  }

  // Фильтр по остатку — через HAVING: stock это агрегат, в WHERE он недоступен.
  if (filter.lowStockOnly) having.push('p.min_qty > 0 AND stock <= p.min_qty');

  const now = filter.today ?? today();
  for (const preset of filter.presets ?? []) {
    const part = presetSql(preset, now);
    if (part.where) {
      where.push(`(${part.where})`);
      whereParams.push(...part.params);
    }
    if (part.having) {
      having.push(`(${part.having})`);
      havingParams.push(...part.params);
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const havingSql = having.length ? `HAVING ${having.join(' AND ')}` : '';

  return db.all<ProductWithStock>(
    `${SELECT_PRODUCT} ${whereSql} GROUP BY p.id ${havingSql} ORDER BY p.name COLLATE NOCASE`,
    [...whereParams, ...havingParams],
  );
}

/** Сколько товаров попадает под каждый готовый фильтр — числа рядом с названиями. */
export function presetCounts(
  db: SqlDriver,
  base: ProductFilter = {},
): Record<ProductPreset, number> {
  const counts = {} as Record<ProductPreset, number>;
  for (const preset of PRESETS) {
    counts[preset] = listProducts(db, { ...base, presets: [preset] }).length;
  }
  return counts;
}

export function getProduct(db: SqlDriver, id: Id): ProductWithStock | null {
  return db.get<ProductWithStock>(`${SELECT_PRODUCT} WHERE p.id = ?`, [id]);
}

export function findByBarcode(db: SqlDriver, barcode: string): ProductWithStock | null {
  return db.get<ProductWithStock>(`${SELECT_PRODUCT} WHERE p.barcode = ? AND p.archived = 0`, [
    barcode,
  ]);
}

/**
 * Что нужно, чтобы завести товар.
 *
 * Поля, появившиеся вслед за исходным приложением — вид, код, НДС, срок
 * годности, скидка — необязательные: закупка, импорт и сканер заводят товар
 * по названию и цене, и требовать от них ставку НДС значило бы усложнить
 * каждое из этих мест ради поля, которое они не знают.
 */
export type ProductInput = Omit<
  Product,
  'id' | 'created_at' | 'archived' | 'kind' | 'code' | 'vat_bp' | 'expires_at' | 'discount_bp'
> &
  Partial<Pick<Product, 'kind' | 'code' | 'vat_bp' | 'expires_at' | 'discount_bp'>>;

/** Значения колонок в порядке, общем для INSERT и UPDATE. */
function columns(input: ProductInput): SqlParam[] {
  return [
    input.name,
    input.kind ?? 'product',
    emptyToNull(input.sku),
    emptyToNull(input.code),
    emptyToNull(input.barcode),
    input.category_id,
    input.unit,
    input.cost_price,
    input.sale_price,
    input.min_qty,
    input.vat_bp ?? null,
    emptyToNull(input.expires_at),
    input.discount_bp ?? 0,
    emptyToNull(input.photo_uri),
    searchText(input),
  ];
}

const COLUMN_NAMES = [
  'name',
  'kind',
  'sku',
  'code',
  'barcode',
  'category_id',
  'unit',
  'cost_price',
  'sale_price',
  'min_qty',
  'vat_bp',
  'expires_at',
  'discount_bp',
  'photo_uri',
  'search_text',
];

export function createProduct(db: SqlDriver, input: ProductInput): Id {
  db.run(
    `INSERT INTO products (${COLUMN_NAMES.join(', ')}, created_at)
     VALUES (${COLUMN_NAMES.map(() => '?').join(', ')}, ?)`,
    [...columns(input), new Date().toISOString()],
  );
  return db.lastInsertId();
}

export function updateProduct(db: SqlDriver, id: Id, input: ProductInput): void {
  db.run(
    `UPDATE products SET ${COLUMN_NAMES.map((name) => `${name} = ?`).join(', ')} WHERE id = ?`,
    [...columns(input), id],
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

/**
 * Свои наборы фильтров: «сохранить, назвать, удалить» — как в исходном
 * приложении. Лежат в `app_state` строкой JSON: набор фильтров — это настройка
 * одного человека, а не сущность склада, и таблицы под неё не нужно.
 */
export interface SavedFilter {
  name: string;
  presets: ProductPreset[];
  categoryId?: Id | null;
  kind?: ProductKind;
}

const FILTERS_KEY = 'catalog_filters';

export function listSavedFilters(db: SqlDriver): SavedFilter[] {
  const row = db.get<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [
    FILTERS_KEY,
  ]);
  if (!row) return [];

  try {
    const parsed = JSON.parse(row.value) as SavedFilter[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Сохраняет набор под именем; одноимённый заменяется. */
export function saveFilter(db: SqlDriver, filter: SavedFilter): void {
  const rest = listSavedFilters(db).filter((item) => item.name !== filter.name);
  writeFilters(db, [...rest, filter]);
}

export function deleteFilter(db: SqlDriver, name: string): void {
  writeFilters(
    db,
    listSavedFilters(db).filter((item) => item.name !== name),
  );
}

function writeFilters(db: SqlDriver, filters: SavedFilter[]): void {
  db.run(
    `INSERT INTO app_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [FILTERS_KEY, JSON.stringify(filters)],
  );
}

/** Приводит строку к виду, пригодному для поиска без учёта регистра. */
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Собирает содержимое колонки search_text из полей товара. */
function searchText(input: ProductInput): string {
  return [input.name, input.sku, input.code, input.barcode]
    .filter((v): v is string => Boolean(v?.trim()))
    .map(normalize)
    .join(' ');
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
