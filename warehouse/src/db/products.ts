import type { SqlDriver, SqlParam } from './driver';
import { dayShift, today } from '../domain/pricing';
import type { Milli } from '../domain/qty';
import type { Category, Id, Product, ProductKind, ProductWithStock } from '../domain/types';

/**
 * Остаток берётся подзапросом по stock_moves, а не хранимым полем.
 * COALESCE — потому что у товара без движений SUM даёт NULL.
 */
const STOCK_SUBQUERY = `
  COALESCE((SELECT SUM(m.qty_delta) FROM stock_moves m WHERE m.product_id = p.id), 0) AS stock
`;

const SELECT_PRODUCT = `
  SELECT p.*, ${STOCK_SUBQUERY},
         c.name AS category_name,
         s.name AS supplier_name
  FROM products p
  LEFT JOIN categories c      ON c.id = p.category_id
  LEFT JOIN counterparties s  ON s.id = p.supplier_id
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
   * Чем сортировать и в какую сторону — настройка кассы «Сортировка товара по».
   *
   * По умолчанию название: справочник читают глазами, и алфавит — то,
   * в чём его читают.
   */
  sortBy?: 'name' | 'price' | 'changed';
  sortAsc?: boolean;
  /** Убрать с витрины то, чего нет на остатке. */
  hideZeroStocks?: boolean;
  /**
   * Прятать ли товары скрытых категорий.
   *
   * Скрытая категория — это «не показывать в зале»: посуда под заказ,
   * служебные позиции. В настройках кассы есть переключатель, который
   * возвращает их на витрину, не снимая скрытия с самой категории.
   */
  hideHiddenCategories?: boolean;
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

  // «Товары с нулевым остатком: не показывать». Услуги остаются: у них
  // остатка нет вовсе, и прятать их вместе с кончившимся чаем неправильно.
  if (filter.hideZeroStocks) having.push("(stock > 0 OR p.kind = 'service')");

  if (filter.hideHiddenCategories) {
    where.push(
      '(p.category_id IS NULL OR p.category_id NOT IN (SELECT id FROM categories WHERE hidden = 1))',
    );
  }

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
    `${SELECT_PRODUCT} ${whereSql} GROUP BY p.id ${havingSql} ORDER BY ${orderBy(filter)}`,
    [...whereParams, ...havingParams],
  );
}

/**
 * Порядок строк для запроса.
 *
 * Собирается здесь, а не подставляется параметром: в SQL порядок — часть
 * текста запроса, и подставлять в него что попало нельзя. Поэтому имена
 * колонок выбираются из закрытого списка.
 */
function orderBy(filter: ProductFilter): string {
  const direction = filter.sortAsc === false ? 'DESC' : 'ASC';

  if (filter.sortBy === 'price') return `p.sale_price ${direction}, p.name COLLATE NOCASE`;
  // «Дата изменения» — у нас это дата создания карточки: отдельного поля
  // правки нет, и придумывать его задним числом нельзя.
  if (filter.sortBy === 'changed') return `p.created_at ${direction}, p.name COLLATE NOCASE`;
  return `p.name COLLATE NOCASE ${direction}`;
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
type Required = 'name' | 'sku' | 'barcode' | 'category_id' | 'unit'
  | 'cost_price' | 'sale_price' | 'min_qty' | 'photo_uri';

export type ProductInput = Pick<Product, Required> &
  Partial<Omit<Product, Required | 'id' | 'created_at' | 'archived'>>;

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
    input.purchase_price ?? 0,
    emptyToNull(input.country),
    input.supplier_id ?? null,
    emptyToNull(input.description),
    emptyToNull(input.plu_code),
    emptyToNull(input.gtin),
    input.weighted ?? 0,
    input.height_mm ?? null,
    input.width_mm ?? null,
    input.depth_mm ?? null,
    input.weight_g ?? null,
    input.free_price ?? 0,
    input.store_price ?? 0,
    emptyToNull(input.marking_type),
    emptyToNull(input.tax_system),
    input.excisable ?? 0,
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
  'purchase_price',
  'country',
  'supplier_id',
  'description',
  'plu_code',
  'gtin',
  'weighted',
  'height_mm',
  'width_mm',
  'depth_mm',
  'weight_g',
  'free_price',
  'store_price',
  'marking_type',
  'tax_system',
  'excisable',
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

  // Номер — следующий по порядку: иначе у всех новых он нулевой, и список в
  // настройках кассы выглядит так, будто порядка нет вовсе.
  db.run(
    `INSERT INTO categories (name, sort)
     VALUES (?, (SELECT COALESCE(MAX(sort) + 1, 0) FROM categories))`,
    [trimmed],
  );
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

/**
 * Состав комплекта: из каких товаров он собран.
 *
 * Хранится отдельной таблицей, а не строкой в карточке: позиция состава — это
 * ссылка на товар, и цена у неё берётся из этого товара. Список в тексте
 * разошёлся бы с ценами на следующий день.
 */
export interface SetItem {
  product_id: Id;
  name: string;
  unit: string;
  /** Сколько единиц входит в комплект, тысячные. */
  qty: number;
  /** Цена продажи входящего товара на сейчас, копейки. */
  price: number;
  /** Цена × количество, копейки. */
  sum: number;
}

export function setItems(db: SqlDriver, setId: Id): SetItem[] {
  return db.all<SetItem>(
    `SELECT s.product_id,
            p.name,
            p.unit,
            s.qty,
            p.sale_price AS price,
            CAST(ROUND(s.qty * p.sale_price / 1000.0) AS INTEGER) AS sum
     FROM product_set_items s
     JOIN products p ON p.id = s.product_id
     WHERE s.set_id = ?
     ORDER BY p.name COLLATE NOCASE`,
    [setId],
  );
}

/** Заменяет состав комплекта целиком: частичная правка тут только путает. */
export function saveSetItems(
  db: SqlDriver,
  setId: Id,
  items: { product_id: Id; qty: number }[],
): void {
  db.tx(() => {
    db.run('DELETE FROM product_set_items WHERE set_id = ?', [setId]);
    for (const item of items) {
      if (item.qty <= 0) continue;
      db.run(
        'INSERT INTO product_set_items (set_id, product_id, qty) VALUES (?, ?, ?)',
        [setId, item.product_id, item.qty],
      );
    }
  });
}

/** Цена продажи товара в конкретном магазине; пусто — цена общая. */
export function storePrices(db: SqlDriver, productId: Id): Map<Id, number> {
  const rows = db.all<{ location_id: Id; price: number }>(
    'SELECT location_id, price FROM product_prices WHERE product_id = ?',
    [productId],
  );
  return new Map(rows.map((row) => [row.location_id, row.price]));
}

export function saveStorePrices(
  db: SqlDriver,
  productId: Id,
  prices: Map<Id, number | null>,
): void {
  db.tx(() => {
    for (const [locationId, price] of prices) {
      // Пустая цена означает «как у всех» — строку тогда просто удаляем,
      // иначе у товара навсегда осталась бы копия общей цены, которая
      // перестанет меняться вместе с ней.
      if (price === null) {
        db.run('DELETE FROM product_prices WHERE product_id = ? AND location_id = ?', [
          productId,
          locationId,
        ]);
        continue;
      }

      db.run(
        `INSERT INTO product_prices (product_id, location_id, price) VALUES (?, ?, ?)
         ON CONFLICT(product_id, location_id) DO UPDATE SET price = excluded.price`,
        [productId, locationId, price],
      );
    }
  });
}

/**
 * Упаковка: «коробка — 12 шт».
 *
 * У товара их бывает несколько — коробка, палета, блок, — и продаётся он всё
 * равно в базовой единице: упаковка нужна приёмке, чтобы вбить «3 коробки»
 * вместо «36 штук». Поэтому это отдельные строки, а не поле в карточке.
 */
export interface Pack {
  id: Id;
  name: string;
  /** Сколько базовых единиц в упаковке, тысячные. */
  qty: Milli;
}

export function listPacks(db: SqlDriver, productId: Id): Pack[] {
  return db.all<Pack>(
    'SELECT id, name, qty FROM product_packs WHERE product_id = ? ORDER BY qty, id',
    [productId],
  );
}

/** Заменяет список упаковок целиком — как и состав комплекта. */
export function savePacks(
  db: SqlDriver,
  productId: Id,
  packs: { name: string; qty: Milli }[],
): void {
  db.tx(() => {
    db.run('DELETE FROM product_packs WHERE product_id = ?', [productId]);
    for (const pack of packs) {
      // Упаковка без названия или с нулевым количеством ничего не значит:
      // такие строки остаются в форме от нажатия «Добавить упаковку».
      if (!pack.name.trim() || pack.qty <= 0) continue;
      db.run('INSERT INTO product_packs (product_id, name, qty) VALUES (?, ?, ?)', [
        productId,
        pack.name.trim(),
        pack.qty,
      ]);
    }
  });
}

/**
 * Все категории товара.
 *
 * Их у товара бывает несколько, но в `products.category_id` лежит одна —
 * первая. По ней собран отчёт по категориям и колонка справочника, и менять
 * это ради второй категории значило бы переписать обе.
 */
export function productCategories(db: SqlDriver, productId: Id): string[] {
  const linked = db
    .all<{ name: string }>(
      `SELECT c.name
       FROM product_categories pc
       JOIN categories c ON c.id = pc.category_id
       WHERE pc.product_id = ?
       ORDER BY c.name COLLATE NOCASE`,
      [productId],
    )
    .map((row) => row.name);

  if (linked.length > 0) return linked;

  // Список пуст не только у товара без категории: товар мог приехать импортом
  // или родиться на кассе — там заполняется одна колонка в карточке, и списка
  // ему никто не заводил. Тогда единственная категория и есть весь список.
  const own = db.get<{ name: string }>(
    `SELECT c.name FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.id = ?`,
    [productId],
  );

  return own ? [own.name] : [];
}

/**
 * Записывает список категорий и заодно первую — в саму карточку.
 *
 * Категории заводятся по мере надобности: в оригинале новую вводят прямо в
 * поле и нажимают Enter, отдельного справочника для этого открывать не надо.
 */
export function saveCategories(db: SqlDriver, productId: Id, names: string[]): void {
  db.tx(() => {
    const ids = names
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ensureCategory(db, name));

    db.run('DELETE FROM product_categories WHERE product_id = ?', [productId]);
    for (const id of ids) {
      db.run(
        'INSERT OR IGNORE INTO product_categories (product_id, category_id) VALUES (?, ?)',
        [productId, id],
      );
    }

    db.run('UPDATE products SET category_id = ? WHERE id = ?', [ids[0] ?? null, productId]);
  });
}

/** Категория витрины: название и сколько в ней товаров. */
export interface CategoryTile {
  id: Id;
  name: string;
  /** Сколько товаров в ней — то самое «N поз.» под названием. */
  count: number;
  /** Цвет из настроек кассы; `null` — плитка белая. */
  color: string | null;
  /** Плитка вдвое шире — «размер» в настройках. */
  big: boolean;
}

/**
 * Категории для витрины кассы.
 *
 * Пустые не показываются: категория без товаров на кассе — плитка, ведущая
 * в пустую витрину.
 */
export function listCategoryTiles(db: SqlDriver): CategoryTile[] {
  const rows = db.all<Omit<CategoryTile, 'big'> & { big: number }>(
    `SELECT c.id,
            c.name,
            c.color,
            c.big,
            COUNT(p.id) AS count
     FROM categories c
     JOIN products p ON p.category_id = c.id AND p.archived = 0
     WHERE c.hidden = 0
     GROUP BY c.id
     ORDER BY c.sort, c.name COLLATE NOCASE`,
  );

  return rows.map((row) => ({ ...row, big: row.big === 1 }));
}
