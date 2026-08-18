import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Text, TextInput } from './Translated';
import { applyPrices, setCategoryFor } from '../db/bulk';
import { listCategoryViews } from '../db/categories';
import { formatMoneyWeb, parseMoney } from '../domain/money';
import { repricedTo } from '../domain/pricing';
import type { Id } from '../domain/types';
import type { ProductWithStock } from '../domain/types';
import { useDatabase, useQuery } from '../state/DatabaseProvider';
import { say } from '../ui/alert';
import { web, WEB_FONT } from '../ui/webTheme';

/**
 * Окна из меню «Действия»: цены и категории сразу для списка товаров.
 *
 * Оба показывают, к скольким позициям применятся, и оба пересчитывают на
 * глазах: «плюс 10%» видно на первом товаре списка до того, как нажата
 * кнопка. Действие над шестьюстами карточками должно быть предсказуемым.
 */

export function PricesDialog({
  visible,
  products,
  onClose,
}: {
  visible: boolean;
  products: ProductWithStock[];
  onClose: () => void;
}) {
  const { db, refresh } = useDatabase();

  const [mode, setMode] = useState<'set' | 'percent' | 'amount'>('percent');
  const [value, setValue] = useState('');

  const number = parseValue(mode, value);
  const sample = products[0];
  const preview =
    sample && number !== null
      ? repricedTo(sample.sale_price, { mode, value: number })
      : sample?.sale_price;

  return (
    <Sheet visible={visible} title="Цены и скидки" onClose={onClose}>
      <Text style={styles.note}>Изменится {products.length} поз.</Text>

      <View style={styles.tabs}>
        <Tab label="Задать цену" on={mode === 'set'} onPress={() => setMode('set')} />
        <Tab label="Проценты" on={mode === 'percent'} onPress={() => setMode('percent')} />
        <Tab label="Рубли" on={mode === 'amount'} onPress={() => setMode('amount')} />
      </View>

      <Text style={styles.label}>
        {mode === 'set' ? 'Новая цена' : mode === 'percent' ? 'На сколько процентов' : 'На сколько рублей'}
      </Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder={mode === 'percent' ? '10 или -10' : '100 или -100'}
        style={styles.input}
      />

      {sample ? (
        <Text style={styles.note}>
          Например, «{sample.name}»: {formatMoneyWeb(sample.sale_price)} →{' '}
          {formatMoneyWeb(preview ?? sample.sale_price)}
        </Text>
      ) : null}

      <View style={styles.buttons}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.plain}>
          <Text style={styles.plainLabel}>Отмена</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={number === null}
          onPress={() => {
            if (number === null) return;

            applyPrices(
              db,
              products.map((product) => ({
                id: product.id,
                price: repricedTo(product.sale_price, { mode, value: number }),
              })),
            );
            refresh();
            onClose();
            say('Готово', `Цены изменились у ${products.length} поз.`);
          }}
          style={[styles.green, number === null && styles.greenOff]}
        >
          <Text style={styles.greenLabel}>Применить</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

export function CategoryDialog({
  visible,
  products,
  onClose,
}: {
  visible: boolean;
  products: ProductWithStock[];
  onClose: () => void;
}) {
  const { db, refresh } = useDatabase();
  const categories = useQuery((database) => listCategoryViews(database));
  const [picked, setPicked] = useState<Id | null>(null);

  return (
    <Sheet visible={visible} title="Категории и группы" onClose={onClose}>
      <Text style={styles.note}>Перенесётся {products.length} поз.</Text>

      <View style={styles.list}>
        {categories.map((category) => (
          <Pressable
            key={category.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: picked === category.id }}
            onPress={() => setPicked(category.id)}
            style={[styles.row, picked === category.id && styles.rowOn]}
          >
            <Text style={styles.rowLabel}>{category.name}</Text>
            <Text style={styles.rowCount}>{category.count} поз.</Text>
          </Pressable>
        ))}

        {categories.length === 0 ? (
          <Text style={styles.note}>Категорий пока нет — их заводят в карточке товара.</Text>
        ) : null}
      </View>

      <View style={styles.buttons}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.plain}>
          <Text style={styles.plainLabel}>Отмена</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={picked === null}
          onPress={() => {
            if (picked === null) return;

            setCategoryFor(
              db,
              products.map((product) => product.id),
              picked,
            );
            refresh();
            onClose();
            say('Готово', `${products.length} поз. перенесены в категорию.`);
          }}
          style={[styles.green, picked === null && styles.greenOff]}
        >
          <Text style={styles.greenLabel}>Перенести</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

/** Разбор введённого: проценты и рубли — со знаком, цена — без. */
function parseValue(mode: 'set' | 'percent' | 'amount', input: string): number | null {
  const text = input.trim().replace(',', '.');
  if (!text) return null;

  if (mode === 'percent') {
    const percent = Number(text);
    if (!Number.isFinite(percent)) return null;
    // Проценты — в сотых долях процента, как и везде в расчётах.
    return Math.round(percent * 100);
  }

  const negative = text.startsWith('-');
  const money = parseMoney(negative ? text.slice(1) : text);
  if (money === null) return null;

  return negative ? -money : money;
}

function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.shade}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть окно"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function Tab({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.tab, on && styles.tabOn]}
    >
      <Text style={[styles.tabLabel, on && styles.tabLabelOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shade: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    width: 460,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    padding: 24,
    gap: 12,
  },
  title: { fontFamily: WEB_FONT, fontSize: 20, color: web.text },
  note: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },
  label: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },

  tabs: { flexDirection: 'row', gap: 8 },
  tab: {
    paddingHorizontal: 14,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D4D4D5',
    borderRadius: 4,
  },
  tabOn: { borderColor: '#2185D0', backgroundColor: '#EAF3FC' },
  tabLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  tabLabelOn: { color: '#2185D0' },

  input: {
    height: 38,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#D4D4D5',
    borderRadius: 4,
    fontFamily: WEB_FONT,
    fontSize: 15,
    color: web.text,
    outlineWidth: 0,
  },

  list: { maxHeight: 320, gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 4,
  },
  rowOn: { backgroundColor: '#EAF3FC' },
  rowLabel: { flex: 1, fontFamily: WEB_FONT, fontSize: 15, color: web.text },
  rowCount: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },

  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  plain: {
    paddingHorizontal: 18,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D4D4D5',
    borderRadius: 4,
  },
  plainLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  green: {
    paddingHorizontal: 18,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: '#21BA45',
  },
  greenOff: { opacity: 0.5 },
  greenLabel: { fontFamily: WEB_FONT, fontSize: 14, color: '#FFFFFF' },
});
