import { formatMoneyWeb } from '../domain/money';
import { formatPercent, marginBp, markupBp, formatDate } from '../domain/pricing';
import { formatQty } from '../domain/qty';
import type { ProductWithStock } from '../domain/types';

/**
 * Колонки справочника — все двадцать четыре, в том же порядке и с теми же
 * названиями, что в таблице исходного приложения.
 *
 * Их у него столько же, и одновременно они не помещаются — значит показывается
 * не всё, и какие именно, выбирает пользователь. Поэтому колонка описана
 * данными: ключ, подпись, ширина и как достать значение. Список показываемых —
 * это набор ключей, который можно сохранить.
 *
 * Ширины подобраны под содержимое: у него они тоже не равны, длинное
 * наименование шире, чем «Ед. изм.».
 */

export interface CatalogColumn {
  key: string;
  title: string;
  width: number;
  numeric?: boolean;
  /** Значение ячейки строкой; форматирование живёт здесь, а не в таблице. */
  value: (product: ProductWithStock) => string;
  /**
   * По чему сортировать. Число сортируется числом: «1 000,00» и «900,00»
   * строками сравниваются наоборот.
   */
  sort?: (product: ProductWithStock) => string | number;
}

/**
 * Отсортировать справочник по колонке.
 *
 * Заголовки в таблице подчёркнуты — значит, обещают сортировку. Пока её не
 * было, подчёркивание было обманом.
 */
export function sortProducts(
  products: ProductWithStock[],
  columns: CatalogColumn[],
  sorting: { key: string; reverse: boolean },
): ProductWithStock[] {
  const column = columns.find((one) => one.key === sorting.key);
  if (!column) return products;

  const of = (product: ProductWithStock) => {
    const raw = column.sort ? column.sort(product) : column.value(product);
    if (typeof raw === 'number') return raw;
    const text = raw.trim();
    return text === '' || text === '—' ? null : text.toLowerCase();
  };

  return [...products].sort((a, b) => {
    const left = of(a);
    const right = of(b);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;

    const order =
      typeof left === 'string' && typeof right === 'string'
        ? left.localeCompare(right, 'ru')
        : left < right
          ? -1
          : left > right
            ? 1
            : 0;

    return sorting.reverse ? -order : order;
  });
}

/** Прочерк вместо пустоты — так у него в карточке и в таблице. */
const dash = (value: string | null | undefined) => (value?.trim() ? value : '');

export const CATALOG_COLUMNS: CatalogColumn[] = [
  { key: 'name', title: 'Наименование', width: 430, value: (p) => p.name, sort: (p) => p.name },
  {
    key: 'code',
    title: 'Код',
    width: 110,
    // Код у него короткий номер вроде «01444». Если его не задали, показываем
    // номер записи тем же видом: по коду товар называют вслух, и пустая
    // клетка тут хуже подставленного номера.
    value: (p) => p.code ?? String(p.id).padStart(5, '0'),
  },
  { key: 'group', title: 'Группа', width: 190, value: (p) => dash(p.category_name) },
  {
    key: 'taxes',
    title: 'Налоги',
    width: 130,
    value: (p) => (p.vat_bp === null ? 'Без НДС' : formatPercent(p.vat_bp)),
  },
  { key: 'barcode', title: 'Штрих-код', width: 180, value: (p) => dash(p.barcode) },
  { key: 'sku', title: 'Артикул', width: 150, value: (p) => dash(p.sku) },
  { key: 'unit', title: 'Ед. изм.', width: 110, value: (p) => p.unit },
  { key: 'plu', title: 'PLU код', width: 120, value: (p) => dash(p.plu_code) },
  {
    key: 'expires',
    title: 'Срок годности',
    width: 160,
    value: (p) => (p.expires_at ? formatDate(p.expires_at) : ''),
  },
  { key: 'category', title: 'Категория', width: 190, value: (p) => dash(p.category_name) },
  { key: 'country', title: 'Страна', width: 150, value: (p) => dash(p.country) },
  { key: 'supplier', title: 'Поставщик', width: 200, value: (p) => dash(p.supplier_name) },
  {
    key: 'price',
    title: 'Цена продажи',
    width: 150,
    numeric: true,
    value: (p) => formatMoneyWeb(p.sale_price),
    sort: (p) => p.sale_price,
  },
  {
    key: 'cost',
    title: 'Себестоимость',
    width: 160,
    numeric: true,
    value: (p) => formatMoneyWeb(p.cost_price),
    sort: (p) => p.cost_price,
  },
  {
    key: 'purchase',
    title: 'Цена закупки',
    width: 150,
    numeric: true,
    value: (p) => formatMoneyWeb(p.purchase_price),
    sort: (p) => p.purchase_price,
  },
  {
    key: 'marginality',
    title: 'Маржинальность',
    width: 170,
    numeric: true,
    // Маржа — от цены продажи, и считается от себестоимости, а не от закупки.
    value: (p) => {
      const bp = marginBp(p.cost_price, p.sale_price);
      return bp === null ? '' : formatPercent(bp);
    },
  },
  {
    key: 'markup',
    title: 'Наценка',
    width: 140,
    numeric: true,
    // Наценка — от цены закупки: так её считает исходное приложение.
    value: (p) => {
      const bp = markupBp(p.purchase_price, p.sale_price);
      return bp === null ? '' : formatPercent(bp);
    },
  },
  {
    key: 'created',
    title: 'Создан',
    width: 150,
    value: (p) => new Date(p.created_at).toLocaleDateString('ru-RU'),
  },
  {
    key: 'discount',
    title: 'Скидка, %',
    width: 120,
    numeric: true,
    value: (p) => String(p.discount_bp / 100),
  },
  {
    key: 'min_qty',
    title: 'Мин. ост.',
    width: 130,
    numeric: true,
    value: (p) => (p.min_qty ? formatQty(p.min_qty) : ''),
  },
];

/**
 * Что показывается, пока пользователь не выбрал своё.
 *
 * Не все двадцать четыре: в тысячу пикселей их не уложить, и таблица с
 * горизонтальной прокруткой на два экрана бесполезна. Взяты те, по которым
 * в чайной ищут товар и решают, что с ним делать.
 */
export const DEFAULT_COLUMNS = [
  'name',
  'code',
  'sku',
  'unit',
  'price',
  'cost',
  'markup',
  'discount',
];

export const COLUMNS_KEY = 'catalog_columns';
