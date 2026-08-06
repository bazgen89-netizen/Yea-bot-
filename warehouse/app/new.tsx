import { useRouter, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, text } from '../src/ui/theme';

interface Action {
  label: string;
  symbol: string;
  tint: string;
  /**
   * Динамические маршруты задаются объектом, а не строкой: путь
   * `/product/new` сам по себе ни с чем не совпадает — совпадает
   * `product/[id]` с параметром id.
   */
  href?: Href;
  /** Ещё не сделано — кнопка видна, но помечена. */
  soon?: boolean;
}

const SECTIONS: { title: string; items: Action[] }[] = [
  {
    title: 'Документы',
    items: [
      { label: 'Продажа', symbol: '↑', tint: '#1F8A4C', href: '/sale/new' },
      { label: 'Закупка', symbol: '↓', tint: '#1A66FF', href: '/doc/new?type=receipt' },
      { label: 'Возврат продажи', symbol: '↴', tint: '#E5252A', href: '/journal' },
      { label: 'Возврат закупки', symbol: '↥', tint: '#D2691E', soon: true },
      { label: 'Оприходование', symbol: '⤓', tint: '#7B4BC9', soon: true },
      { label: 'Списание', symbol: '⤒', tint: '#7B4BC9', href: '/doc/new?type=writeoff' },
      { label: 'Инвентаризация', symbol: '✳', tint: '#0A37F0', href: '/catalog' },
      { label: 'Перемещение', symbol: '⇄', tint: '#1A66FF', soon: true },
    ],
  },
  {
    title: 'Товары',
    items: [
      { label: 'Товар', symbol: '📦', tint: '#111318', href: { pathname: '/product/[id]', params: { id: 'new' } } },
      { label: 'Услуга', symbol: '🛎', tint: '#111318', soon: true },
      { label: 'Комплект', symbol: '🧩', tint: '#111318', soon: true },
      { label: 'Группа', symbol: '🗂', tint: '#111318', soon: true },
      { label: 'Товар по штрихкоду', symbol: '▮▮▮', tint: '#111318', href: '/scan' },
    ],
  },
  {
    title: 'Прочее',
    items: [
      {
        label: 'Клиент',
        symbol: '🧍',
        tint: '#111318',
        href: { pathname: '/counterparty/[id]', params: { id: 'new', kind: 'customer' } },
      },
      {
        label: 'Поставщик',
        symbol: '🚚',
        tint: '#111318',
        href: { pathname: '/counterparty/[id]', params: { id: 'new', kind: 'supplier' } },
      },
      { label: 'Сотрудник', symbol: '🧑‍💼', tint: '#111318', soon: true },
      { label: 'Магазин', symbol: '🏪', tint: '#111318', soon: true },
      { label: 'Касса', symbol: '🧾', tint: '#111318', soon: true },
    ],
  },
];

/**
 * Шторка создания — то, что открывает круглая кнопка «+» в центре панели.
 * Действия сгруппированы так же, как в привычном пользователю приложении,
 * чтобы не пришлось переучиваться.
 */
export default function CreateSheet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <View style={styles.grabber} />

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={text.title}>{section.title}</Text>

            <View style={styles.grid}>
              {section.items.map((item) => (
                <Pressable
                  key={item.label}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: item.soon }}
                  onPress={() => {
                    if (item.soon || !item.href) return;
                    // Сначала закрываем шторку, иначе она остаётся в стеке
                    // и после возврата с созданного экрана показывается пустой.
                    router.back();
                    router.push(item.href);
                  }}
                  style={({ pressed }) => [
                    styles.tile,
                    item.soon && styles.tileSoon,
                    pressed && !item.soon && { opacity: 0.6 },
                  ]}
                >
                  <Text style={[styles.tileSymbol, { color: item.tint }]}>{item.symbol}</Text>
                  <Text style={styles.tileLabel} numberOfLines={1}>
                    {item.label}
                  </Text>
                  {item.soon ? <Text style={styles.soon}>скоро</Text> : null}
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: spacing.sm,
  },
  content: { padding: spacing.lg, gap: spacing.xl },
  section: { gap: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  tileSoon: { opacity: 0.45 },
  tileSymbol: { fontSize: 17, width: 24, textAlign: 'center' },
  tileLabel: { flex: 1, fontSize: 15, color: colors.text },
  soon: { fontSize: 10, color: colors.textMuted },
});
