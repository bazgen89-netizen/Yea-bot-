import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Column, HeadRow, Row, SearchBox, ToolButton, Toolbar } from '../Table';
import {
  entryTitle,
  formatDay,
  formatTime,
  groupByDay,
  listJournal,
  type JournalEntry,
} from '../../db/journal';
import { formatMoneyWeb } from '../../domain/money';
import { useQuery } from '../../state/DatabaseProvider';
import { WebIcon } from '../../ui/icons';
import { web, webText } from '../../ui/webTheme';

const COLUMNS: Column[] = [
  { key: 'doc', title: 'Документ', width: 250 },
  { key: 'time', title: 'Время', width: 100 },
  { key: 'positions', title: 'Позиций', width: 110 },
  { key: 'amount', title: 'Сумма', width: 160 },
  { key: 'paid', title: 'Оплаченные', width: 160 },
  { key: 'sender', title: 'Отправитель', width: 220 },
  { key: 'receiver', title: 'Получатель', width: 220 },
  { key: 'author', title: 'Автор', width: 180 },
];

/** Цвет полоски слева: продажи зелёные, возвраты красные, документы фиолетовые. */
const STRIPE: Record<JournalEntry['kind'], string> = {
  sale: web.stripeSale,
  refund: web.danger,
  purchase_return: web.danger,
  purchase: web.stripeDoc,
  stock_in: web.stripeDoc,
  writeoff: web.stripeDoc,
  transfer: web.stripeDoc,
  inventory: web.stripeDoc,
  adjustment: web.stripeDoc,
};

/** «Движение товара» — журнал кабинета. */
export function JournalTable() {
  const router = useRouter();
  const [search, setSearch] = useState('');

  const entries = useQuery((db) => listJournal(db));

  const filtered = search.trim()
    ? entries.filter((entry) =>
        entryTitle(entry).toLowerCase().includes(search.trim().toLowerCase()),
      )
    : entries;

  const groups = groupByDay(filtered);

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
        <ToolButton label="оплата" soon />
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
                  <EntryRow
                    key={`${entry.kind}${entry.id}`}
                    entry={entry}
                    onPress={() => {
                      if (entry.kind === 'sale' || entry.kind === 'refund') {
                        router.push({ pathname: '/sale/[id]', params: { id: String(entry.id) } });
                      }
                    }}
                  />
                ))}
              </View>
            ))}

            {groups.length === 0 ? (
              <Text style={styles.empty}>
                {search ? 'Ничего не нашлось' : 'Документов пока нет'}
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

function EntryRow({ entry, onPress }: { entry: JournalEntry; onPress: () => void }) {
  const [doc, time, positions, amount, paid, sender, receiver, author] = COLUMNS;

  return (
    <View style={styles.rowWrap}>
      <View style={[styles.stripe, { backgroundColor: STRIPE[entry.kind] }]} />

      <View style={styles.rowInner}>
        <Row onPress={onPress}>
          <View style={styles.status}>
            <WebIcon.done color={web.stripeSale} />
          </View>

          <Text style={[webText.link, { width: doc.width }]} numberOfLines={1}>
            {entryTitle(entry)}
          </Text>
          <Text style={[webText.cellNumber, { width: time.width }]}>
            {formatTime(entry.created_at)}
          </Text>
          <Text style={[webText.cellNumber, { width: positions.width }]}>{entry.positions}</Text>
          <Text style={[webText.cellNumber, { width: amount.width }]}>
            {entry.amount ? formatMoneyWeb(entry.amount) : '-'}
          </Text>
          <Text style={[webText.cellNumber, { width: paid.width }]}>
            {entry.paid ? formatMoneyWeb(entry.paid) : '-'}
          </Text>
          <Text style={[webText.link, { width: sender.width }]} numberOfLines={1}>
            {entry.sender ?? ''}
          </Text>
          <Text style={[webText.link, { width: receiver.width }]} numberOfLines={1}>
            {entry.receiver ?? ''}
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
  stripe: { width: 4 },
  rowInner: { flex: 1 },
  status: { width: 42, alignItems: 'center' },
  empty: { padding: 40, fontSize: 15, color: web.textMuted },
});
