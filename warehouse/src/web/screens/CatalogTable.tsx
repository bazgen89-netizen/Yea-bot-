import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../Translated';

import { CATALOG_COLUMNS, COLUMNS_KEY, DEFAULT_COLUMNS } from '../catalogColumns';
import { ColumnPicker } from '../ColumnPicker';
import { FilterPanel } from '../FilterPanel';
import { Checkbox, Column, HeadRow, Pager, Row, SearchBox, ToolButton, Toolbar } from '../Table';
import { listLocations, stockByLocation } from '../../db/locations';
import { listProducts } from '../../db/products';
import { formatMoneyWeb } from '../../domain/money';
import { formatQty } from '../../domain/qty';
import { pluralize } from '../../domain/plural';
import type { ProductWithStock } from '../../domain/types';
import { useCatalogFilters } from '../../state/catalogFilters';
import { useQuery } from '../../state/DatabaseProvider';
import { WebIcon } from '../../ui/icons';
import { web, webText, WEB_FONT } from '../../ui/webTheme';
import { ProductCard } from './ProductCard';

/** Сколько строк на странице. При 661 товаре выходит семь страниц — как в исходном. */
const PAGE_SIZE = 100;

/**
 * «Товары и услуги / справочник» — таблица кабинета.
 *
 * Колонки остатков заводятся по магазинам из базы: сколько точек завели,
 * столько и колонок. Захардкодить их нельзя — у другого магазина набор свой.
 */
export function CatalogTable({ openId }: { openId?: string } = {}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  // Какой товар открыт в панели справа. Не переход по адресу: у него список
  // остаётся виден слева, а страница не перезагружается — иначе после
  // закрытия карточки пришлось бы заново листать до нужной страницы и
  // набирать поиск.
  const [open, setOpen] = useState<string | null>(openId ?? null);
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);

  const filters = useCatalogFilters();

  // Какие колонки показывать. Выбор запоминается: у него он тоже переживает
  // перезагрузку, иначе настраивать таблицу пришлось бы каждое утро.
  const [shown, setShown] = useState<string[]>(() => readColumns());

  const products = useQuery(
    (db) => listProducts(db, { search, presets: filters.presets }),
    [search, filters.presets],
  );
  const locations = useQuery((db) => listLocations(db));
  const stock = useQuery((db) => stockByLocation(db));

  // Показываемые колонки в том порядке, в каком они объявлены, а не в каком
  // их отмечали: порядок столбцов — часть таблицы, а не история нажатий.
  const picked = useMemo(
    () => CATALOG_COLUMNS.filter((column) => shown.includes(column.key)),
    [shown],
  );

  const columns = useMemo<Column[]>(
    () => [
      ...picked.map((column) => ({
        key: column.key,
        title: column.title,
        width: column.width,
        numeric: column.numeric,
        sortable: true,
      })),
      // Остаток по каждому магазину — столько колонок, сколько точек заведено.
      ...locations.map((location) => ({
        key: `loc${location.id}`,
        title: location.name,
        width: 168,
        numeric: true,
      })),
    ],
    [picked, locations],
  );

  const pages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const page1 = products.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <View style={styles.screen}>
      <Toolbar>
        <SearchBox
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Поиск по наименованию,"
        />
        <ToolButton
          label={filters.active > 0 ? `Фильтр: ${filters.active}` : 'Фильтр'}
          tone={filters.active > 0 ? 'blueOutline' : 'plain'}
          icon={<WebIcon.funnel color={filters.active > 0 ? web.link : web.text} />}
          onPress={() => {
            setFilterOpen(true);
            setPage(1);
          }}
        />
        <ToolButton
          label={`Действия ${products.length} поз.`}
          trailing={<WebIcon.chevronDown color={web.text} />}
          soon
        />
        <ToolButton
          label={`Колонки: ${picked.length}`}
          onPress={() => setColumnsOpen(true)}
        />
        <ToolButton
          label="Создать товар"
          tone="green"
          onPress={() => setOpen('new')}
        />
        <ToolButton label="" icon={<WebIcon.folderPlus color={web.text} />} soon />
        <ToolButton
          label="Импорт товаров"
          tone="greenOutline"
          icon={<WebIcon.excel color={web.greenText} />}
          onPress={() => router.push('/import?kind=products')}
        />
      </Toolbar>

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <HeadRow columns={columns} lead={<Checkbox />} />

          <ScrollView style={styles.body}>
            {page1.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                picked={picked}
                locations={locations.map((location) => location.id)}
                widths={columns}
                stock={stock.get(product.id)}
                onPress={() => setOpen(String(product.id))}
              />
            ))}

            {page1.length === 0 ? (
              <Text style={styles.empty}>
                {search ? 'Ничего не нашлось' : 'В справочнике пока нет товаров'}
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </ScrollView>

      <FilterPanel
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
      />

      <ColumnPicker
        visible={columnsOpen}
        onClose={() => setColumnsOpen(false)}
        shown={shown}
        onToggle={(key) => {
          setShown((current2) => {
            const next = current2.includes(key)
              ? current2.filter((item) => item !== key)
              : [...current2, key];
            writeColumns(next);
            return next;
          });
        }}
        onReset={() => {
          setShown(DEFAULT_COLUMNS);
          writeColumns(DEFAULT_COLUMNS);
        }}
      />

      {open !== null ? <ProductCard id={open} onClose={() => setOpen(null)} /> : null}

      <Pager page={current} pages={pages} onPage={setPage} />

      <View style={styles.createRow}>
        <Text style={styles.createSign}>⊞</Text>
        <Text
          style={styles.createLabel}
          onPress={() => setOpen('new')}
        >
          Создать новый товар или услугу
        </Text>
        <Text style={styles.total}>
          {pluralize(products.length, 'позиция', 'позиции', 'позиций')}
        </Text>
      </View>
    </View>
  );
}

function ProductRow({
  product,
  picked,
  widths,
  locations,
  stock,
  onPress,
}: {
  product: ProductWithStock;
  picked: typeof CATALOG_COLUMNS;
  widths: Column[];
  locations: number[];
  stock: Map<number, number> | undefined;
  onPress: () => void;
}) {
  return (
    <Row onPress={onPress}>
      <Checkbox />

      {picked.map((column, index) => {
        // Первая колонка несёт картинку и ссылку — по ней открывают товар.
        if (index === 0) {
          return (
            <View key={column.key} style={[styles.nameCell, { width: column.width }]}>
              <View style={styles.thumb}>
                {product.photo_uri ? (
                  <Image source={{ uri: product.photo_uri }} style={styles.thumbImage} />
                ) : (
                  <WebIcon.products size={19} color="#C4C7CA" />
                )}
              </View>
              <Text style={styles.link} numberOfLines={3}>
                {column.value(product)}
              </Text>
            </View>
          );
        }

        return (
          <Text
            key={column.key}
            style={[
              column.numeric ? webText.cellNumber : webText.cell,
              { width: column.width },
              column.numeric && styles.right,
            ]}
            numberOfLines={1}
          >
            {column.value(product)}
          </Text>
        );
      })}

      {locations.map((id, index) => {
        const qty = stock?.get(id) ?? 0;
        return (
          <Text
            key={id}
            style={[
              webText.cellNumber,
              styles.right,
              { width: widths[picked.length + index]?.width ?? 168 },
              qty < 0 && { color: web.danger },
            ]}
          >
            {formatQty(qty)}
          </Text>
        );
      })}
    </Row>
  );
}

/**
 * Выбор колонок хранится в том же месте, что настройки: это настройка одного
 * человека, а не данные склада.
 */
function readColumns(): string[] {
  try {
    const saved = globalThis.localStorage?.getItem(COLUMNS_KEY);
    const parsed = saved ? (JSON.parse(saved) as string[]) : null;
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

function writeColumns(columns: string[]): void {
  try {
    globalThis.localStorage?.setItem(COLUMNS_KEY, JSON.stringify(columns));
  } catch {
    // Приватный режим браузера запрещает запись — выбор просто не запомнится.
  }
}

/**
 * Код товара — короткий номер вроде «01444». Если у товара его не задали,
 * показываем номер записи в том же виде: колонка не должна пустовать, по ней
 * товар ищут вслух.
 */
function codeOf(product: ProductWithStock): string {
  return product.code ?? String(product.id).padStart(5, '0');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  body: { maxHeight: 10000 },
  nameCell: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 2,
    backgroundColor: '#F1F3F4',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  // Название товара — 15 пикселей: в оригинале ссылка в строке крупнее ячеек.
  link: { flex: 1, fontFamily: WEB_FONT, fontSize: 15, color: web.link, lineHeight: 19 },
  right: { textAlign: 'right' },
  empty: { padding: 40, fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: web.border,
  },
  createSign: { fontFamily: WEB_FONT, fontSize: 16, color: web.link },
  createLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.link },
  total: { flex: 1, textAlign: 'right', fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted },
});
