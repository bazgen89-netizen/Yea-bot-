import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Dropdown, type Option } from '../Dropdown';
import { Text, TextInput } from '../Translated';
import { listCounterparties } from '../../db/counterparties';
import { listLocations } from '../../db/locations';
import { getSale, refundSale, updateSale } from '../../db/sales';
import { formatMoneyWeb, parseMoney } from '../../domain/money';
import { formatQty, parseQty } from '../../domain/qty';
import type { Id } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { confirm, say } from '../../ui/alert';
import { WebIcon } from '../../ui/icons';
import { FORM_BORDER, web, WEB_FONT } from '../../ui/webTheme';

/**
 * Правка документа — отдельной страницей, как у него.
 *
 * Сперва я сделал правку прямо в просмотре: поля становились полями, и всё.
 * Он показал, что в кабинете это **другой экран** —
 * `card/doc/show/<id>`, «Документы / редактирование документа»: своя полоса
 * с «Сохранить» и «Печать», переключатель «Документ проведён», галочка
 * «Заказ», дата с карандашом, номер документа прямо в заголовке, два поля
 * «Магазин» и «Клиент», вкладки «Товары» и «Счета и оплата», и таблица с
 * двенадцатью колонками, где правятся количество, цена и скидка.
 *
 * Разметка взята у них же: `js/pages/card/documents/_view.html` и
 * `js/pages/card/documents/form/products.html` — оба отдаются без входа.
 * Оттуда и порядок колонок: `NAME`, `PRODUCT_CODE`, `SKU`, `BARCODE`,
 * `TAXES`, `UNIT_SHORT`, `QTY`, `PRICE`, `DISCOUNT`, `TOTAL`.
 *
 * Скидка здесь **в процентах**, а не в рублях: так у него в этой таблице.
 * В просмотре документа она же показана суммой — там колонка «Скидка» в
 * рублях, и это не противоречие, а два разных экрана.
 */
export function SaleEdit({ id }: { id: Id }) {
  const router = useRouter();
  const { db, refresh } = useDatabase();
  const sale = useQuery((database) => getSale(database, id), [id]);

  const stores = useQuery((database) => listLocations(database));
  const clients = useQuery((database) => listCounterparties(database, { kind: 'customer' }));

  const [tab, setTab] = useState<'products' | 'orders'>('products');
  const [search, setSearch] = useState('');
  const [number, setNumber] = useState<string | null>(null);
  const [customer, setCustomer] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<number, { qty?: string; price?: string; disc?: string }>>({});
  const [dropped, setDropped] = useState<number[]>([]);

  if (!sale) return <Text style={styles.empty}>Документ не найден</Text>;

  const kept = sale.items.filter((item) => !dropped.includes(item.id));

  /** Строка после правки: количество, цена и скидка процентом. */
  const edited = (item: (typeof sale.items)[number]) => {
    const edit = edits[item.id] ?? {};
    const qty = edit.qty != null ? (parseQty(edit.qty) ?? 0) : item.qty;
    const price = edit.price != null ? (parseMoney(edit.price) ?? 0) : item.price;

    const gross = Math.round((qty * price) / 1000);
    const percent =
      edit.disc != null
        ? Math.min(Math.max(Number(edit.disc.replace(',', '.')) || 0, 0), 100)
        : gross
          ? Math.round(((item.discount ?? 0) / gross) * 100)
          : 0;

    const discount = Math.round((gross * percent) / 100);
    return { qty, price, gross, percent, discount, total: gross - discount };
  };

  const rows = kept
    .filter((item) => !search.trim() || item.name.toLowerCase().includes(search.trim().toLowerCase()))
    .map((item) => ({ item, ...edited(item) }));

  const total = kept.reduce((sum, item) => sum + edited(item).total, 0);

  function save() {
    if (!sale) return;

    const lines = kept
      .map((item) => {
        const now = edited(item);
        return {
          product_id: item.product_id,
          name: item.name,
          unit: item.unit,
          qty: now.qty,
          price: now.price,
          cost_price: item.cost_price,
          discount: now.discount,
          stock: 0,
        };
      })
      .filter((line) => line.qty > 0);

    if (lines.length === 0) {
      say('Пустой документ', 'В документе должна остаться хотя бы одна строка.');
      return;
    }

    try {
      updateSale(db, id, {
        lines,
        discount: sale.discount,
        customerId: customer ? Number(customer) : sale.customer_id,
      });
      refresh();
      back();
    } catch (error) {
      say('Не удалось сохранить', String(error));
    }
  }

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/journal');
  }

  function remove() {
    confirm(
      'Оформить возврат?',
      'Товар вернётся на склад, а документ перестанет учитываться в выручке.',
      'Вернуть',
      () => {
        try {
          refundSale(db, id);
          refresh();
          back();
        } catch (error) {
          say('Не удалось', String(error));
        }
      },
    );
  }

  const storeOptions: Option<string>[] = stores.map((store: { id: number; name: string }) => ({
    value: String(store.id),
    label: store.name,
  }));

  const clientOptions: Option<string>[] = [
    { value: '', label: 'Розничный покупатель' },
    ...clients.map((party) => ({ value: String(party.id), label: party.name })),
  ];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Полоса действий: «Сохранить», «Печать», справа «Удалить». */}
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" onPress={save} style={[styles.button, styles.green]}>
          <Text style={styles.greenLabel}>Сохранить</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (typeof globalThis.print === 'function') globalThis.print();
          }}
          style={styles.button}
        >
          <Text style={styles.buttonLabel}>Печать</Text>
          <WebIcon.caretDown size={12} color={web.text} />
        </Pressable>

        <View style={styles.grow} />

        <Pressable accessibilityRole="button" onPress={remove} style={[styles.button, styles.danger]}>
          <Text style={styles.dangerLabel}>Удалить</Text>
        </Pressable>
      </View>

      {/* Переключатель «Документ проведён», галочка «Заказ» и дата. */}
      <View style={styles.stateRow}>
        <View style={styles.toggleRow}>
          <View style={[styles.track, styles.trackOn]}>
            <View style={[styles.knob, styles.knobOn]} />
          </View>
          <Text style={styles.stateLabel}>
            {sale.refunded ? 'Документ возвращён' : 'Документ проведён'}
          </Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.toggleRow}>
          <View style={styles.box} />
          <Text style={styles.stateLabel}>Заказ</Text>
        </View>

        <View style={styles.grow} />

        <Text style={styles.date}>{when(sale.created_at)}</Text>
        <WebIcon.pencil size={15} color={web.textMuted} />
      </View>

      {/* Заголовок с номером документа: у него номер правится прямо здесь. */}
      <View style={styles.titleRow}>
        <Text style={styles.title}>{sale.refunded ? 'Возврат продажи' : 'Продажа'} #</Text>
        <TextInput
          value={number ?? String(sale.number ?? sale.id)}
          onChangeText={setNumber}
          accessibilityLabel="Номер документа"
          style={styles.numberInput}
        />
      </View>

      <View style={styles.fields}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Магазин</Text>
          <Dropdown
            value={String(stores.find((one: { name: string }) => one.name === sale.store)?.id ?? '')}
            options={storeOptions}
            variant="field"
            label="Магазин"
            onChange={() => {
              // Магазин документа не меняем: движения склада уже сделаны в
              // своей точке, и перенос их в другую сам по себе — отдельная
              // операция, «Перемещение».
              say('Магазин у проведённого документа', 'Товар уже списан в этой точке. Чтобы перенести его в другую, заведите «Перемещение».');
            }}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Клиент</Text>
          <Dropdown
            value={customer ?? (sale.customer_id ? String(sale.customer_id) : '')}
            options={clientOptions}
            variant="field"
            label="Клиент"
            onChange={setCustomer}
          />
        </View>
      </View>

      <View style={styles.tabs}>
        <Pressable accessibilityRole="button" onPress={() => setTab('products')}>
          <Text style={[styles.tab, tab === 'products' && styles.tabOn]}>Товары</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setTab('orders')}>
          <Text style={[styles.tab, tab === 'orders' && styles.tabOn]}>Счета и оплата</Text>
        </Pressable>
      </View>

      {tab === 'products' ? (
        <>
          <View style={styles.toolbar}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Поиск по товарам в документе"
              placeholderTextColor={web.textMuted}
              accessibilityLabel="Поиск по товарам в документе"
              style={styles.search}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                setEdits((was) => {
                  const next = { ...was };
                  for (const item of kept) next[item.id] = { ...next[item.id], price: undefined };
                  return next;
                })
              }
              style={[styles.button, styles.blueOutline]}
            >
              <Text style={styles.blueLabel}>Цена продажи</Text>
            </Pressable>
          </View>

          <View style={styles.table}>
            <View style={[styles.row, styles.head]}>
              <Text style={[styles.no, styles.headText]}>#</Text>
              <Text style={[styles.name, styles.headText]}>Наименование</Text>
              <Text style={[styles.code, styles.headText]}>Код товара</Text>
              <Text style={[styles.code, styles.headText]}>Артикул</Text>
              <Text style={[styles.code, styles.headText]}>Штрих-код</Text>
              <Text style={[styles.num, styles.headText]}>Налог</Text>
              <Text style={[styles.unit, styles.headText]}>Ед. изм.</Text>
              <Text style={[styles.num, styles.headText]}>Кол-во</Text>
              <Text style={[styles.num, styles.headText]}>Цена, руб</Text>
              <Text style={[styles.num, styles.headText]}>Скидка, %</Text>
              <Text style={[styles.num, styles.headText]}>Итог</Text>
              <Text style={styles.kill} />
            </View>

            {rows.map(({ item, percent, total: lineTotal }, index) => (
              <View key={item.id} style={styles.row}>
                <Text style={styles.no}>{index + 1}</Text>

                <View style={styles.name}>
                  <WebIcon.products size={15} color={web.textMuted} />
                  <Text
                    accessibilityRole="link"
                    style={styles.nameText}
                    numberOfLines={2}
                    onPress={() =>
                      router.push({
                        pathname: '/product/[id]',
                        params: { id: String(item.product_id) },
                      })
                    }
                  >
                    {item.name}
                  </Text>
                </View>

                <Text style={styles.code}>{item.code ?? ''}</Text>
                <Text style={styles.code}>{item.sku ?? ''}</Text>
                <Text style={styles.code}>{item.barcode ?? ''}</Text>
                <Text style={styles.num}>0.00</Text>
                <Text style={styles.unit}>{item.unit}</Text>

                {/* Правятся три колонки, и у него они подсвечены жёлтым. */}
                <TextInput
                  value={edits[item.id]?.qty ?? String(item.qty / 1000)}
                  onChangeText={(text) =>
                    setEdits((was) => ({ ...was, [item.id]: { ...was[item.id], qty: text } }))
                  }
                  accessibilityLabel={`Количество: ${item.name}`}
                  style={[styles.num, styles.input]}
                />
                <TextInput
                  value={edits[item.id]?.price ?? String(item.price / 100)}
                  onChangeText={(text) =>
                    setEdits((was) => ({ ...was, [item.id]: { ...was[item.id], price: text } }))
                  }
                  accessibilityLabel={`Цена: ${item.name}`}
                  style={[styles.num, styles.input]}
                />
                <TextInput
                  value={edits[item.id]?.disc ?? String(percent)}
                  onChangeText={(text) =>
                    setEdits((was) => ({ ...was, [item.id]: { ...was[item.id], disc: text } }))
                  }
                  accessibilityLabel={`Скидка: ${item.name}`}
                  style={[styles.num, styles.input]}
                />

                <Text style={styles.num}>{formatMoneyWeb(lineTotal)}</Text>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Убрать ${item.name}`}
                  onPress={() => setDropped((was) => [...was, item.id])}
                  style={styles.kill}
                >
                  <Text style={styles.killMark}>✕</Text>
                </Pressable>
              </View>
            ))}
          </View>

          <View style={styles.totals}>
            <Total label="Итог:" value={`${formatMoneyWeb(total)} руб`} />
            <Total label="Оплаченные:" value={`${formatMoneyWeb(sale.total - sale.debt)} руб`} />
            <Total label="Налоги:" value={`${formatMoneyWeb(0)} руб`} />
          </View>
        </>
      ) : (
        <View style={styles.table}>
          <View style={[styles.row, styles.head]}>
            <Text style={[styles.code, styles.headText]}>#</Text>
            <Text style={[styles.name, styles.headText]}>Счёт</Text>
            <Text style={[styles.name, styles.headText]}>Контрагент</Text>
            <Text style={[styles.code, styles.headText]}>Дата</Text>
            <Text style={[styles.num, styles.headText]}>Сумма</Text>
          </View>

          <View style={styles.row}>
            <Text style={[styles.code, styles.linkText]}>{sale.money_number ?? sale.id}</Text>
            <Text style={styles.nameText}>{sale.payment === 'cash' ? 'Касса магазина' : 'Терминал / Счет в банке'}</Text>
            <Text style={styles.nameText}>{sale.customer ?? 'Розничный покупатель'}</Text>
            <Text style={styles.code}>{when(sale.created_at)}</Text>
            <Text style={styles.num}>{formatMoneyWeb(sale.total)}</Text>
          </View>
        </View>
      )}

      {/* Подвал документа — как у него: кто завёл и когда. */}
      <View style={styles.status}>
        <Text style={styles.statusItem}>{sale.author ?? 'waystea'}</Text>
        <Text style={styles.statusItem}>Создан {when(sale.created_at)}</Text>
      </View>
    </ScrollView>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.totalRow}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={styles.totalValue}>{value}</Text>
    </View>
  );
}

/** «23 августа, 18:15» — так подписана дата документа у него. */
function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  const pad = (value: number) => String(value).padStart(2, '0');

  return `${date.getDate()} ${months[date.getMonth()]}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const YELLOW = '#FFFDF0';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  content: { padding: 24, paddingBottom: 60 },
  empty: { fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted, padding: 40 },

  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  grow: { flex: 1 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    paddingHorizontal: 22,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(34,36,38,0.15)',
    backgroundColor: '#FFFFFF',
  },
  buttonLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.text },
  green: { backgroundColor: web.green, borderColor: web.green },
  greenLabel: { fontFamily: WEB_FONT, fontSize: 15, color: '#FFFFFF' },
  danger: { borderColor: web.danger },
  dangerLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.danger },
  blueOutline: { borderColor: web.link },
  blueLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.link },

  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: FORM_BORDER,
    marginBottom: 20,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { width: 44, height: 22, borderRadius: 11, backgroundColor: '#D6DAE0', padding: 2 },
  trackOn: { backgroundColor: web.link },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFFFFF' },
  knobOn: { marginLeft: 22 },
  box: { width: 17, height: 17, borderRadius: 3, borderWidth: 1, borderColor: '#B7BDC6' },
  stateLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.text },
  divider: { width: 1, height: 22, backgroundColor: FORM_BORDER },
  date: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted },

  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 22 },
  title: { fontFamily: WEB_FONT, fontSize: 30, color: web.text },
  numberInput: {
    fontFamily: WEB_FONT,
    fontSize: 30,
    color: web.text,
    borderBottomWidth: 1,
    borderBottomColor: FORM_BORDER,
    minWidth: 140,
    paddingBottom: 2,
  },

  fields: { flexDirection: 'row', gap: 22, marginBottom: 26 },
  field: { flex: 1, gap: 8 },
  fieldLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted },

  tabs: { flexDirection: 'row', gap: 26, borderBottomWidth: 1, borderBottomColor: FORM_BORDER },
  tab: { fontFamily: WEB_FONT, fontSize: 22, color: web.textMuted, paddingBottom: 10 },
  tabOn: { color: web.link, borderBottomWidth: 3, borderBottomColor: web.link },

  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 18 },
  search: {
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 14,
    fontFamily: WEB_FONT,
    fontSize: 15,
    color: web.text,
    backgroundColor: '#FFFFFF',
  },

  table: { borderWidth: 1, borderColor: FORM_BORDER, borderRadius: 4, backgroundColor: '#FFFFFF' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: FORM_BORDER,
  },
  head: { backgroundColor: '#FFFFFF', borderTopWidth: 0 },
  headText: { color: web.link, fontSize: 13 },

  no: { width: 30, fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  name: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameText: { flex: 1, fontFamily: WEB_FONT, fontSize: 13, color: web.link },
  linkText: { color: web.link },
  code: { width: 110, fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  unit: { width: 70, fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  num: {
    width: 92,
    textAlign: 'right',
    fontFamily: WEB_FONT,
    fontSize: 13,
    color: web.text,
    fontVariant: ['tabular-nums'],
  },
  input: {
    backgroundColor: YELLOW,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  kill: { width: 26, alignItems: 'center' },
  killMark: { fontFamily: WEB_FONT, fontSize: 14, color: web.danger },

  totals: { marginTop: 26, gap: 12 },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    borderBottomWidth: 1,
    borderBottomColor: FORM_BORDER,
    borderStyle: 'dashed',
    paddingBottom: 8,
  },
  totalLabel: { flex: 1, fontFamily: WEB_FONT, fontSize: 22, color: web.text },
  totalValue: { fontFamily: WEB_FONT, fontSize: 22, color: web.text },

  status: { flexDirection: 'row', gap: 22, marginTop: 26 },
  statusItem: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },
});
