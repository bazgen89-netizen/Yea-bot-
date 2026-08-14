import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { CashierDebts } from './CashierDebts';
import { CashierShifts } from './CashierShifts';
import { listCounterparties } from '../../db/counterparties';
import { listProducts } from '../../db/products';
import { listSales } from '../../db/sales';
import { listShifts, openShiftAnywhere, shiftReport } from '../../db/shifts';
import { formatMoneyWeb } from '../../domain/money';
import { formatQty } from '../../domain/qty';
import { useQuery } from '../../state/DatabaseProvider';
import { pos } from '../../ui/webTheme';

/**
 * Экраны, которые открываются **внутри** кассы.
 *
 * Каждый пункт меню кассира раньше вёл на экран кабинета: «Товары» — на
 * справочник, «История чеков» — в журнал, «Смены» — в кассовый раздел. То
 * есть любое нажатие выбрасывало кассира из кассы, и чтобы пробить
 * следующий чек, надо было возвращаться обратно.
 *
 * Касса — рабочее место, а не переход куда-то ещё. Поэтому её разделы живут
 * здесь и рисуются поверх продажи, не трогая маршрут. Наружу ведёт ровно
 * одна кнопка — «Выйти в кабинет».
 */

export type CashierView =
  | 'sale'
  | 'receipts'
  | 'clients'
  | 'products'
  | 'shifts'
  | 'debts'
  | 'money'
  | 'xreport'
  | 'settings';

/**
 * Заголовок раздела.
 *
 * Не все они стоят в меню: «Клиенты» открывает кнопка в чеке, а X-отчёт живёт
 * внутри «Смен» — так же, как у него.
 */
export const VIEW_TITLE: Record<Exclude<CashierView, 'sale'>, string> = {
  receipts: 'Журнал чеков',
  clients: 'Клиенты',
  products: 'Товары',
  shifts: 'Смены',
  debts: 'Возврат долга',
  money: 'Внесение и изъятие',
  xreport: 'X-отчёт',
  settings: 'Настройки',
};

export function CashierPanel({
  view,
  onCloseShift,
}: {
  view: Exclude<CashierView, 'sale'>;
  /** Закрыть смену — красной кнопкой из карточки смены. */
  onCloseShift?: () => void;
}) {
  if (view === 'receipts') return <Receipts />;
  if (view === 'clients') return <Clients />;
  if (view === 'products') return <Products />;
  if (view === 'shifts') return <CashierShifts onCloseShift={onCloseShift} />;
  if (view === 'debts') return <CashierDebts />;
  if (view === 'money') return <Money />;
  if (view === 'xreport') return <XReport />;
  return <Settings />;
}

function Receipts() {
  const sales = useQuery((db) => listSales(db, 100));

  if (sales.length === 0) return <Empty text="Чеков ещё не было" />;

  return (
    <ScrollView style={styles.list}>
      {sales.map((sale) => (
        <View key={sale.id} style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>Чек №{sale.id}</Text>
            <Text style={styles.rowNote}>
              {new Date(sale.created_at).toLocaleString('ru-RU')}
              {sale.refunded > 0 ? ' · возврат' : ''}
            </Text>
          </View>
          <Text style={styles.rowValue}>{formatMoneyWeb(sale.total)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function Clients() {
  const clients = useQuery((db) => listCounterparties(db, { kind: 'customer' }));

  if (clients.length === 0) return <Empty text="Клиентов пока нет" />;

  return (
    <ScrollView style={styles.list}>
      {clients.slice(0, 300).map((client) => (
        <View key={client.id} style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>{client.name}</Text>
            <Text style={styles.rowNote}>{client.phone ?? 'без телефона'}</Text>
          </View>
          <Text style={styles.rowValue}>{formatMoneyWeb(client.purchases)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function Products() {
  const products = useQuery((db) => listProducts(db));

  return (
    <ScrollView style={styles.list}>
      {products.slice(0, 300).map((product) => (
        <View key={product.id} style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>{product.name}</Text>
            <Text style={styles.rowNote}>
              Остаток {formatQty(product.stock)} {product.unit}
            </Text>
          </View>
          <Text style={styles.rowValue}>{formatMoneyWeb(product.sale_price)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

/**
 * Смены: сперва итоги открытой, потом список прошлых.
 *
 * Итоги — это и есть X-отчёт, и отдельным пунктом меню он не нужен: у него
 * они тоже показаны прямо на экране смены. Подписи его же — «Сумма продаж»,
 * «Выручка с учетом возвратов», «Сумма на текущий момент».
 */
function Shifts() {
  const shifts = useQuery((db) => listShifts(db, 50));
  const current = useQuery((db) => openShiftAnywhere(db));
  const report = useQuery(
    (db) => (current ? shiftReport(db, current.id) : null),
    [current?.id],
  );

  if (shifts.length === 0) return <Empty text="Смен ещё не открывали" />;

  return (
    <ScrollView style={styles.list}>
      {report && current ? (
        <View style={styles.stats}>
          <Text style={styles.statsTitle}>Смена №{current.id} — {report.register_name}</Text>
          <Line label="Количество продаж" value={String(report.receipts)} />
          <Line label="Сумма продаж" value={formatMoneyWeb(report.revenue)} />
          <Line label="Наличные" value={formatMoneyWeb(report.cash)} />
          <Line label="Безналичные" value={formatMoneyWeb(report.card)} />
          <Line label="Сумма на начало смены" value={formatMoneyWeb(current.opening_cash)} />
          <Line label="Сумма на текущий момент" value={formatMoneyWeb(report.expectedCash)} />
        </View>
      ) : null}

      {shifts.map((report2) => (
        <View key={report2.shift.id} style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>Смена №{report2.shift.id}</Text>
            <Text style={styles.rowNote}>
              {new Date(report2.shift.opened_at).toLocaleString('ru-RU')}
              {report2.shift.closed_at ? ' — закрыта' : ' — открыта'}
            </Text>
          </View>
          <Text style={styles.rowValue}>{report2.register_name}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function Money() {
  return (
    <Empty text="Внесение и изъятие денег из ящика — раздел в работе. Приход и расход пока заводятся в кабинете." />
  );
}

/** X-отчёт: то же, что при закрытии смены, но без закрытия. */
function XReport() {
  // Открытая смена, на какой бы кассе она ни была: у кассира она одна.
  const shift = useQuery((database) => openShiftAnywhere(database));
  const report = useQuery(
    (database) => (shift ? shiftReport(database, shift.id) : null),
    [shift?.id],
  );
  if (!shift || !report) return <Empty text="Смена закрыта — считать нечего" />;

  return (
    <View style={styles.list}>
      <Line label="Наличными в кассе на начало" value={formatMoneyWeb(shift.opening_cash)} />
      <Line label="Продажи наличными" value={formatMoneyWeb(report.cash)} />
      <Line label="Продажи картой" value={formatMoneyWeb(report.card)} />
      <Line label="Внесено" value={formatMoneyWeb(report.moneyIn)} />
      <Line label="Изъято" value={formatMoneyWeb(report.moneyOut)} />
      <Line label="Чеков" value={String(report.receipts)} />
      <View style={styles.total}>
        <Text style={styles.totalLabel}>Должно быть в ящике</Text>
        <Text style={styles.totalValue}>{formatMoneyWeb(report.expectedCash)}</Text>
      </View>
    </View>
  );
}

function Settings() {
  return <Empty text="Настройки кассы — раздел в работе." />;
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: pos.bg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: pos.tile,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },
  stats: { padding: 20, gap: 4, backgroundColor: pos.tile, borderBottomWidth: 8, borderBottomColor: pos.bg },
  statsTitle: { fontFamily: pos.font, fontSize: 17, color: pos.text, marginBottom: 8 },
  rowMain: { flex: 1, gap: 3 },
  rowTitle: { fontFamily: pos.font, fontSize: 16, color: pos.text },
  rowNote: { fontFamily: pos.font, fontSize: 13, color: pos.muted },
  rowValue: { fontFamily: pos.font, fontSize: 16, color: pos.text },
  total: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    backgroundColor: pos.tile,
    borderTopWidth: 2,
    borderTopColor: pos.border,
  },
  totalLabel: { fontFamily: pos.font, fontSize: 17, color: pos.text },
  totalValue: { fontFamily: pos.font, fontSize: 17, fontWeight: '700', color: pos.text },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: {
    fontFamily: pos.font,
    fontSize: 16,
    color: pos.muted,
    textAlign: 'center',
    maxWidth: 460,
    lineHeight: 24,
  },
});
