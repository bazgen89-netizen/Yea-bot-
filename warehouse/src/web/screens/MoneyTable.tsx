import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Column, HeadRow, Row, SearchBox, ToolButton, Toolbar } from '../Table';
import {
  formatDay,
  formatTime,
  groupMoneyByDay,
  listMoney,
  moneyTitle,
  type MoneyEntry,
} from '../../db/journal';
import { formatMoneyWeb } from '../../domain/money';
import { useQuery } from '../../state/DatabaseProvider';
import { WebIcon } from '../../ui/icons';
import { web, webText } from '../../ui/webTheme';

const COLUMNS: Column[] = [
  { key: 'order', title: 'Заказ', width: 230 },
  { key: 'time', title: 'Время', width: 100 },
  { key: 'income', title: 'Приход, руб', width: 160 },
  { key: 'expense', title: 'Расход, руб', width: 160 },
  { key: 'party', title: 'Контрагент', width: 230 },
  { key: 'account', title: 'Счёт', width: 240 },
  { key: 'category', title: 'Категория плате…', width: 220 },
  { key: 'author', title: 'Автор', width: 170 },
];

/** «Движение денег» — журнал кабинета. */
export function MoneyTable() {
  const [search, setSearch] = useState('');
  const entries = useQuery((db) => listMoney(db));

  const filtered = search.trim()
    ? entries.filter((entry) =>
        moneyTitle(entry).toLowerCase().includes(search.trim().toLowerCase()),
      )
    : entries;

  const groups = groupMoneyByDay(filtered);

  return (
    <View style={styles.screen}>
      <Toolbar>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="поиск по номеру или комментарию"
          width={306}
        />
        <ToolButton label="дата" soon />
        <ToolButton label="статус" soon />
        <ToolButton label="тип" soon />
        <ToolButton label="Фильтр" icon={<WebIcon.funnel color={web.text} />} soon />
      </Toolbar>

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <HeadRow columns={COLUMNS} lead={<View style={styles.statusHead} />} />

          <ScrollView>
            {groups.map((group) => (
              <View key={group.day}>
                <Text style={styles.day}>{formatDay(group.day)}</Text>
                {group.entries.map((entry) => (
                  <MoneyRow key={entry.id} entry={entry} />
                ))}
              </View>
            ))}

            {groups.length === 0 ? (
              <Text style={styles.empty}>
                {search ? 'Ничего не нашлось' : 'Движения денег пока нет'}
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

function MoneyRow({ entry }: { entry: MoneyEntry }) {
  const [order, time, income, expense, party, account, category, author] = COLUMNS;

  return (
    <View style={styles.rowWrap}>
      <View style={styles.stripe} />

      <View style={styles.rowInner}>
        <Row>
          <View style={styles.status}>
            <WebIcon.done color={web.stripeMoney} />
          </View>

          <Text style={[webText.link, { width: order.width }]} numberOfLines={1}>
            {moneyTitle(entry)}
          </Text>
          <Text style={[webText.cellNumber, { width: time.width }]}>
            {formatTime(entry.created_at)}
          </Text>
          <Text style={[webText.cellNumber, { width: income.width }]}>
            {entry.income ? formatMoneyWeb(entry.income) : ''}
          </Text>
          <Text style={[webText.cellNumber, { width: expense.width }]}>
            {entry.expense ? formatMoneyWeb(entry.expense) : ''}
          </Text>
          <Text style={[webText.link, { width: party.width }]} numberOfLines={1}>
            {entry.counterparty}
          </Text>
          <Text style={[webText.link, { width: account.width }]} numberOfLines={1}>
            {entry.account}
          </Text>
          <Text style={[webText.cell, { width: category.width }]} numberOfLines={1}>
            {entry.category}
          </Text>
          <Text style={[webText.link, { width: author.width }]} numberOfLines={1}>
            waystea
          </Text>
        </Row>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  statusHead: { width: 46 },
  day: { fontSize: 22, color: web.text, paddingHorizontal: 22, paddingTop: 20, paddingBottom: 10 },
  rowWrap: { flexDirection: 'row' },
  stripe: { width: 4, backgroundColor: web.stripeMoney },
  rowInner: { flex: 1 },
  status: { width: 42, alignItems: 'center' },
  empty: { padding: 40, fontSize: 15, color: web.textMuted },
});
