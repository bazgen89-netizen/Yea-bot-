import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatMoneyWithSign } from '../../src/domain/money';
import { formatQtyWithUnit } from '../../src/domain/qty';
import type { ProductWithStock } from '../../src/domain/types';
import { findByBarcode, listProducts } from '../../src/db/products';
import { useDatabase, useQuery } from '../../src/state/DatabaseProvider';
import { useScanner } from '../../src/state/ScannerProvider';
import { Badge, Button, Empty, Row } from '../../src/ui/components';
import { colors, radius, spacing, text } from '../../src/ui/theme';

export default function ProductsScreen() {
  const router = useRouter();
  const { db } = useDatabase();
  const { scanBarcode } = useScanner();
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  async function scanAndOpen() {
    const code = await scanBarcode();
    if (!code) return;

    const found = findByBarcode(db, code);
    if (found) {
      router.push({ pathname: '/product/[id]', params: { id: String(found.id) } });
    } else {
      // Неизвестный код — сразу открываем создание товара с уже заполненным
      // штрихкодом. Тупик «товар не найден» тут никому не помогает.
      router.push({ pathname: '/product/[id]', params: { id: 'new', barcode: code } });
    }
  }

  const products = useQuery(
    (database) => listProducts(database, { search, lowStockOnly }),
    [search, lowStockOnly],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Название, артикул или штрихкод"
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          clearButtonMode="while-editing"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Сканировать штрихкод"
          onPress={scanAndOpen}
          style={({ pressed }) => [styles.scanButton, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.scanIcon}>⌗</Text>
        </Pressable>
      </View>

      <View style={styles.filters}>
        <FilterChip
          label="Все товары"
          active={!lowStockOnly}
          onPress={() => setLowStockOnly(false)}
        />
        <FilterChip
          label="Заканчиваются"
          active={lowStockOnly}
          onPress={() => setLowStockOnly(true)}
        />
      </View>

      <FlatList
        data={products}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <ProductRow product={item} />}
        ListEmptyComponent={
          <Empty
            title={search ? 'Ничего не нашлось' : 'Товаров пока нет'}
            hint={
              search
                ? 'Попробуйте другое название или отсканируйте штрихкод'
                : 'Добавьте первый товар кнопкой ниже'
            }
          />
        }
        contentContainerStyle={products.length === 0 ? styles.emptyList : undefined}
      />

      <View style={styles.footer}>
        <Button
          title="Добавить товар"
          onPress={() => router.push({ pathname: '/product/[id]', params: { id: 'new' } })}
        />
      </View>
    </View>
  );
}

function ProductRow({ product }: { product: ProductWithStock }) {
  const router = useRouter();
  const isLow = product.min_qty > 0 && product.stock <= product.min_qty;
  const isOut = product.stock <= 0;

  return (
    <Row
      onPress={() =>
        router.push({ pathname: '/product/[id]', params: { id: String(product.id) } })
      }
      left={
        <>
          <Text style={text.body} numberOfLines={1}>
            {product.name}
          </Text>
          <Text style={text.muted} numberOfLines={1}>
            {product.category_name ?? 'Без категории'}
            {product.sku ? ` · ${product.sku}` : ''}
          </Text>
        </>
      }
      right={
        <>
          <Text style={text.amount}>{formatMoneyWithSign(product.sale_price)}</Text>
          {isOut ? (
            <Badge label="Нет в наличии" tone="danger" />
          ) : isLow ? (
            <Badge label={`Мало · ${formatQtyWithUnit(product.stock, product.unit)}`} tone="warning" />
          ) : (
            <Text style={text.muted}>{formatQtyWithUnit(product.stock, product.unit)}</Text>
          )}
        </>
      }
    />
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { opacity: 0.7 }]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  toolbar: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  search: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  scanButton: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanIcon: { fontSize: 22, color: colors.primaryText, fontWeight: '700' },
  filters: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.bg,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  chipTextActive: { color: colors.primaryText },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  footer: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
