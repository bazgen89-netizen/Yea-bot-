import { useRouter, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DOC_TYPES } from '../src/domain/docTypes';
import { colors, radius, spacing, text } from '../src/ui/theme';

/**
 * «Создать документ» — то, что открывает синяя кнопка над меню кабинета
 * и круглая «+» в панели телефона.
 *
 * Состав и порядок — как в исходном приложении: восемь складских документов,
 * разделитель, и три денежных под заголовком «Деньги». Ничего не помечено
 * «скоро»: пункт, который не работает, здесь не нужен — либо документ
 * заводится, либо его нет в списке.
 */

interface Action {
  label: string;
  symbol: string;
  tint: string;
  /**
   * Динамические маршруты задаются объектом, а не строкой: путь
   * `/product/new` сам по себе ни с чем не совпадает — совпадает
   * `product/[id]` с параметром id.
   */
  href: Href;
}

/**
 * Девять документов — те же и в том же порядке, что у него.
 *
 * Цвета взяты из его таблицы видов, а не подобраны: тем же цветом покрашена
 * полоска строки в журнале, и по нему документ узнают, не читая названия.
 * «Продажа» и «Возврат продажи» ведут в форму документа, а не на кассу:
 * документом продают по накладной, чеком — на кассе, и это разные вещи.
 */
const DOCUMENTS: Action[] = [
  { label: 'Продажа', symbol: '↑', tint: DOC_TYPES.sale.color, href: '/doc/new?kind=sale' },
  { label: 'Закупка', symbol: '↓', tint: DOC_TYPES.purchase.color, href: '/doc/new?kind=purchase' },
  {
    label: 'Возврат продажи',
    symbol: '↴',
    tint: DOC_TYPES.sale_return.color,
    href: '/doc/new?kind=sale_return',
  },
  {
    label: 'Возврат закупки',
    symbol: '↥',
    tint: DOC_TYPES.purchase_return.color,
    href: '/doc/new?kind=purchase_return',
  },
  {
    label: 'Корректировка',
    symbol: '≠',
    tint: DOC_TYPES.adjustment.color,
    href: '/doc/count?kind=adjustment',
  },
  {
    label: 'Инвентаризация',
    symbol: '✳',
    tint: DOC_TYPES.inventory.color,
    href: '/doc/count?kind=inventory',
  },
  {
    label: 'Оприходование',
    symbol: '⤓',
    tint: DOC_TYPES.stock_in.color,
    href: '/doc/new?kind=stock_in',
  },
  { label: 'Списание', symbol: '⤒', tint: DOC_TYPES.writeoff.color, href: '/doc/new?kind=writeoff' },
  {
    label: 'Перемещение',
    symbol: '⇄',
    tint: DOC_TYPES.transfer.color,
    href: '/doc/new?kind=transfer',
  },
];

const MONEY: Action[] = [
  { label: 'Приход', symbol: '+', tint: '#1F8A4C', href: '/money/new?type=income' },
  { label: 'Расход', symbol: '−', tint: '#E5252A', href: '/money/new?type=expense' },
  { label: 'Перевод', symbol: '⇄', tint: '#1A66FF', href: '/money/new?type=transfer' },
];

/**
 * Карточки товаров и контрагентов заводятся не отсюда — в исходном приложении
 * их создают со своих экранов. Но кнопка «+» на телефоне была единственным
 * способом добраться до новой карточки, поэтому они остаются отдельным блоком
 * внизу, а не подмешиваются к документам.
 */
const CARDS: Action[] = [
  {
    label: 'Товар',
    symbol: '📦',
    tint: '#111318',
    href: { pathname: '/product/[id]', params: { id: 'new' } },
  },
  { label: 'Товар по штрихкоду', symbol: '▮▮▮', tint: '#111318', href: '/scan' },
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
];

export default function CreateSheet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const open = (href: Href) => {
    // Сначала закрываем шторку, иначе она остаётся в стеке и после возврата
    // с созданного экрана показывается пустой.
    router.back();
    router.push(href);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.grabberRow}>
        <View style={styles.grabber} />
        {/* Свайпом шторка закрывается только на телефоне — в браузере нужен крестик. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть"
          hitSlop={12}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.closeSign}>✕</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <Grid items={DOCUMENTS} onPick={open} />

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={text.title}>Деньги</Text>
          <Grid items={MONEY} onPick={open} />
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={text.title}>Карточки</Text>
          <Grid items={CARDS} onPick={open} />
        </View>
      </ScrollView>
    </View>
  );
}

function Grid({ items, onPick }: { items: Action[]; onPick: (href: Href) => void }) {
  return (
    <View style={styles.grid}>
      {items.map((item) => (
        <Pressable
          key={item.label}
          accessibilityRole="button"
          onPress={() => onPick(item.href)}
          style={({ pressed }) => [styles.tile, pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.tileSymbol, { color: item.tint }]}>{item.symbol}</Text>
          <Text style={styles.tileLabel} numberOfLines={1}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  grabberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  close: { position: 'absolute', right: spacing.lg, padding: spacing.xs },
  closeSign: { fontSize: 20, color: colors.textMuted },
  content: { padding: spacing.lg, gap: spacing.lg },
  section: { gap: spacing.md },
  divider: { height: 1, backgroundColor: colors.border },
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
  tileSymbol: { fontSize: 17, width: 24, textAlign: 'center' },
  tileLabel: { flex: 1, fontSize: 15, color: colors.text },
});
