import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

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
import { web, webText } from '../../ui/webTheme';

/** Сколько строк на странице. При 661 товаре выходит семь страниц — как в исходном. */
const PAGE_SIZE = 100;

/**
 * «Товары и услуги / справочник» — таблица кабинета.
 *
 * Колонки остатков заводятся по магазинам из базы: сколько точек завели,
 * столько и колонок. Захардкодить их нельзя — у другого магазина набор свой.
 */
export function CatalogTable() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);

  const filters = useCatalogFilters();

  const products = useQuery(
    (db) => listProducts(db, { search, presets: filters.presets }),
    [search, filters.presets],
  );
  const locations = useQuery((db) => listLocations(db));
  const stock = useQuery((db) => stockByLocation(db));

  const columns = useMemo<Column[]>(
    () => [
      { key: 'name', title: 'Наименование', width: 430, sortable: true },
      { key: 'code', title: 'Код', width: 96, sortable: true },
      { key: 'sku', title: 'Артикул', width: 116, sortable: true },
      { key: 'unit', title: 'Ед. изм.', width: 88, sortable: true },
      { key: 'price', title: 'Цена продажи', width: 128, sortable: true },
      { key: 'discount', title: 'Скидка, %', width: 100, sortable: true },
      ...locations.map((location) => ({
        key: `loc${location.id}`,
        title: location.name,
        width: 168,
        numeric: true,
      })),
    ],
    [locations],
  );

  const pages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const shown = products.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

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
          label="Создать товар"
          tone="green"
          onPress={() => router.push({ pathname: '/product/[id]', params: { id: 'new' } })}
        />
        <ToolButton label="" icon={<WebIcon.folderPlus color={web.text} />} soon />
        <ToolButton
          label="Импорт товаров"
          tone="greenOutline"
          icon={<WebIcon.excel color={web.greenText} />}
          soon
        />
      </Toolbar>

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <HeadRow columns={columns} lead={<Checkbox />} />

          <ScrollView style={styles.body}>
            {shown.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                columns={columns}
                locations={locations.map((location) => location.id)}
                stock={stock.get(product.id)}
                onPress={() =>
                  router.push({ pathname: '/product/[id]', params: { id: String(product.id) } })
                }
              />
            ))}

            {shown.length === 0 ? (
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

      <Pager page={current} pages={pages} onPage={setPage} />

      <View style={styles.createRow}>
        <Text style={styles.createSign}>⊞</Text>
        <Text
          style={styles.createLabel}
          onPress={() => router.push({ pathname: '/product/[id]', params: { id: 'new' } })}
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
  columns,
  locations,
  stock,
  onPress,
}: {
  product: ProductWithStock;
  columns: Column[];
  locations: number[];
  stock: Map<number, number> | undefined;
  onPress: () => void;
}) {
  const [name, code, sku, unit, price, discount] = columns;

  return (
    <Row onPress={onPress}>
      <Checkbox />

      <View style={[styles.nameCell, { width: name.width }]}>
        <View style={styles.thumb}>
          {product.photo_uri ? (
            <Image source={{ uri: product.photo_uri }} style={styles.thumbImage} />
          ) : (
            <WebIcon.products size={19} color="#C4C7CA" />
          )}
        </View>
        <Text style={styles.link} numberOfLines={3}>
          {product.name}
        </Text>
      </View>

      <Text style={[webText.cellNumber, { width: code.width }]}>{codeOf(product)}</Text>
      <Text style={[webText.cellNumber, { width: sku.width }]} numberOfLines={1}>
        {product.sku ?? ''}
      </Text>
      <Text style={[webText.cell, { width: unit.width }]}>{product.unit}</Text>
      <Text style={[webText.cellNumber, { width: price.width }]}>
        {formatMoneyWeb(product.sale_price)}
      </Text>
      <Text style={[webText.cellNumber, { width: discount.width }]}>
        {product.discount_bp ? product.discount_bp / 100 : 0}
      </Text>

      {locations.map((id, index) => {
        const qty = stock?.get(id) ?? 0;
        return (
          <Text
            key={id}
            style={[
              webText.cellNumber,
              styles.right,
              { width: columns[6 + index].width },
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
  link: { flex: 1, fontSize: 14, color: web.link, lineHeight: 19 },
  right: { textAlign: 'right' },
  empty: { padding: 40, fontSize: 15, color: web.textMuted },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: web.border,
  },
  createSign: { fontSize: 16, color: web.link },
  createLabel: { fontSize: 15, color: web.link },
  total: { flex: 1, textAlign: 'right', fontSize: 14, color: web.textMuted },
});
