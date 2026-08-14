import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  listShifts,
  saleLines,
  shiftLength,
  shiftMoney,
  shiftReport,
  shiftSales,
  type ShiftReport,
} from '../../db/shifts';
import { formatMoneyWeb } from '../../domain/money';
import { formatQty } from '../../domain/qty';
import type { Id } from '../../domain/types';
import { useQuery } from '../../state/DatabaseProvider';
import { say } from '../../ui/alert';
import { MenuIcon, WebIcon } from '../../ui/icons';
import { pos } from '../../ui/webTheme';

/**
 * «Смены» — раздел кассы.
 *
 * Раньше здесь был плоский список смен с итогами открытой сверху. У них это
 * два столбца: слева смены по дням, справа — выбранная целиком.
 *
 * Справа сверху вниз: номер смены, кто и когда открыл, «ПЕЧАТЬ»; красная
 * «ЗАКРЫТЬ СМЕНУ» у открытой; «Финансовые операции» — ВЫДАЧА, ПРИЁМ, ПЕРЕВОД;
 * магазин и касса; две карточки «Продажи» и «Возвраты»; «Касса» с деньгами на
 * начало, взносами и выручкой с учётом возвратов; и внизу вкладки «Движение
 * товара» и «Движение денег» — сами чеки и денежные документы этой смены.
 */
export function CashierShifts({ onCloseShift }: { onCloseShift?: () => void }) {
  const shifts = useQuery((db) => listShifts(db, 200));
  const [picked, setPicked] = useState<Id | null>(null);

  const current = picked ?? shifts[0]?.shift.id ?? null;
  const report = useQuery(
    (db) => (current ? shiftReport(db, current) : null),
    [current],
  );

  if (shifts.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Смен ещё не открывали</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView style={styles.list}>
        {groupByDay(shifts).map((day) => (
          <View key={day.label}>
            <View style={styles.dayRow}>
              <WebIcon.calendar size={17} color={pos.muted} />
              <Text style={styles.dayLabel}>{day.label}</Text>
            </View>

            {day.shifts.map((item) => {
              const length = shiftLength(item.shift);
              const active = item.shift.id === current;

              return (
                <Pressable
                  key={item.shift.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setPicked(item.shift.id)}
                  style={[styles.shiftRow, active && styles.shiftRowOn]}
                >
                  <View style={styles.shiftMain}>
                    <Text style={styles.shiftName}>Смена #{item.shift.id}</Text>
                    <Text style={styles.shiftNote}>
                      {length ?? `Открыта в ${time(item.shift.opened_at)}`}
                    </Text>
                  </View>
                  <Text style={styles.shiftSum}>+{formatMoneyWeb(item.revenue)}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>

      {report ? <ShiftCard report={report} onCloseShift={onCloseShift} /> : null}
    </View>
  );
}

function ShiftCard({
  report,
  onCloseShift,
}: {
  report: ShiftReport;
  onCloseShift?: () => void;
}) {
  const [tab, setTab] = useState<'goods' | 'money'>('goods');
  const sales = useQuery((db) => shiftSales(db, report.shift.id), [report.shift.id]);
  const money = useQuery((db) => shiftMoney(db, report.shift.id), [report.shift.id]);

  const open = !report.shift.closed_at;

  return (
    <ScrollView style={styles.card} contentContainerStyle={styles.cardBody}>
      <View style={styles.cardHead}>
        <View>
          <Text style={styles.cardTitle}>Смена #{report.shift.id}</Text>
          <Text style={styles.cardSub}>
            {report.shift.cashier ?? 'кассир не указан'} • {longDate(report.shift.opened_at)}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => say('Печать', 'Печать отчёта смены пока не подключена.')}
          style={styles.print}
        >
          <WebIcon.printer size={18} color={pos.accent} />
          <Text style={styles.printLabel}>ПЕЧАТЬ</Text>
        </Pressable>
      </View>

      {open ? (
        <Pressable
          accessibilityRole="button"
          onPress={onCloseShift}
          style={styles.closeShift}
        >
          <Text style={styles.closeShiftLabel}>ЗАКРЫТЬ СМЕНУ</Text>
        </Pressable>
      ) : null}

      <View style={styles.box}>
        <Text style={styles.boxLabel}>Финансовые операции</Text>
        <View style={styles.opsRow}>
          {['ВЫДАЧА', 'ПРИЁМ', 'ПЕРЕВОД'].map((label) => (
            <Pressable
              key={label}
              accessibilityRole="button"
              onPress={() =>
                say(label, 'Внесение, изъятие и перевод денег пока заводятся в кабинете.')
              }
              style={styles.op}
            >
              <Text style={styles.opLabel}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.where}>
        <View style={styles.whereItem}>
          <MenuIcon.shops size={22} color={pos.text} />
          <View>
            <Text style={styles.whereName}>{report.location_name ?? 'Магазин'}</Text>
            <Text style={styles.whereKind}>Магазин</Text>
          </View>
        </View>
        <View style={styles.whereItem}>
          <MenuIcon.register size={22} color={pos.text} />
          <View>
            <Text style={styles.whereName}>{report.register_name}</Text>
            <Text style={styles.whereKind}>Касса</Text>
          </View>
        </View>
      </View>

      <View style={styles.pair}>
        <Counters
          title="Продажи"
          count={report.receipts}
          rows={[
            ['Наличные', report.cash],
            ['Безналичные', report.card],
            ['Сумма продаж', report.revenue],
          ]}
        />
        <Counters
          title="Возвраты"
          count={report.returns}
          rows={[
            ['Наличные', 0],
            ['Безналичные', 0],
            ['Сумма возвратов продаж', report.returnsSum],
          ]}
        />
      </View>

      <View style={styles.box}>
        <Text style={styles.boxTitle}>Касса</Text>
        <Line label="Сумма на начало смены" value={report.shift.opening_cash} />
        <Line label="Сумма всех взносов" value={report.moneyIn} />
        <Line label="Сумма всех изъятий" value={report.moneyOut} />
        <Line label="Сумма на текущий момент" value={report.expectedCash} />
        {report.shift.closing_cash !== null ? (
          <>
            <Line label="Пересчитано при закрытии" value={report.shift.closing_cash} />
            <Line label="Расхождение" value={report.difference ?? 0} />
          </>
        ) : null}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Выручка с учетом возвратов</Text>
          <Text style={styles.totalValue}>
            {formatMoneyWeb(report.revenue - report.returnsSum)} руб
          </Text>
        </View>
      </View>

      <View style={styles.tabs}>
        {(
          [
            ['goods', 'ДВИЖЕНИЕ ТОВАРА'],
            ['money', 'ДВИЖЕНИЕ ДЕНЕГ'],
          ] as ['goods' | 'money', string][]
        ).map(([id, label]) => (
          <Pressable
            key={id}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === id }}
            onPress={() => setTab(id)}
            style={[styles.tab, tab === id && styles.tabOn]}
          >
            <Text style={[styles.tabLabel, tab === id && styles.tabLabelOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'goods' ? (
        sales.length === 0 ? (
          <Text style={styles.none}>Чеков в этой смене нет</Text>
        ) : (
          sales.map((sale) => <SaleCard key={sale.id} sale={sale} />)
        )
      ) : money.length === 0 ? (
        <Text style={styles.none}>Денежных документов в этой смене нет</Text>
      ) : (
        money.map((doc) => (
          <View key={doc.id} style={styles.moneyRow}>
            <View style={styles.rowMain}>
              <Text style={styles.saleTitle}>{doc.category ?? doc.account}</Text>
              <Text style={styles.saleNote}>
                {longDate(doc.created_at)} · {doc.account}
                {doc.account_to ? ` → ${doc.account_to}` : ''}
                {doc.note ? ` · ${doc.note}` : ''}
              </Text>
            </View>
            <Text style={[styles.saleSum, doc.type === 'expense' && styles.minus]}>
              {doc.type === 'expense' ? '−' : '+'}
              {formatMoneyWeb(doc.amount)} руб
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

/** Один чек смены: шапка, «Оплачен» и раскрывающийся список товаров. */
function SaleCard({ sale }: { sale: ReturnType<typeof shiftSales>[number] }) {
  const [open, setOpen] = useState(false);
  const lines = useQuery((db) => (open ? saleLines(db, sale.id) : []), [open, sale.id]);

  return (
    <View style={styles.saleCard}>
      <View style={styles.saleHead}>
        <Text style={styles.saleTitle}>Продажа #{sale.id}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => say('Печать', 'Печать чека пока не подключена.')}
          style={styles.salePrint}
        >
          <WebIcon.printer size={15} color={pos.muted} />
          <Text style={styles.salePrintLabel}>ПЕЧАТЬ</Text>
        </Pressable>
        <Text style={styles.saleSum}>{formatMoneyWeb(sale.total)} руб</Text>
      </View>

      <Text style={styles.saleNote}>
        {longDate(sale.created_at)} · {sale.staff_name ?? 'кассир не указан'}
      </Text>
      <Text style={styles.saleNote}>
        {sale.location_name ?? 'Магазин'} · {sale.customer_name ?? 'Розничный покупатель'}
      </Text>

      <View style={styles.saleState}>
        <WebIcon.done size={17} color={sale.debt > 0 ? pos.accent : pos.green} />
        <Text style={styles.saleStateLabel}>
          {sale.refunded
            ? 'Возвращён'
            : sale.debt > 0
              ? `Долг ${formatMoneyWeb(sale.debt)} руб`
              : 'Оплачен'}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((was) => !was)}
        style={styles.saleState}
      >
        <WebIcon.home size={16} color={pos.muted} />
        <Text style={styles.saleStateLabel}>Список товаров</Text>
        <Text style={styles.salePositions}>{sale.positions} поз.</Text>
        <Text style={styles.saleChevron}>{open ? '⌃' : '⌄'}</Text>
      </Pressable>

      {open
        ? lines.map((line, index) => (
            <View key={index} style={styles.lineRow}>
              <Text style={styles.lineName} numberOfLines={1}>
                {line.name}
              </Text>
              <Text style={styles.lineQty}>
                {formatQty(line.qty)} {line.unit}
              </Text>
              <Text style={styles.lineSum}>
                {formatMoneyWeb(Math.round((line.price * line.qty) / 1000))} руб
              </Text>
            </View>
          ))
        : null}
    </View>
  );
}

function Counters({
  title,
  count,
  rows,
}: {
  title: string;
  count: number;
  rows: [string, number][];
}) {
  return (
    <View style={styles.counters}>
      <View style={styles.countersHead}>
        <Text style={styles.countersTitle}>{title}</Text>
        <Text style={styles.countersCount}>{count}</Text>
      </View>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.countersRow}>
          <Text style={styles.countersLabel}>{label}</Text>
          <Text style={styles.countersValue}>{formatMoneyWeb(value)} руб</Text>
        </View>
      ))}
    </View>
  );
}

function Line({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.countersRow}>
      <Text style={styles.countersLabel}>{label}</Text>
      <Text style={styles.countersValue}>{formatMoneyWeb(value)} руб</Text>
    </View>
  );
}

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];
const SHORT = ['янв.', 'фев.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сен.', 'окт.', 'ноя.', 'дек.'];

function time(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function longDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${time(iso)}`;
}

/** Смены по дням — так они и стоят в списке: «14 авг.», под ним смены. */
function groupByDay(shifts: ShiftReport[]): { label: string; shifts: ShiftReport[] }[] {
  const days: { label: string; shifts: ShiftReport[] }[] = [];

  for (const item of shifts) {
    const date = new Date(item.shift.opened_at);
    const label = `${date.getDate()} ${SHORT[date.getMonth()]}`;
    const last = days[days.length - 1];

    if (last && last.label === label) last.shifts.push(item);
    else days.push({ label, shifts: [item] });
  }

  return days;
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: pos.bg },

  list: { width: 300, backgroundColor: pos.tile, borderRightWidth: 1, borderRightColor: pos.border },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: pos.bg,
  },
  dayLabel: { fontFamily: pos.font, fontSize: 15, color: pos.muted },
  shiftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },
  shiftRowOn: { backgroundColor: '#EAF3FC' },
  shiftMain: { flex: 1, gap: 3 },
  shiftName: { fontFamily: pos.font, fontSize: 17, color: pos.text },
  shiftNote: { fontFamily: pos.font, fontSize: 13, color: pos.muted },
  shiftSum: { fontFamily: pos.font, fontSize: 15, color: '#2E7D32' },

  card: { flex: 1 },
  cardBody: { padding: 26, gap: 18 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardTitle: { fontFamily: pos.font, fontSize: 30, color: pos.text },
  cardSub: { fontFamily: pos.font, fontSize: 14, color: pos.muted, marginTop: 4 },
  print: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 },
  printLabel: { fontFamily: pos.font, fontSize: 14, color: pos.accent, letterSpacing: 0.6 },

  closeShift: {
    alignSelf: 'flex-start',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 4,
    backgroundColor: '#FDECEC',
  },
  closeShiftLabel: { fontFamily: pos.font, fontSize: 15, color: pos.red, letterSpacing: 0.6 },

  box: { padding: 20, backgroundColor: pos.tile, borderRadius: 6, gap: 8 },
  boxLabel: { fontFamily: pos.font, fontSize: 14, color: pos.muted },
  boxTitle: { fontFamily: pos.font, fontSize: 22, color: pos.text, marginBottom: 6 },

  opsRow: { flexDirection: 'row', gap: 12, marginTop: 6 },
  op: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: pos.accent,
  },
  opLabel: { fontFamily: pos.font, fontSize: 14, color: pos.accent, letterSpacing: 0.6 },

  where: { flexDirection: 'row', gap: 40, padding: 20, backgroundColor: pos.tile, borderRadius: 6 },
  whereItem: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  whereName: { fontFamily: pos.font, fontSize: 15, color: pos.text },
  whereKind: { fontFamily: pos.font, fontSize: 13, color: pos.muted },

  pair: { flexDirection: 'row', gap: 16 },
  counters: { flex: 1, backgroundColor: pos.tile, borderRadius: 6, borderWidth: 1, borderColor: pos.border },
  countersHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },
  countersTitle: { fontFamily: pos.font, fontSize: 22, color: pos.text },
  countersCount: { fontFamily: pos.font, fontSize: 22, color: pos.text },
  countersRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 18,
    paddingVertical: 5,
  },
  countersLabel: { fontFamily: pos.font, fontSize: 15, color: pos.text },
  countersValue: { fontFamily: pos.font, fontSize: 15, color: pos.text, fontVariant: ['tabular-nums'] },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    marginTop: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: pos.border,
  },
  totalLabel: { fontFamily: pos.font, fontSize: 17, color: pos.text },
  totalValue: { fontFamily: pos.font, fontSize: 17, fontWeight: '700', color: pos.text },

  tabs: { flexDirection: 'row', alignSelf: 'center', borderRadius: 4, overflow: 'hidden' },
  tab: { paddingHorizontal: 22, paddingVertical: 12, backgroundColor: pos.tile },
  tabOn: { backgroundColor: pos.bar },
  tabLabel: { fontFamily: pos.font, fontSize: 14, color: pos.bar, letterSpacing: 0.6 },
  tabLabelOn: { color: '#FFFFFF' },

  saleCard: { padding: 18, backgroundColor: pos.tile, borderRadius: 6, gap: 4 },
  saleHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  saleTitle: { fontFamily: pos.font, fontSize: 20, color: pos.text },
  salePrint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 3,
    backgroundColor: pos.bg,
  },
  salePrintLabel: { fontFamily: pos.font, fontSize: 12, color: pos.muted, letterSpacing: 0.6 },
  saleSum: { flex: 1, fontFamily: pos.font, fontSize: 20, color: pos.text, textAlign: 'right' },
  minus: { color: pos.red },
  saleNote: { fontFamily: pos.font, fontSize: 13, color: pos.muted },
  saleState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: pos.border,
  },
  saleStateLabel: { fontFamily: pos.font, fontSize: 15, color: pos.text },
  salePositions: { flex: 1, fontFamily: pos.font, fontSize: 14, color: pos.muted, textAlign: 'right' },
  saleChevron: { fontFamily: pos.font, fontSize: 15, color: pos.muted },

  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 5 },
  lineName: { flex: 1, fontFamily: pos.font, fontSize: 14, color: pos.text },
  lineQty: { fontFamily: pos.font, fontSize: 14, color: pos.muted },
  lineSum: { width: 110, fontFamily: pos.font, fontSize: 14, color: pos.text, textAlign: 'right' },

  moneyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    backgroundColor: pos.tile,
    borderRadius: 6,
  },
  rowMain: { flex: 1, gap: 3 },

  none: { fontFamily: pos.font, fontSize: 15, color: pos.muted, padding: 20, textAlign: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { fontFamily: pos.font, fontSize: 16, color: pos.muted },
});
