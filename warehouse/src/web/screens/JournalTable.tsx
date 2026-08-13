import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { activeCount, JournalFilter, type FilterField, type FilterValue } from '../JournalFilter';
import { Column, HeadRow, Row, SearchBox, ToolButton, Toolbar } from '../Table';
import {
  entryTitle,
  formatDay,
  formatTime,
  groupByDay,
  journalOptions,
  listJournal,
  type JournalEntry,
  type JournalFilter as JournalFilterInput,
  type JournalKind,
} from '../../db/journal';
import { DOC_TYPES } from '../../domain/docTypes';
import { DOC_KIND_LABEL } from '../../domain/types';
import { formatMoneyWeb } from '../../domain/money';
import { useQuery } from '../../state/DatabaseProvider';
import { WebIcon } from '../../ui/icons';
import { web, webText, WEB_FONT } from '../../ui/webTheme';

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

/**
 * Цвет полоски слева.
 *
 * Взят из их таблицы видов документа, а не подобран: у каждого вида в
 * кабинете свой цвет, и по нему строку узнают, не читая названия.
 */
const STRIPE: Record<JournalEntry['kind'], string> = {
  sale: DOC_TYPES.sale.color,
  // Чек-возврат — та же операция, что документ «Возврат продажи», и цвет у
  // неё их же.
  refund: DOC_TYPES.sale_return.color,
  sale_return: DOC_TYPES.sale_return.color,
  purchase: DOC_TYPES.purchase.color,
  purchase_return: DOC_TYPES.purchase_return.color,
  stock_in: DOC_TYPES.stock_in.color,
  writeoff: DOC_TYPES.writeoff.color,
  transfer: DOC_TYPES.transfer.color,
  inventory: DOC_TYPES.inventory.color,
  adjustment: DOC_TYPES.adjustment.color,
};

/** «Движение товара» — журнал кабинета. */
export function JournalTable() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [values, setValues] = useState<Record<string, FilterValue>>({});

  // Отбор делает база, а не память: журнал бывает длинным, и фильтровать уже
  // отданные пятьсот строк значит показывать не то, что просили.
  const filter = useMemo<JournalFilterInput>(
    () => ({
      search,
      from: values.dateFrom as string | undefined,
      to: values.dateTo as string | undefined,
      sender: values.sender as string | undefined,
      receiver: values.receiver as string | undefined,
      author: values.author as string | undefined,
      kinds: values.kinds as JournalKind[] | undefined,
      paid: values.paid as 'paid' | 'unpaid' | undefined,
      status: values.status as 'posted' | 'draft' | undefined,
    }),
    [search, values],
  );

  const entries = useQuery((db) => listJournal(db, 500, filter), [filter]);
  const options = useQuery((db) => journalOptions(db));

  const fields: FilterField[] = [
    { key: 'date', label: 'Дата', kind: 'dates' },
    {
      key: 'sender',
      label: 'Отправитель',
      kind: 'select',
      options: options.senders.map((value) => ({ value, label: value })),
    },
    {
      key: 'receiver',
      label: 'Получатель',
      kind: 'select',
      options: options.receivers.map((value) => ({ value, label: value })),
    },
    {
      key: 'author',
      label: 'Автор',
      kind: 'select',
      options: options.authors.map((value) => ({ value, label: value })),
    },
    {
      key: 'paid',
      label: 'Оплата',
      kind: 'select',
      options: [
        { value: 'paid', label: 'Оплаченные' },
        { value: 'unpaid', label: 'Неоплаченные' },
      ],
    },
    {
      key: 'status',
      label: 'Статус',
      kind: 'select',
      options: [
        { value: 'posted', label: 'Проведенные' },
        { value: 'draft', label: 'Отложенные' },
      ],
    },
    {
      key: 'kinds',
      label: 'Тип',
      kind: 'checks',
      options: [
        { value: 'sale', label: 'Продажа' },
        { value: 'refund', label: 'Возврат продажи' },
        ...(Object.keys(DOC_KIND_LABEL) as (keyof typeof DOC_KIND_LABEL)[]).map((kind) => ({
          value: kind,
          label: DOC_KIND_LABEL[kind],
        })),
      ],
    },
  ];

  const active = activeCount(values);
  const groups = groupByDay(entries);

  return (
    <View style={styles.screen}>
      <Toolbar>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="поиск по номеру или комментарию"
          width={306}
        />
        <ToolButton
          label={active > 0 ? `Фильтр: ${active}` : 'Фильтр'}
          tone={active > 0 ? 'blueOutline' : 'plain'}
          icon={<WebIcon.funnel color={active > 0 ? web.link : web.text} />}
          onPress={() => setFilterOpen(true)}
        />
      </Toolbar>

      <JournalFilter
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        fields={fields}
        values={values}
        onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
        onReset={() => setValues({})}
      />

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
                      // Чек и складской документ — разные экраны: у чека есть
                      // оплата и возврат, у документа — контрагент и магазины.
                      router.push(
                        entry.kind === 'sale' || entry.kind === 'refund'
                          ? { pathname: '/sale/[id]', params: { id: String(entry.id) } }
                          : { pathname: '/doc/[id]', params: { id: String(entry.id) } },
                      );
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
            {/* Проведённый отмечен галочкой, отложенный — карандашом: у него
                это две разные иконки в той же колонке. */}
            {entry.posted ? (
              <WebIcon.done color={web.stripeSale} />
            ) : (
              <WebIcon.pencil color={web.textMuted} />
            )}
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
  day: { fontFamily: WEB_FONT, fontSize: 22, color: web.text, paddingHorizontal: 22, paddingTop: 20, paddingBottom: 10 },
  rowWrap: { flexDirection: 'row' },
  stripe: { width: 4 },
  rowInner: { flex: 1 },
  status: { width: 42, alignItems: 'center' },
  empty: { padding: 40, fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },
});
