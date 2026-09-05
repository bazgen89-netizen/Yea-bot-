import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { listLocations } from '../../src/db/locations';
import { findByBarcode, listProducts } from '../../src/db/products';
import { postAdjustment, postInventory, stockAt } from '../../src/db/stock';
import { formatMoneyWithSign } from '../../src/domain/money';
import { formatQty, formatQtyWithUnit, lineTotal, parseQty } from '../../src/domain/qty';
import { pluralize } from '../../src/domain/plural';
import type { Id, ProductWithStock } from '../../src/domain/types';
import { useDatabase, useQuery } from '../../src/state/DatabaseProvider';
import { useScanner } from '../../src/state/ScannerProvider';
import { Button, Card, Choice, Empty, Field } from '../../src/ui/components';
import { ProductPicker } from '../../src/ui/ProductPicker';
import { colors, radius, spacing, text } from '../../src/ui/theme';
import { confirm, say } from '../../src/ui/alert';

/**
 * Инвентаризация и корректировка.
 *
 * Отдельно от остальных документов потому, что в них называют не количество
 * товара, а то, что с ним стало: в инвентаризации — сколько нашли на полке,
 * и разницу считает программа; в корректировке — саму разницу. Ни один
 * из этих экранов не сводится к «выбери товар и укажи сколько».
 *
 * До этого пересчёт делался в карточке товара по одной позиции, и ведомости
 * после него не оставалось.
 */

type Mode = 'inventory' | 'adjustment';

interface CountRow {
  product_id: Id;
  name: string;
  unit: string;
  /** Остаток по программе на момент открытия ведомости, тысячные. */
  expected: number;
  /** Инвентаризация — факт; корректировка — величина правки. Тысячные. */
  entered: number;
  /** Себестоимость, копейки: по ней оценивается расхождение. */
  price: number;
}

export default function CountScreen() {
  const router = useRouter();
  const { db, refresh } = useDatabase();
  const { scanBarcode } = useScanner();
  const params = useLocalSearchParams<{ kind?: string }>();

  const mode: Mode = params.kind === 'adjustment' ? 'adjustment' : 'inventory';
  const inventory = mode === 'inventory';

  const locations = useQuery((database) => listLocations(database));
  const shops = locations.map((location) => ({ value: location.id, label: location.name }));

  const [picked, setPicked] = useState<Id | null>(null);
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<CountRow[]>([]);
  const [picking, setPicking] = useState(false);

  const shop = picked ?? shops[0]?.value ?? null;

  function rowFor(product: ProductWithStock): CountRow {
    return {
      product_id: product.id,
      name: product.name,
      unit: product.unit,
      // Остаток берётся по магазину пересчёта, а не общий: считают полку
      // конкретной точки, и сравнение с суммой по всем точкам списало бы
      // чужой товар.
      expected: stockAt(db, product.id, shop),
      entered: inventory ? stockAt(db, product.id, shop) : 0,
      price: product.cost_price,
    };
  }

  function add(product: ProductWithStock) {
    setRows((current) =>
      current.some((row) => row.product_id === product.id)
        ? current
        : [...current, rowFor(product)],
    );
    setPicking(false);
  }

  /** Вся полка сразу: ведомость пересчёта обычно начинается с неё. */
  function fillFromStock() {
    const products = listProducts(db).filter((product) => product.kind !== 'service');
    setRows(products.map(rowFor));
  }

  async function scanIntoSheet() {
    const code = await scanBarcode();
    if (!code) return;

    const product = findByBarcode(db, code);
    if (!product) {
      say('Товар не найден', `Штрихкод ${code} не привязан ни к одному товару.`);
      return;
    }
    add(product);
  }

  function post() {
    if (rows.length === 0) return;

    const changed = rows.filter((row) => delta(row, inventory) !== 0);
    if (changed.length === 0) {
      say(
        'Расхождений нет',
        'Всё сошлось с программой — проводить нечего. Документ не нужен.',
      );
      return;
    }

    confirm(
      inventory ? 'Провести инвентаризацию?' : 'Провести корректировку?',
      `Остаток изменится у ${pluralize(changed.length, 'позиции', 'позиций', 'позиций')}. ` +
        `Разница на ${formatMoneyWithSign(discrepancy(rows, inventory))}.`,
      'Провести',
      () => {
        try {
          if (inventory) {
            postInventory(db, {
              locationId: shop,
              note,
              lines: rows.map((row) => ({
                product_id: row.product_id,
                name: row.name,
                unit: row.unit,
                actual: row.entered,
                price: row.price,
              })),
            });
          } else {
            postAdjustment(db, {
              locationId: shop,
              note,
              lines: rows.map((row) => ({
                product_id: row.product_id,
                name: row.name,
                unit: row.unit,
                delta: row.entered,
                price: row.price,
              })),
            });
          }
          refresh();
          router.back();
        } catch (error) {
          say('Не удалось провести документ', String(error));
        }
      },
    );
  }

  if (picking) {
    return <ProductPicker onPick={add} onClose={() => setPicking(false)} />;
  }

  const title = inventory ? 'Инвентаризация' : 'Корректировка';
  const total = discrepancy(rows, inventory);

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card>
          {shops.length > 1 ? (
            <Choice
              label="Магазин"
              value={shop}
              options={shops}
              onChange={(value) => {
                setPicked(value);
                // Остатки в ведомости взяты у прежнего магазина — в новом они
                // другие, и оставлять их значило бы списать разницу между
                // точками как недостачу.
                setRows([]);
              }}
            />
          ) : null}

          <Field
            label={inventory ? 'Комментарий' : 'Причина корректировки'}
            value={note}
            onChangeText={setNote}
            placeholder={inventory ? 'Ревизия за август' : 'Пересорт, бой'}
          />

          {inventory ? (
            <Button title="Заполнить складом" variant="secondary" onPress={fillFromStock} />
          ) : null}
        </Card>

        {rows.length === 0 ? (
          <Empty
            title="Ведомость пуста"
            hint={
              inventory
                ? 'Заполните складом или добавьте позиции по одной'
                : 'Добавьте товары, остаток которых нужно поправить'
            }
          />
        ) : (
          rows.map((row) => (
            <CountRowCard
              key={row.product_id}
              row={row}
              inventory={inventory}
              onChange={(entered) =>
                setRows((current) =>
                  current.map((item) =>
                    item.product_id === row.product_id ? { ...item, entered } : item,
                  ),
                )
              }
              onRemove={() =>
                setRows((current) =>
                  current.filter((item) => item.product_id !== row.product_id),
                )
              }
            />
          ))
        )}
      </ScrollView>

      <View style={styles.panel}>
        <View style={styles.actions}>
          <Button title="Сканировать" onPress={scanIntoSheet} style={styles.action} />
          <Button
            title="Выбрать товар"
            variant="secondary"
            onPress={() => setPicking(true)}
            style={styles.action}
          />
        </View>

        {rows.length > 0 ? (
          <>
            <View style={styles.totalRow}>
              <Text style={text.muted}>
                {pluralize(rows.length, 'позиция', 'позиции', 'позиций')} ·{' '}
                {pluralize(
                  rows.filter((row) => delta(row, inventory) !== 0).length,
                  'расхождение',
                  'расхождения',
                  'расхождений',
                )}
              </Text>
              <Text style={[text.title, total < 0 && { color: colors.danger }]}>
                {formatMoneyWithSign(total)}
              </Text>
            </View>
            <Button title="Провести" onPress={post} />
          </>
        ) : null}
      </View>
    </View>
  );
}

/** На сколько изменится остаток по этой строке. */
function delta(row: CountRow, inventory: boolean): number {
  return inventory ? row.entered - row.expected : row.entered;
}

/** Во сколько обходится расхождение по всей ведомости, копейки. */
function discrepancy(rows: CountRow[], inventory: boolean): number {
  return rows.reduce((sum, row) => sum + lineTotal(row.price, delta(row, inventory)), 0);
}

function CountRowCard({
  row,
  inventory,
  onChange,
  onRemove,
}: {
  row: CountRow;
  inventory: boolean;
  onChange: (entered: number) => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState(formatQty(row.entered));
  const difference = delta(row, inventory);

  return (
    <Card style={styles.rowCard}>
      <View style={styles.rowHeader}>
        <Text style={text.heading} numberOfLines={1}>
          {row.name}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Убрать позицию" onPress={onRemove}>
          <Text style={styles.remove}>✕</Text>
        </Pressable>
      </View>

      <View style={styles.rowInputs}>
        <View style={styles.rowCell}>
          <Text style={text.muted}>По программе</Text>
          <Text style={text.body}>{formatQtyWithUnit(row.expected, row.unit)}</Text>
        </View>

        <View style={styles.rowCell}>
          <Text style={text.muted}>
            {inventory ? `Факт, ${row.unit}` : `Изменить на, ${row.unit}`}
          </Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            onBlur={() => {
              const parsed = parseQty(value);
              if (parsed === null) setValue(formatQty(row.entered));
              else onChange(parsed);
            }}
            keyboardType={inventory ? 'decimal-pad' : 'numbers-and-punctuation'}
            style={styles.input}
          />
        </View>
      </View>

      <Text
        style={[
          text.muted,
          styles.difference,
          difference < 0 && { color: colors.danger },
          difference > 0 && { color: colors.primary },
        ]}
      >
        {difference === 0
          ? 'Сошлось'
          : `${difference > 0 ? 'Излишек' : 'Недостача'} ${formatQtyWithUnit(
              Math.abs(difference),
              row.unit,
            )} · ${formatMoneyWithSign(lineTotal(row.price, difference))}`}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, maxWidth: 900, width: '100%' },
  rowCard: { gap: spacing.sm },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  remove: { fontSize: 18, color: colors.textMuted, paddingHorizontal: spacing.sm },
  rowInputs: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-end' },
  rowCell: { flex: 1, gap: spacing.xs },
  difference: { marginTop: spacing.xs },
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
});
