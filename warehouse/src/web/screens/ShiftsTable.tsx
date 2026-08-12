import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Column, HeadRow, Row, SearchBox, ToolButton, Toolbar } from '../Table';
import { formatDay, formatTime } from '../../db/journal';
import { closeShift, listRegisters, listShifts, openShift, type ShiftReport } from '../../db/shifts';
import { formatMoneyWeb } from '../../domain/money';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { WebIcon } from '../../ui/icons';
import { say } from '../../ui/alert';
import { web, webText, WEB_FONT } from '../../ui/webTheme';
import { ShiftView } from './ShiftView';

/**
 * Колонки — его, все шестнадцать и в его порядке.
 *
 * Было девять, и они были свои: «Чеков», «Картой», «Расхождение». У него
 * смена расписана подробнее, и это не прихоть — по ней сверяют ящик: сколько
 * было на начало, сколько внесли, сколько изъяли, сколько осталось на конец.
 * Без этих четырёх колонок расхождение видно, а откуда оно взялось — нет.
 *
 * «Расхождение» осталось семнадцатым: у него такой колонки нет, но у нас
 * закрытие смены спрашивает пересчитанные наличные, и прятать результат
 * сверки было бы странно.
 */
const COLUMNS: Column[] = [
  { key: 'opened', title: 'Открыта', width: 170 },
  { key: 'closed', title: 'Закрыта', width: 170 },
  { key: 'cashier', title: 'Кассир', width: 150 },
  { key: 'register', title: 'Касса', width: 210 },
  { key: 'store', title: 'Магазин', width: 210 },
  { key: 'revenue', title: 'Выручка, руб', width: 160, numeric: true },
  { key: 'sales', title: 'Продажи', width: 110, numeric: true },
  { key: 'salesSum', title: 'Сумма продаж', width: 160, numeric: true },
  { key: 'cash', title: 'Наличные', width: 150, numeric: true },
  { key: 'cashless', title: 'Безналичные', width: 150, numeric: true },
  { key: 'returns', title: 'Возвраты', width: 120, numeric: true },
  { key: 'returnsSum', title: 'Сумма возврата', width: 170, numeric: true },
  { key: 'openMoney', title: 'Начало смены, руб', width: 190, numeric: true },
  { key: 'debit', title: 'Сумма всех взносов', width: 190, numeric: true },
  { key: 'credit', title: 'Сумма расходов', width: 180, numeric: true },
  { key: 'closeMoney', title: 'Конец смены, руб', width: 190, numeric: true },
  { key: 'diff', title: 'Расхождение, руб', width: 180, numeric: true },
];

/**
 * «Кассовый раздел / смены».
 *
 * Открытая смена стоит первой и подписана: пока она открыта, её числа —
 * X-отчёт и будут расти. Закрытая показывает расхождение — то единственное,
 * ради чего смену и закрывают.
 */
export function ShiftsTable() {
  const { db, refresh } = useDatabase();
  const [search, setSearch] = useState('');
  // Открытая смена — панель справа, поверх списка: так же, как товар.
  const [open2, setOpen2] = useState<number | null>(null);

  const shifts = useQuery((database) => listShifts(database));
  const registers = useQuery((database) => listRegisters(database));

  const filtered = search.trim()
    ? shifts.filter((report) =>
        `${report.register_name} ${report.shift.id}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      )
    : shifts;

  const free = registers.find((register) => register.open_shift_id === null);
  const open = shifts.find((report) => report.shift.closed_at === null);

  function start() {
    if (!free) {
      say('Все кассы заняты', 'Сначала закройте открытую смену.');
      return;
    }
    openShift(db, { registerId: free.id, cashier: 'waystea' });
    refresh();
  }

  function finish() {
    if (!open) return;
    // Пересчитанные наличные спрашиваем: смысл закрытия — сверить ящик
    // с чеками, а не переписать одно в другое.
    const answer = globalThis.prompt?.(
      `Сколько наличных в кассе «${open.register_name}»?\n` +
        `Ожидается ${formatMoneyWeb(open.expectedCash)}`,
      String(open.expectedCash / 100),
    );
    if (answer === null || answer === undefined) return;

    const counted = Math.round(Number(answer.replace(',', '.')) * 100);
    if (!Number.isFinite(counted)) {
      say('Проверьте сумму', 'Наличные — число.');
      return;
    }

    const report = closeShift(db, open.shift.id, counted);
    refresh();
    say(
      `Z-отчёт по смене №${report.shift.id}`,
      [
        `Чеков: ${report.receipts}`,
        `Выручка: ${formatMoneyWeb(report.revenue)}`,
        `Наличными: ${formatMoneyWeb(report.cash)}`,
        `Ожидалось в кассе: ${formatMoneyWeb(report.expectedCash)}`,
        `Пересчитано: ${formatMoneyWeb(counted)}`,
        `Расхождение: ${formatMoneyWeb(report.difference ?? 0)}`,
      ].join('\n'),
    );
  }

  return (
    <View style={styles.screen}>
      <Toolbar>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="поиск по кассе или номеру"
          width={306}
        />
        <ToolButton label="Открыть смену" tone="green" onPress={start} />
        <ToolButton
          label="Закрыть смену"
          tone="orangeOutline"
          onPress={open ? finish : undefined}
          soon={!open}
        />
        <ToolButton label="Фильтр" icon={<WebIcon.funnel color={web.text} />} soon />
      </Toolbar>

      {open2 !== null ? <ShiftView id={open2} onClose={() => setOpen2(null)} /> : null}

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <HeadRow columns={COLUMNS} lead={<View style={styles.statusHead} />} />

          <ScrollView>
            {filtered.map((report) => (
              <ShiftRow
                key={report.shift.id}
                report={report}
                onPress={() => setOpen2(report.shift.id)}
              />
            ))}

            {filtered.length === 0 ? (
              <Text style={styles.empty}>
                {search ? 'Ничего не нашлось' : 'Смен ещё не было — откройте первую'}
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

function ShiftRow({ report, onPress }: { report: ShiftReport; onPress: () => void }) {
  const isOpen = report.shift.closed_at === null;
  const { shift } = report;

  // Выручка — продажи за вычетом возвращённого. Сумма продаж — то же без
  // вычета: две разные колонки, и путать их нельзя.
  const revenue = report.revenue - report.returnsSum;

  const cells: (string | number)[] = [
    when(shift.opened_at),
    shift.closed_at ? when(shift.closed_at) : 'открыта',
    shift.cashier ?? '—',
    report.register_name,
    report.location_name ?? '—',
    formatMoneyWeb(revenue),
    report.receipts,
    formatMoneyWeb(report.revenue),
    formatMoneyWeb(report.cash),
    formatMoneyWeb(report.card + report.transfer),
    report.returns,
    formatMoneyWeb(report.returnsSum),
    formatMoneyWeb(shift.opening_cash),
    formatMoneyWeb(report.moneyIn),
    formatMoneyWeb(report.moneyOut),
    // Пока смена открыта, конца у неё нет — показываем то, что должно быть
    // в ящике на сейчас.
    formatMoneyWeb(shift.closing_cash ?? report.expectedCash),
    report.difference === null ? '—' : formatMoneyWeb(report.difference),
  ];

  return (
    <View style={styles.rowWrap}>
      <View style={[styles.stripe, { backgroundColor: isOpen ? web.green : web.stripeDoc }]} />

      <View style={styles.rowInner}>
        <Row onPress={onPress}>
          <View style={styles.status}>
            {isOpen ? (
              <WebIcon.lockOpen size={17} color={web.greenText} />
            ) : (
              <WebIcon.lockClosed size={17} color={web.textMuted} />
            )}
          </View>

          {COLUMNS.map((column, index) => (
            <Text
              key={column.key}
              style={[
                column.numeric ? webText.cellNumber : webText.cell,
                column.numeric && styles.right,
                { width: column.width },
                column.key === 'diff' && report.difference ? { color: web.danger } : null,
              ]}
              numberOfLines={1}
            >
              {cells[index]}
            </Text>
          ))}
        </Row>
      </View>
    </View>
  );
}

/** «8 августа, 18:06» — день и время одной строкой. */
function when(iso: string): string {
  return `${formatDay(iso.slice(0, 10))}, ${formatTime(iso)}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  statusHead: { width: 46 },
  rowWrap: { flexDirection: 'row' },
  stripe: { width: 4 },
  rowInner: { flex: 1 },
  status: { width: 42, alignItems: 'center' },
  right: { textAlign: 'right' },
  empty: { padding: 40, fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },
});
