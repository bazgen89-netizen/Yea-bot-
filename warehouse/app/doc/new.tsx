import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { findByBarcode, listProducts } from '../../src/db/products';
import { postDoc } from '../../src/db/stock';
import { formatMoney, formatMoneyWithSign, parseMoney } from '../../src/domain/money';
import { formatQty, formatQtyWithUnit, lineTotal, parseQty } from '../../src/domain/qty';
import { pluralize } from '../../src/domain/plural';
import type { DocLine, DocType, ProductWithStock } from '../../src/domain/types';
import { useDatabase } from '../../src/state/DatabaseProvider';
import { useScanner } from '../../src/state/ScannerProvider';
import { Button, Card, Empty, Field, Row } from '../../src/ui/components';
import { colors, radius, spacing, text } from '../../src/ui/theme';

export default function NewDocScreen() {
  const router = useRouter();
  const { db, refresh } = useDatabase();
  const { scanBarcode } = useScanner();
  const params = useLocalSearchParams<{ type?: string }>();

  const type: DocType = params.type === 'writeoff' ? 'writeoff' : 'receipt';
  const isReceipt = type === 'receipt';

  const [counterparty, setCounterparty] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DocLine[]>([]);
  const [picking, setPicking] = useState(false);

  function addProduct(product: ProductWithStock) {
    setLines((current) => {
      const index = current.findIndex((l) => l.product_id === product.id);
      if (index !== -1) {
        const next = [...current];
        next[index] = { ...next[index], qty: next[index].qty + 1000 };
        return next;
      }
      return [
        ...current,
        {
          product_id: product.id,
          name: product.name,
          unit: product.unit,
          qty: 1000,
          // Приход по умолчанию — по последней закупочной цене, списание — тоже
          // по закупочной: списывается стоимость, а не выручка.
          price: product.cost_price,
        },
      ];
    });
    setPicking(false);
  }

  async function scanIntoDoc() {
    const code = await scanBarcode();
    if (!code) return;

    const product = findByBarcode(db, code);
    if (!product) {
      Alert.alert('Товар не найден', `Штрихкод ${code} не привязан ни к одному товару.`);
      return;
    }
    addProduct(product);
  }

  function updateLine(productId: number, patch: Partial<DocLine>) {
    setLines((current) =>
      current.map((l) => (l.product_id === productId ? { ...l, ...patch } : l)),
    );
  }

  function removeLine(productId: number) {
    setLines((current) => current.filter((l) => l.product_id !== productId));
  }

  function post() {
    const invalid = lines.find((l) => l.qty <= 0);
    if (invalid) {
      Alert.alert('Проверьте количество', `«${invalid.name}»: количество должно быть больше нуля.`);
      return;
    }

    try {
      postDoc(db, { type, counterparty, note, lines });
      refresh();
      router.back();
    } catch (error) {
      Alert.alert('Не удалось провести документ', String(error));
    }
  }

  const total = lines.reduce((sum, l) => sum + lineTotal(l.price, l.qty), 0);

  if (picking) {
    return <ProductPicker onPick={addProduct} onClose={() => setPicking(false)} />;
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: isReceipt ? 'Приход' : 'Списание' }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card>
          {isReceipt ? (
            <Field
              label="Поставщик"
              value={counterparty}
              onChangeText={setCounterparty}
              placeholder="ООО «Чайный путь»"
            />
          ) : null}
          <Field
            label={isReceipt ? 'Комментарий' : 'Причина списания'}
            value={note}
            onChangeText={setNote}
            placeholder={isReceipt ? 'Накладная №12' : 'Брак, бой, недостача'}
          />
        </Card>

        {lines.length === 0 ? (
          <Empty
            title="Позиций пока нет"
            hint="Отсканируйте штрихкод или выберите товар из списка"
          />
        ) : (
          lines.map((line) => (
            <DocLineRow
              key={line.product_id}
              line={line}
              showPrice={isReceipt}
              onChange={(patch) => updateLine(line.product_id, patch)}
              onRemove={() => removeLine(line.product_id)}
            />
          ))
        )}
      </ScrollView>

      <View style={styles.panel}>
        <View style={styles.actions}>
          <Button title="Сканировать" onPress={scanIntoDoc} style={styles.action} />
          <Button
            title="Выбрать товар"
            variant="secondary"
            onPress={() => setPicking(true)}
            style={styles.action}
          />
        </View>

        {lines.length > 0 ? (
          <>
            <View style={styles.totalRow}>
              <Text style={text.muted}>
                {pluralize(lines.length, 'позиция', 'позиции', 'позиций')}
              </Text>
              <Text style={text.title}>{formatMoneyWithSign(total)}</Text>
            </View>
            <Button title={isReceipt ? 'Оприходовать' : 'Списать'} onPress={post} />
          </>
        ) : null}
      </View>
    </View>
  );
}

function DocLineRow({
  line,
  showPrice,
  onChange,
  onRemove,
}: {
  line: DocLine;
  showPrice: boolean;
  onChange: (patch: Partial<DocLine>) => void;
  onRemove: () => void;
}) {
  const [qty, setQty] = useState(formatQty(line.qty));
  const [price, setPrice] = useState(formatMoney(line.price));

  return (
    <Card style={styles.lineCard}>
      <View style={styles.lineHeader}>
        <Text style={text.heading} numberOfLines={1}>
          {line.name}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Убрать позицию" onPress={onRemove}>
          <Text style={styles.remove}>✕</Text>
        </Pressable>
      </View>

      <View style={styles.lineInputs}>
        <View style={styles.lineInput}>
          <Text style={text.muted}>Количество, {line.unit}</Text>
          <TextInput
            value={qty}
            onChangeText={setQty}
            onBlur={() => {
              const parsed = parseQty(qty);
              if (parsed === null) setQty(formatQty(line.qty));
              else onChange({ qty: parsed });
            }}
            keyboardType="decimal-pad"
            style={styles.input}
          />
        </View>

        {showPrice ? (
          <View style={styles.lineInput}>
            <Text style={text.muted}>Цена закупки</Text>
            <TextInput
              value={price}
              onChangeText={setPrice}
              onBlur={() => {
                const parsed = parseMoney(price);
                if (parsed === null) setPrice(formatMoney(line.price));
                else onChange({ price: parsed });
              }}
              keyboardType="decimal-pad"
              style={styles.input}
            />
          </View>
        ) : null}
      </View>

      <Text style={[text.muted, styles.lineTotal]}>
        Итого: {formatMoneyWithSign(lineTotal(line.price, line.qty))}
      </Text>
    </Card>
  );
}

function ProductPicker({
  onPick,
  onClose,
}: {
  onPick: (product: ProductWithStock) => void;
  onClose: () => void;
}) {
  const { db } = useDatabase();
  const [search, setSearch] = useState('');
  const products = listProducts(db, { search });

  return (
    <View style={styles.screen}>
      <View style={styles.pickerHeader}>
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
          <Empty title="Ничего не нашлось" hint="Товар сначала нужно завести в каталоге" />
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
  content: { padding: spacing.md, gap: spacing.md },
  lineCard: { gap: spacing.sm },
  lineHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  remove: { fontSize: 18, color: colors.textMuted, paddingHorizontal: spacing.sm },
  lineInputs: { flexDirection: 'row', gap: spacing.md },
  lineInput: { flex: 1, gap: spacing.xs },
  lineTotal: { marginTop: spacing.xs },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  panel: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pickerHeader: {
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
