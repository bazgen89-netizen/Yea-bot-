import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { findByBarcode, listProducts } from '../../src/db/products';
import { formatMoney } from '../../src/domain/money';
import { formatQty } from '../../src/domain/qty';
import { pluralize } from '../../src/domain/plural';
import type { ProductWithStock } from '../../src/domain/types';
import { useDatabase, useQuery } from '../../src/state/DatabaseProvider';
import { useScanner } from '../../src/state/ScannerProvider';
import { AppHeader, HeaderButton } from '../../src/ui/AppHeader';
import { colors, radius, spacing, text } from '../../src/ui/theme';

export type SortField = 'name' | 'sale_price' | 'stock' | 'updated';
export type SortDirection = 'asc' | 'desc';

export default function CatalogScreen() {
  const router = useRouter();
  const { db } = useDatabase();
  const { scanBarcode } = useScanner();

  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [sortField, setSortField] = useState<SortField>('name');
  const [direction, setDirection] = useState<SortDirection>('asc');

  const products = useQuery(
    (database) => listProducts(database, { search, lowStockOnly }),
    [search, lowStockOnly],
  );

  const sorted = sortProducts(products, sortField, direction);

  async function scanAndOpen() {
    const code = await scanBarcode();
    if (!code) return;

    const found = findByBarcode(db, code);
    router.push(
      found
        ? { pathname: '/product/[id]', params: { id: String(found.id) } }
        : { pathname: '/product/[id]', params: { id: 'new', barcode: code } },
    );
  }

  return (
    <View style={styles.screen}>
      <AppHeader
        title="Каталог"
        subtitle={pluralize(products.length, 'позиция', 'позиции', 'позиций')}
        right={
          <>
            <HeaderButton
              label={lowStockOnly ? 'Показать все товары' : 'Только заканчивающиеся'}
              symbol={lowStockOnly ? '🔵' : '🔽'}
              onPress={() => setLowStockOnly((value) => !value)}
            />
            <HeaderButton label="Сканировать штрихкод" symbol="⌗" onPress={scanAndOpen} />
            <HeaderButton
              label="Сортировка"
              symbol="⋮"
              onPress={() => {
                // Пока меню сортировки не сделано отдельным экраном — нажатие
                // переключает направление, самое частое действие.
                setDirection((value) => (value === 'asc' ? 'desc' : 'asc'));
              }}
            />
          </>
        }
      />

      <View style={styles.searchRow}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Поиск"
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          clearButtonMode="while-editing"
        />
      </View>

      <View style={styles.sortBar}>
        <Text style={text.muted}>
          {SORT_LABEL[sortField]} · {direction === 'asc' ? 'по возрастанию' : 'по убыванию'}
        </Text>
        <View style={styles.sortChips}>
          {(Object.keys(SORT_LABEL) as SortField[]).map((field) => (
            <Pressable
              key={field}
              accessibilityRole="button"
              accessibilityState={{ selected: sortField === field }}
              onPress={() => setSortField(field)}
              style={({ pressed }) => [
                styles.chip,
                sortField === field && styles.chipActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.chipText, sortField === field && styles.chipTextActive]}>
                {SORT_SHORT[field]}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <ProductRow product={item} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={text.heading}>{search ? 'Ничего не нашлось' : 'Каталог пуст'}</Text>
            <Text style={[text.muted, styles.emptyHint]}>
              {search ? 'Попробуйте другое название' : 'Добавьте товар кнопкой + внизу'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const SORT_LABEL: Record<SortField, string> = {
  name: 'По названию',
  sale_price: 'По цене продажи',
  stock: 'По остаткам',
  updated: 'По дате изменения',
};

const SORT_SHORT: Record<SortField, string> = {
  name: 'Название',
  sale_price: 'Цена',
  stock: 'Остаток',
  updated: 'Дата',
};

/** Сортировка в памяти: список уже загружен, повторный запрос к базе не нужен. */
export function sortProducts(
  products: ProductWithStock[],
  field: SortField,
  direction: SortDirection,
): ProductWithStock[] {
  const sign = direction === 'asc' ? 1 : -1;

  return [...products].sort((a, b) => {
    switch (field) {
      case 'sale_price':
        return (a.sale_price - b.sale_price) * sign;
      case 'stock':
        return (a.stock - b.stock) * sign;
      case 'updated':
        return a.created_at.localeCompare(b.created_at) * sign;
      default:
        return a.name.localeCompare(b.name, 'ru') * sign;
    }
  });
}

function ProductRow({ product }: { product: ProductWithStock }) {
  const router = useRouter();
  const open = () =>
    router.push({ pathname: '/product/[id]', params: { id: String(product.id) } });

  return (
    <Pressable
      accessibilityRole="button"
      onPress={open}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
    >
      <View style={styles.thumb}>
        {product.photo_uri ? (
          <Image source={{ uri: product.photo_uri }} style={styles.thumbImage} />
        ) : (
          <Text style={styles.thumbPlaceholder}>📦</Text>
        )}
      </View>

      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={3}>
          {product.name}
        </Text>
        {product.barcode || product.sku ? (
          <Text style={styles.rowCode} numberOfLines={1}>
            {product.barcode ? '▮▮▮ ' : '✳ '}
            {product.barcode ?? product.sku}
          </Text>
        ) : null}
        <View style={styles.rowFooter}>
          <Text style={styles.rowPrice}>{formatMoney(product.sale_price)} руб</Text>
          <Text style={[styles.rowStock, product.stock <= 0 && { color: colors.danger }]}>
            {formatQty(product.stock)} {product.unit}
          </Text>
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Действия с товаром"
        onPress={open}
        hitSlop={8}
        style={styles.rowMore}
      >
        <Text style={styles.rowMoreText}>⋮</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  searchIcon: { fontSize: 18, color: colors.textMuted },
  search: { flex: 1, fontSize: 17, color: colors.text, paddingVertical: spacing.xs },
  sortBar: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  sortChips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  chipTextActive: { color: colors.primaryText },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  thumbPlaceholder: { fontSize: 22, opacity: 0.5 },
  rowBody: { flex: 1, gap: 2 },
  rowName: { fontSize: 17, fontWeight: '600', color: colors.text, lineHeight: 22 },
  rowCode: { fontSize: 13, color: colors.textMuted },
  rowFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 2,
  },
  rowPrice: { fontSize: 16, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  rowStock: { fontSize: 16, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  rowMore: { paddingHorizontal: spacing.xs },
  rowMoreText: { fontSize: 20, color: colors.textMuted },
  empty: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  emptyHint: { textAlign: 'center' },
});
