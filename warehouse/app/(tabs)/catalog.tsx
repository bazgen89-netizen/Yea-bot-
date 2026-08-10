import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { findByBarcode, listProducts } from '../../src/db/products';
import { formatMoney } from '../../src/domain/money';
import { formatQty } from '../../src/domain/qty';
import { pluralize } from '../../src/domain/plural';
import type { ProductWithStock } from '../../src/domain/types';
import { useCatalogFilters } from '../../src/state/catalogFilters';
import { useDatabase, useQuery } from '../../src/state/DatabaseProvider';
import { useScanner } from '../../src/state/ScannerProvider';
import { AppHeader, HeaderAction } from '../../src/ui/AppHeader';
import { FilterSheet } from '../../src/ui/FilterSheet';
import { Icon } from '../../src/ui/icons';
import { colors, radius, spacing, text } from '../../src/ui/theme';
import { useDesktop } from '../../src/ui/useDesktop';
import { CatalogTable } from '../../src/web/screens/CatalogTable';

export type SortField = 'name' | 'sale_price' | 'stock' | 'updated';
export type SortDirection = 'asc' | 'desc';

const SORT_LABEL: Record<SortField, string> = {
  name: 'Названию',
  sale_price: 'Цене продажи',
  stock: 'Остаткам',
  updated: 'Дате изменения',
};

export default function CatalogScreen() {
  // На широком экране справочник показывается таблицей, как в кабинете.
  const desktop = useDesktop();
  if (desktop) return <CatalogTable />;

  return <CatalogList />;
}

function CatalogList() {
  const router = useRouter();
  const { db } = useDatabase();
  const { scanBarcode } = useScanner();

  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [direction, setDirection] = useState<SortDirection>('asc');
  const [showGroups, setShowGroups] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  const filters = useCatalogFilters();

  const products = useQuery(
    (database) => listProducts(database, { search, presets: filters.presets }),
    [search, filters.presets],
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
        actions={
          <>
            <HeaderAction
              label={filters.active > 0 ? `Фильтр: ${filters.active}` : 'Фильтр'}
              onPress={() => setFilterOpen(true)}
            >
              <Icon.filter color={filters.active > 0 ? '#FFD166' : '#FFFFFF'} size={22} />
            </HeaderAction>
            <HeaderAction label="Сканировать штрихкод" onPress={scanAndOpen}>
              <Icon.scan color="#FFFFFF" size={23} />
            </HeaderAction>
            <HeaderAction label="Вид и сортировка" onPress={() => setMenuOpen(true)}>
              <Icon.more color="#FFFFFF" size={20} />
            </HeaderAction>
          </>
        }
      />

      <View style={styles.searchRow}>
        <Icon.search />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Поиск"
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          clearButtonMode="while-editing"
        />
        <Icon.mic />
      </View>

      {/* Что именно отобрано — иначе короткий список выглядит как пропавшие товары. */}
      {filters.active > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Изменить фильтр"
          onPress={() => setFilterOpen(true)}
          style={styles.filterLine}
        >
          <Text style={styles.filterText} numberOfLines={2}>
            {filters.labels.join(' · ')}
          </Text>
          <Text style={styles.filterReset} onPress={filters.clear}>
            Сбросить
          </Text>
        </Pressable>
      ) : null}

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

      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
      />

      <ViewMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        showGroups={showGroups}
        onToggleGroups={() => setShowGroups((value) => !value)}
        sortField={sortField}
        onSortField={setSortField}
        direction={direction}
        onDirection={setDirection}
      />
    </View>
  );
}

/**
 * Меню «⋯»: показывать группы, поле сортировки и направление.
 * Группа и направление — по одному варианту, как в привычном приложении.
 */
function ViewMenu({
  visible,
  onClose,
  showGroups,
  onToggleGroups,
  sortField,
  onSortField,
  direction,
  onDirection,
}: {
  visible: boolean;
  onClose: () => void;
  showGroups: boolean;
  onToggleGroups: () => void;
  sortField: SortField;
  onSortField: (field: SortField) => void;
  direction: SortDirection;
  onDirection: (value: SortDirection) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Закрыть меню" />

      <View style={styles.sheet}>
        <View style={styles.grabber} />

        <Text style={styles.sheetTitle}>Вид</Text>
        <MenuRow label="Показывать группы" selected={showGroups} onPress={onToggleGroups} />

        <Text style={styles.sheetTitle}>Сортировать по</Text>
        {(Object.keys(SORT_LABEL) as SortField[]).map((field) => (
          <MenuRow
            key={field}
            label={SORT_LABEL[field]}
            selected={sortField === field}
            onPress={() => onSortField(field)}
          />
        ))}

        <Text style={styles.sheetTitle}>Порядок</Text>
        <MenuRow
          label="По возрастанию"
          selected={direction === 'asc'}
          onPress={() => onDirection('asc')}
        />
        <MenuRow
          label="По убыванию"
          selected={direction === 'desc'}
          onPress={() => onDirection('desc')}
        />
      </View>
    </Modal>
  );
}

function MenuRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.menuLabel, selected && { color: colors.accent, fontWeight: '600' }]}>
        {label}
      </Text>
      {selected ? <Icon.check color={colors.accent} /> : null}
    </Pressable>
  );
}

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
          <Icon.box color={colors.textMuted} size={24} />
        )}
      </View>

      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={3}>
          {product.name}
        </Text>

        {product.barcode || product.sku ? (
          <View style={styles.rowCodeLine}>
            {product.barcode ? <Icon.barcode /> : <Icon.asterisk />}
            <Text style={styles.rowCode} numberOfLines={1}>
              {product.barcode ?? product.sku}
            </Text>
          </View>
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
        <Icon.more />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  search: { flex: 1, fontSize: 17, color: colors.text, paddingVertical: spacing.xs },
  filterLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bg,
  },
  filterText: { flex: 1, fontSize: 13, color: colors.textMuted },
  filterReset: { fontSize: 13, color: colors.accent },
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
  rowBody: { flex: 1, gap: 2 },
  rowName: { fontSize: 17, fontWeight: '600', color: colors.text, lineHeight: 22 },
  rowCodeLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
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
  empty: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  emptyHint: { textAlign: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginVertical: spacing.md,
  },
  sheetTitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  menuLabel: { fontSize: 16, color: colors.text },
});
