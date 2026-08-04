import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { findByBarcode, listProducts } from '../../src/db/products';
import { OutOfStockError, createSale } from '../../src/db/sales';
import { discountFromPercent } from '../../src/domain/cart';
import { formatMoney, formatMoneyWithSign, parseMoney } from '../../src/domain/money';
import { formatQty, formatQtyWithUnit, parseQty } from '../../src/domain/qty';
import type { CartLine, PaymentMethod, ProductWithStock } from '../../src/domain/types';
import { useCart } from '../../src/state/CartProvider';
import { useDatabase } from '../../src/state/DatabaseProvider';
import { useScanner } from '../../src/state/ScannerProvider';
import { AppHeader } from '../../src/ui/AppHeader';
import { Badge, Button, Empty, Row } from '../../src/ui/components';
import { colors, radius, spacing, text } from '../../src/ui/theme';

const PAYMENTS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Наличные' },
  { value: 'card', label: 'Карта' },
  { value: 'transfer', label: 'Перевод' },
];

export default function SellScreen() {
  const router = useRouter();
  const { db, refresh } = useDatabase();
  const { scanBarcode } = useScanner();
  const cart = useCart();

  const [payment, setPayment] = useState<PaymentMethod>('cash');
  const [picking, setPicking] = useState(false);

  async function scanIntoCart() {
    const code = await scanBarcode();
    if (!code) return;

    const product = findByBarcode(db, code);
    if (!product) {
      Alert.alert('Товар не найден', `Штрихкод ${code} не привязан ни к одному товару.`);
      return;
    }
    cart.add(product);
  }

  function checkout() {
    try {
      const saleId = createSale(db, {
        lines: cart.lines,
        discount: cart.discount,
        payment,
      });
      cart.clear();
      refresh();
      router.push({ pathname: '/sale/[id]', params: { id: String(saleId) } });
    } catch (error) {
      if (error instanceof OutOfStockError) {
        Alert.alert('Не хватает товара', error.message);
        return;
      }
      Alert.alert('Не удалось провести чек', String(error));
    }
  }

  if (picking) {
    return <ProductPicker onClose={() => setPicking(false)} />;
  }

  return (
    <View style={styles.screen}>
      <AppHeader title="Продажа" subtitle="Оформление чека" />

      <FlatList
        data={cart.lines}
        keyExtractor={(item) => String(item.product_id)}
        renderItem={({ item }) => <CartRow line={item} />}
        ListEmptyComponent={
          <Empty
            title="Чек пуст"
            hint="Отсканируйте штрихкод или выберите товар из списка"
          />
        }
        contentContainerStyle={cart.lines.length === 0 ? styles.emptyList : undefined}
      />

      <View style={styles.panel}>
        <View style={styles.actions}>
          <Button title="Сканировать" onPress={scanIntoCart} style={styles.action} />
          <Button
            title="Выбрать товар"
            variant="secondary"
            onPress={() => setPicking(true)}
            style={styles.action}
          />
        </View>

        {cart.lines.length > 0 ? (
          <>
            <DiscountRow />

            <View style={styles.totals}>
              <TotalRow label="Сумма" value={formatMoneyWithSign(cart.totals.subtotal)} />
              {cart.totals.discount > 0 ? (
                <TotalRow
                  label="Скидка"
                  value={`− ${formatMoneyWithSign(cart.totals.discount)}`}
                />
              ) : null}
              <TotalRow label="К оплате" value={formatMoneyWithSign(cart.totals.total)} big />
              <TotalRow
                label="Прибыль"
                value={formatMoneyWithSign(cart.totals.profit)}
                tone={cart.totals.profit < 0 ? 'danger' : undefined}
              />
            </View>

            <View style={styles.payments}>
              {PAYMENTS.map((option) => (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: payment === option.value }}
                  onPress={() => setPayment(option.value)}
                  style={({ pressed }) => [
                    styles.payment,
                    payment === option.value && styles.paymentActive,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    style={[
                      styles.paymentText,
                      payment === option.value && styles.paymentTextActive,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.actions}>
              <Button
                title="Очистить"
                variant="secondary"
                onPress={cart.clear}
                style={styles.action}
              />
              <Button
                title={`Оплатить ${formatMoney(cart.totals.total)}`}
                onPress={checkout}
                style={styles.action}
              />
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

function CartRow({ line }: { line: CartLine }) {
  const cart = useCart();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(formatQty(line.qty));

  function commit() {
    const parsed = parseQty(draft);
    if (parsed === null) {
      setDraft(formatQty(line.qty));
    } else {
      cart.setQty(line.product_id, parsed);
    }
    setEditing(false);
  }

  const overStock = line.qty > line.stock;

  return (
    <Row
      left={
        <>
          <Text style={text.body} numberOfLines={1}>
            {line.name}
          </Text>
          <Text style={text.muted}>
            {formatMoneyWithSign(line.price)} × {formatQtyWithUnit(line.qty, line.unit)}
          </Text>
          {overStock ? (
            <Badge
              label={`На складе только ${formatQtyWithUnit(line.stock, line.unit)}`}
              tone="danger"
            />
          ) : null}
        </>
      }
      right={
        <>
          <Text style={text.amount}>
            {formatMoneyWithSign(Math.round((line.price * line.qty) / 1000))}
          </Text>

          {editing ? (
            <TextInput
              value={draft}
              onChangeText={setDraft}
              onBlur={commit}
              onSubmitEditing={commit}
              keyboardType="decimal-pad"
              autoFocus
              style={styles.qtyInput}
            />
          ) : (
            <View style={styles.stepper}>
              <StepperButton
                label="−"
                onPress={() => cart.setQty(line.product_id, line.qty - 1000)}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Ввести количество"
                onPress={() => {
                  setDraft(formatQty(line.qty));
                  setEditing(true);
                }}
              >
                <Text style={styles.qtyValue}>{formatQty(line.qty)}</Text>
              </Pressable>
              <StepperButton
                label="+"
                onPress={() => cart.setQty(line.product_id, line.qty + 1000)}
              />
            </View>
          )}
        </>
      }
    />
  );
}

function StepperButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'Добавить' : 'Убавить'}
      onPress={onPress}
      style={({ pressed }) => [styles.stepperButton, pressed && { opacity: 0.6 }]}
    >
      <Text style={styles.stepperText}>{label}</Text>
    </Pressable>
  );
}

function DiscountRow() {
  const cart = useCart();
  const [value, setValue] = useState('');

  function applyAmount() {
    const parsed = parseMoney(value);
    cart.setDiscount(parsed ?? 0);
  }

  function applyPercent(percent: number) {
    cart.setDiscount(discountFromPercent(cart.totals.subtotal, percent));
    setValue('');
  }

  return (
    <View style={styles.discount}>
      <TextInput
        value={value}
        onChangeText={setValue}
        onBlur={applyAmount}
        placeholder="Скидка, ₽"
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
        style={styles.discountInput}
      />
      {[5, 10, 20].map((percent) => (
        <Pressable
          key={percent}
          accessibilityRole="button"
          onPress={() => applyPercent(percent)}
          style={({ pressed }) => [styles.percent, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.percentText}>{percent}%</Text>
        </Pressable>
      ))}
      {cart.discount > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            cart.setDiscount(0);
            setValue('');
          }}
          style={({ pressed }) => [styles.percent, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.percentText}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function TotalRow({
  label,
  value,
  big,
  tone,
}: {
  label: string;
  value: string;
  big?: boolean;
  tone?: 'danger';
}) {
  return (
    <View style={styles.totalRow}>
      <Text style={big ? text.heading : text.muted}>{label}</Text>
      <Text
        style={[
          big ? text.title : text.mono,
          tone === 'danger' && { color: colors.danger },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

/** Выбор товара из списка — альтернатива сканеру, когда штрихкода нет. */
function ProductPicker({ onClose }: { onClose: () => void }) {
  const { db } = useDatabase();
  const cart = useCart();
  const [search, setSearch] = useState('');

  const products = listProducts(db, { search });

  function pick(product: ProductWithStock) {
    if (product.stock <= 0) {
      Alert.alert('Нет на складе', `«${product.name}» закончился. Сначала оформите приход.`);
      return;
    }
    cart.add(product);
    onClose();
  }

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
          <Empty title="Ничего не нашлось" />
        ) : (
          products.map((product) => (
            <Row
              key={product.id}
              onPress={() => pick(product)}
              left={
                <>
                  <Text style={text.body}>{product.name}</Text>
                  <Text style={text.muted}>
                    Остаток {formatQtyWithUnit(product.stock, product.unit)}
                  </Text>
                </>
              }
              right={<Text style={text.amount}>{formatMoneyWithSign(product.sale_price)}</Text>}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  panel: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  totals: { gap: spacing.xs },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  discount: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  discountInput: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.text,
  },
  percent: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  percentText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  payments: { flexDirection: 'row', gap: spacing.sm },
  payment: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentActive: { backgroundColor: colors.primary },
  paymentText: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  paymentTextActive: { color: colors.primaryText },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperText: { fontSize: 20, color: colors.text },
  qtyValue: { fontSize: 16, minWidth: 44, textAlign: 'center', color: colors.text },
  qtyInput: {
    minWidth: 96,
    minHeight: 36,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    textAlign: 'center',
    fontSize: 16,
    color: colors.text,
  },
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
