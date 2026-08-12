import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { CashierMenu } from './CashierMenu';
import { CashierPayment } from './CashierPayment';
import { CashierPanel, VIEW_TITLE, type CashierView } from './CashierViews';
import { listLocations } from '../../db/locations';
import { listProducts } from '../../db/products';
import { createSale, OutOfStockError } from '../../db/sales';
import { listRegisters, openShift, openShiftAnywhere } from '../../db/shifts';
import { formatMoneyWeb } from '../../domain/money';
import { formatQty } from '../../domain/qty';
import type { Id, PaymentMethod, ProductWithStock } from '../../domain/types';
import { useCart } from '../../state/CartProvider';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { say } from '../../ui/alert';
import { Icon, WebIcon } from '../../ui/icons';
import { pos } from '../../ui/webTheme';

/**
 * Интерфейс кассира.
 *
 * Отдельный экран во весь экран: у него своя палитра и свой шрифт — в исходном
 * приложении это вообще другое приложение, собранное на Material, а не на том
 * же, что кабинет. Слева витрина плитками, справа чек, внизу полоса продажи.
 */
export function Cashier() {
  const { db, refresh } = useDatabase();
  const cart = useCart();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Id | null>(null);
  const [menu, setMenu] = useState(false);
  const [paying, setPaying] = useState(false);
  // Открытый раздел кассы. 'sale' — сама продажа, всё остальное рисуется
  // поверх неё, не уводя с экрана кассы.
  const [view, setView] = useState<CashierView>('sale');

  const products = useQuery((database) => listProducts(database, { search }), [search]);
  const locations = useQuery((database) => listLocations(database));
  const shift = useQuery((database) => openShiftAnywhere(database));
  const registers = useQuery((database) => listRegisters(database));
  const shop = locations[0]?.name ?? 'Магазин';

  /**
   * Открыть смену прямо из кассы.
   *
   * Кассу открывают на свободной кассе — той, где смены ещё нет. Если все
   * заняты, значит смена уже идёт где-то ещё, и об этом надо сказать, а не
   * молча ничего не сделать.
   */
  function openShiftNow() {
    const free = registers.find((register) => register.open_shift_id === null);
    if (!free) {
      say('Нет свободной кассы', 'Смена уже открыта на другой кассе.');
      return;
    }

    openShift(db, { registerId: free.id, cashier: 'waystea' });
    refresh();
  }

  /**
   * Нажали «ПРОДАЖА».
   *
   * Раньше здесь чек проводился сразу и молча: способ оплаты был всегда
   * наличными, сдача не считалась, а на любой ошибке — не открыта смена, не
   * хватает остатка — исключение уходило в пустоту, и со стороны это выглядело
   * так, будто касса «не поняла» и сбросила чек.
   */
  const startPay = () => {
    if (cart.lines.length === 0) {
      say('Чек пуст', 'Выберите товары на витрине.');
      return;
    }

    // Смена — первое, что проверяем: чек без смены некуда положить, и её
    // отсутствие надо назвать, а не молчать.
    if (!shift) {
      say(
        'Смена закрыта',
        'Чтобы продавать, откройте смену: «Меню» слева внизу → «Открыть смену».',
      );
      return;
    }

    setPaying(true);
  };

  const pay = (payment: PaymentMethod, tendered: number): void => {
    try {
      createSale(db, {
        discount: cart.discount,
        payment,
        lines: cart.lines,
        locationId: locations[0]?.id ?? null,
      });
    } catch (error) {
      setPaying(false);

      // Не хватает остатка — говорим, чего именно и сколько: кассир должен
      // понять, какой товар убрать из чека, а не гадать.
      if (error instanceof OutOfStockError) {
        say(
          'Не хватает остатка',
          error.details
            .map(
              (issue) =>
                `${issue.name}: в чеке ${formatQty(issue.requested)}, на складе ${formatQty(issue.available)}`,
            )
            .join('\n'),
        );
        return;
      }

      say('Чек не проведён', String(error));
      return;
    }

    const rest = payment === 'cash' ? tendered - cart.totals.total : 0;

    cart.clear();
    setSelected(null);
    setPaying(false);
    refresh();

    if (rest > 0) say('Чек пробит', `Сдача ${formatMoneyWeb(rest)} руб.`);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.body}>
        {/* Витрина */}
        <View style={styles.left}>
          <View style={styles.searchBar}>
            <View style={styles.gridButton}>
              <WebIcon.home size={22} color="#FFFFFF" />
            </View>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Поиск по наименованию, артикулу, штрихкоду, коду и описанию"
              placeholderTextColor="#8E8E93"
              style={styles.searchInput}
            />
            <View style={styles.keyHint}>
              <Text style={styles.keyHintText}>F</Text>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.tiles}>
            {products.map((product) => (
              <Tile
                key={product.id}
                product={product}
                selected={selected === product.id}
                onPress={() => {
                  // Остаток проверяется при нажатии, а не при оплате: узнать,
                  // что товара нет, кассир должен сразу, а не после того, как
                  // назвал покупателю сумму.
                  if (product.kind !== 'service' && product.stock <= 0) {
                    say(
                      'Товара нет на остатке',
                      `«${product.name}» — остаток ${formatQty(product.stock)} ${product.unit}. ` +
                        'Оприходуйте товар или проведите инвентаризацию.',
                    );
                    return;
                  }

                  const inCart = cart.lines.find((line) => line.product_id === product.id);
                  if (product.kind !== 'service' && (inCart?.qty ?? 0) + 1000 > product.stock) {
                    say(
                      'Больше нет',
                      `«${product.name}»: на складе ${formatQty(product.stock)} ${product.unit}, ` +
                        'столько уже в чеке.',
                    );
                    return;
                  }

                  setSelected(product.id);
                  cart.add(product, 1000);
                }}
              />
            ))}
          </ScrollView>
        </View>

        {/* Чек */}
        <View style={styles.right}>
          <View style={styles.customerBar}>
            <WebIcon.funnel size={19} color="#8E8E93" />
            <Text style={styles.customerName}>Розничный покупатель</Text>
            <View style={styles.keyHint}>
              <Text style={styles.keyHintText}>C</Text>
            </View>
            {/* Клиенты открываются внутри кассы, а не в кабинете: раньше эта
                кнопка уводила на карточку контрагента, и кассир оказывался
                вне кассы с недобитым чеком. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Клиенты"
              onPress={() => setView('clients')}
              style={styles.addCustomer}
            >
              <WebIcon.parties size={22} color="#FFFFFF" />
            </Pressable>
          </View>

          <View style={styles.recommendRow}>
            <Text style={styles.recommendLabel}>Рекомендации</Text>
            <WebIcon.gear size={18} color="#8E8E93" />
          </View>

          {/* Пока смена закрыта, продавать нечего — и вместо пустого чека
              справа стоит предложение её открыть. У него для этого отдельный
              экран, на который касса сама уводит: продажа без смены не имеет
              смысла, и узнать об этом кассир должен до того, как набрал чек. */}
          {!shift ? (
            <View style={styles.emptyReceipt}>
              <WebIcon.lockClosed size={54} color="#C7C7CC" />
              <Text style={styles.shiftClosedTitle}>Смена закрыта</Text>
              <Text style={styles.shiftClosedNote}>
                Чтобы продавать, откройте смену. Чеки будут копиться в ней, пока её не закроют.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={openShiftNow}
                style={({ pressed }) => [styles.openShift, pressed && { opacity: 0.9 }]}
              >
                <Text style={styles.openShiftLabel}>Открыть смену</Text>
              </Pressable>
            </View>
          ) : cart.lines.length === 0 ? (
            <View style={styles.emptyReceipt}>
              <Text style={styles.emptyReceiptText}>Выберите товары</Text>
            </View>
          ) : (
            <ScrollView style={styles.receipt}>
              {cart.lines.map((line) => (
                <View key={line.product_id} style={styles.receiptRow}>
                  <View style={styles.receiptBody}>
                    <Text style={styles.receiptName} numberOfLines={2}>
                      {line.name}
                    </Text>
                    <Text style={styles.receiptQty}>
                      {formatQty(line.qty)} {line.unit} × {formatMoneyWeb(line.price)}
                    </Text>
                  </View>
                  <Text style={styles.receiptSum}>
                    {formatMoneyWeb(Math.round((line.price * line.qty) / 1000))}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Убрать из чека"
                    onPress={() => cart.remove(line.product_id)}
                    hitSlop={8}
                  >
                    <Text style={styles.receiptRemove}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>

      {/* Нижняя полоса */}
      <View style={styles.bottom}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Меню"
          onPress={() => setMenu(true)}
          style={styles.bottomMenu}
        >
          <Icon.menu size={24} color={pos.text} />
          <Text style={styles.bottomMenuLabel}>Меню</Text>
        </Pressable>

        <Text style={styles.bottomShop} numberOfLines={1}>
          {shop} / {shift ? `Смена #${shift.id}` : 'Смена закрыта'}
        </Text>

        <Text style={styles.bottomClock}>{today()}</Text>

        <Pressable
          accessibilityRole="button"
          onPress={startPay}
          style={({ pressed }) => [styles.sellBar, pressed && { opacity: 0.9 }]}
        >
          <Text style={styles.sellDots}>⋮</Text>
          <Text style={styles.sellLabel}>ПРОДАЖА</Text>
          <Text style={styles.sellTotal}>{formatMoneyWeb(cart.totals.total)} руб</Text>
        </Pressable>
      </View>

      <CashierPayment
        visible={paying}
        total={cart.totals.total}
        onClose={() => setPaying(false)}
        onPay={pay}
      />

      <CashierMenu visible={menu} onClose={() => setMenu(false)} onOpenView={setView} />

      {view !== 'sale' ? (
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Назад к продаже"
              onPress={() => setView('sale')}
              style={styles.panelBack}
            >
              <Text style={styles.panelBackLabel}>‹</Text>
            </Pressable>
            <Text style={styles.panelTitle}>{VIEW_TITLE[view]}</Text>
          </View>
          <CashierPanel view={view} />
        </View>
      ) : null}
    </View>
  );
}

function Tile({
  product,
  selected,
  onPress,
}: {
  product: ProductWithStock;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.tile, selected && styles.tileSelected]}
    >
      <Text style={styles.tileStock}>
        {formatQty(product.stock)} {product.unit}
      </Text>

      <View style={styles.tileImage}>
        {product.photo_uri ? (
          <Image source={{ uri: product.photo_uri }} style={styles.tilePhoto} />
        ) : (
          <WebIcon.home size={34} color="#C7C7CC" />
        )}
      </View>

      <Text style={styles.tileName} numberOfLines={2}>
        {product.name}
      </Text>
      <Text style={styles.tileСode}>{product.sku ?? ''}</Text>

      <View style={styles.tilePriceRow}>
        <Text style={styles.tilePrice}>{formatMoneyWeb(product.sale_price)} руб</Text>
      </View>
    </Pressable>
  );
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** «8 августа, суббота 11:41» — как в нижней полосе исходного приложения. */
function today(now = new Date()): string {
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return `${now.getDate()} ${MONTHS[now.getMonth()]}, ${WEEKDAYS[now.getDay()]} ${time}`;
}

const styles = StyleSheet.create({
  /** Раздел кассы поверх продажи: корзина под ним остаётся набранной. */
  panel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: pos.bg,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 56,
    paddingHorizontal: 12,
    backgroundColor: pos.bar,
  },
  panelBack: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  panelBackLabel: { fontFamily: pos.font, fontSize: 30, color: '#FFFFFF', lineHeight: 32 },
  panelTitle: { fontFamily: pos.font, fontSize: 19, color: '#FFFFFF' },
  screen: { flex: 1, backgroundColor: pos.bg },
  body: { flex: 1, flexDirection: 'row' },

  left: { flex: 1.55, backgroundColor: pos.bg },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: pos.tile,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
    height: 62,
    paddingRight: 16,
  },
  gridButton: {
    width: 62,
    height: 62,
    backgroundColor: pos.bar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: {
    flex: 1,
    fontSize: 19,
    color: pos.text,
    paddingHorizontal: 20,
    outlineStyle: 'none',
  } as object,
  keyHint: {
    width: 30,
    height: 30,
    borderWidth: 1,
    borderColor: '#D1D1D6',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyHintText: { fontSize: 14, color: pos.muted },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 2, padding: 2 },
  tile: {
    width: '16.3%',
    minWidth: 150,
    backgroundColor: pos.tile,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tileSelected: { borderColor: pos.accent },
  tileStock: { fontSize: 13, color: pos.muted, textAlign: 'center' },
  tileImage: {
    height: 128,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
    overflow: 'hidden',
  },
  tilePhoto: { width: '100%', height: '100%' },
  tileName: { fontSize: 15, color: pos.text, textAlign: 'center', lineHeight: 19 },
  tileСode: { fontSize: 13, color: pos.muted, textAlign: 'center', marginTop: 2 },
  tilePriceRow: {
    borderTopWidth: 1,
    borderTopColor: pos.border,
    marginTop: 8,
    paddingTop: 8,
  },
  tilePrice: { fontSize: 17, fontWeight: '600', color: pos.text, textAlign: 'center' },

  right: { flex: 1, backgroundColor: pos.tile, borderLeftWidth: 1, borderLeftColor: pos.border },
  customerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    height: 62,
    paddingLeft: 20,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },
  customerName: { flex: 1, fontSize: 19, color: pos.text },
  addCustomer: {
    width: 62,
    height: 62,
    backgroundColor: pos.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recommendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  recommendLabel: { fontSize: 16, color: pos.text },

  emptyReceipt: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 14 },
  emptyReceiptText: { fontSize: 34, color: '#C7C7CC' },
  shiftClosedTitle: { fontFamily: pos.font, fontSize: 26, color: pos.text },
  shiftClosedNote: {
    fontFamily: pos.font,
    fontSize: 15,
    color: pos.muted,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
  },
  openShift: {
    marginTop: 8,
    paddingHorizontal: 34,
    paddingVertical: 15,
    borderRadius: 4,
    backgroundColor: pos.green,
  },
  openShiftLabel: { fontFamily: pos.font, fontSize: 18, color: '#FFFFFF' },

  receipt: { flex: 1 },
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },
  receiptBody: { flex: 1, gap: 2 },
  receiptName: { fontSize: 16, color: pos.text },
  receiptQty: { fontSize: 14, color: pos.muted },
  receiptSum: { fontSize: 16, color: pos.text, fontVariant: ['tabular-nums'] },
  receiptRemove: { fontSize: 17, color: pos.muted },

  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 58,
    backgroundColor: pos.tile,
    borderTopWidth: 1,
    borderTopColor: pos.border,
  },
  bottomMenu: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 },
  bottomMenuLabel: { fontSize: 17, color: pos.text },
  bottomShop: { flex: 1, fontSize: 15, color: pos.muted, textAlign: 'center' },
  bottomClock: { fontSize: 15, color: pos.muted, paddingRight: 24 },
  sellBar: {
    width: '42%',
    height: 58,
    backgroundColor: pos.bar,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 18,
  },
  sellDots: { fontSize: 20, color: '#FFFFFF' },
  sellLabel: { flex: 1, fontSize: 19, color: '#FFFFFF', letterSpacing: 0.6 },
  sellTotal: { fontSize: 21, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
});
