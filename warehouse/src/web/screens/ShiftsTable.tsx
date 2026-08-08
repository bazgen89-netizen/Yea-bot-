import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Column, HeadRow, Row, SearchBox, ToolButton, Toolbar } from '../Table';
import { formatDay, formatTime } from '../../db/journal';
import { closeShift, listRegisters, listShifts, openShift, type ShiftReport } from '../../db/shifts';
import { formatMoneyWeb } from '../../domain/money';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { WebIcon } from '../../ui/icons';
import { say } from '../../ui/alert';
import { web, webText } from '../../ui/webTheme';

const COLUMNS: Column[] = [
  { key: 'shift', title: 'Смена', width: 150 },
  { key: 'register', title: 'Касса', width: 250 },
  { key: 'opened', title: 'Открыта', width: 190 },
  { key: 'closed', title: 'Закрыта', width: 190 },
  { key: 'receipts', title: 'Чеков', width: 100, numeric: true },
  { key: 'revenue', title: 'Выручка, руб', width: 170, numeric: true },
  { key: 'cash', title: 'Наличными, руб', width: 180, numeric: true },
  { key: 'card', title: 'Картой, руб', width: 170, numeric: true },
  { key: 'diff', title: 'Расхождение, руб', width: 190, numeric: true },
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

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <HeadRow columns={COLUMNS} lead={<View style={styles.statusHead} />} />

          <ScrollView>
            {filtered.map((report) => (
              <ShiftRow key={report.shift.id} report={report} />
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

function ShiftRow({ report }: { report: ShiftReport }) {
  const [shift, register, opened, closed, receipts, revenue, cash, card, diff] = COLUMNS;
  const isOpen = report.shift.closed_at === null;

  return (
    <View style={styles.rowWrap}>
      <View style={[styles.stripe, { backgroundColor: isOpen ? web.green : web.stripeDoc }]} />

      <View style={styles.rowInner}>
        <Row>
          <View style={styles.status}>
            {isOpen ? (
              <WebIcon.lockOpen size={17} color={web.greenText} />
            ) : (
              <WebIcon.lockClosed size={17} color={web.textMuted} />
            )}
          </View>

          <Text style={[webText.link, { width: shift.width }]}>№{report.shift.id}</Text>
          <Text style={[webText.cell, { width: register.width }]} numberOfLines={1}>
            {report.register_name}
          </Text>
          <Text style={[webText.cell, { width: opened.width }]}>
            {when(report.shift.opened_at)}
          </Text>
          <Text style={[webText.cell, { width: closed.width }]}>
            {report.shift.closed_at ? when(report.shift.closed_at) : 'открыта'}
          </Text>
          <Text style={[webText.cellNumber, styles.right, { width: receipts.width }]}>
            {report.receipts}
          </Text>
          <Text style={[webText.cellNumber, styles.right, { width: revenue.width }]}>
            {formatMoneyWeb(report.revenue)}
          </Text>
          <Text style={[webText.cellNumber, styles.right, { width: cash.width }]}>
            {formatMoneyWeb(report.cash)}
          </Text>
          <Text style={[webText.cellNumber, styles.right, { width: card.width }]}>
            {formatMoneyWeb(report.card)}
          </Text>
          <Text
            style={[
              webText.cellNumber,
              styles.right,
              { width: diff.width },
              report.difference ? { color: web.danger } : null,
            ]}
          >
            {report.difference === null ? '—' : formatMoneyWeb(report.difference)}
          </Text>
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
  empty: { padding: 40, fontSize: 15, color: web.textMuted },
});
