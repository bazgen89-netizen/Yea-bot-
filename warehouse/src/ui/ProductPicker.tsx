import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { listProducts } from '../db/products';
import { formatMoneyWithSign } from '../domain/money';
import { formatQtyWithUnit } from '../domain/qty';
import type { ProductWithStock } from '../domain/types';
import { useDatabase } from '../state/DatabaseProvider';
import { Button, Empty, Row } from './components';
import { colors, radius, spacing, text } from './theme';

/**
 * Выбор товара из каталога — общий для всех документов.
 *
 * Лежит отдельно от экранов потому, что экранов, куда добавляют позиции,
 * уже три: закупка, инвентаризация, корректировка. Своя копия у каждого
 * означала бы три разных поиска по одному и тому же каталогу.
 */
export function ProductPicker({
  onPick,
  onClose,
  hint,
}: {
  onPick: (product: ProductWithStock) => void;
  onClose: () => void;
  hint?: string;
}) {
  const { db } = useDatabase();
  const [search, setSearch] = useState('');
  const products = listProducts(db, { search });

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Поиск товара"
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          autoFocus
        />
        <Button title="Отмена" variant="secondary" onPress={onClose} />
      </View>

      <ScrollView keyboardShouldPersistTaps="handled">
        {products.length === 0 ? (
          <Empty
            title="Ничего не нашлось"
            hint={hint ?? 'Товар сначала нужно завести в каталоге'}
          />
        ) : (
          products.map((product) => (
            <Row
              key={product.id}
              onPress={() => onPick(product)}
              left={
                <>
                  <Text style={text.body}>{product.name}</Text>
                  <Text style={text.muted}>
                    Остаток {formatQtyWithUnit(product.stock, product.unit)}
                  </Text>
                </>
              }
              right={<Text style={text.amount}>{formatMoneyWithSign(product.cost_price)}</Text>}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
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
});
