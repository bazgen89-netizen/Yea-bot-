import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../Translated';

import { DateBox, FilterBox } from '../FilterBox';
import { activeCount, JournalFilter, type FilterField, type FilterValue } from '../JournalFilter';
import { Column, HeadRow, Row, SearchBox, ToolButton, Toolbar } from '../Table';
import {
  formatDay,
  formatTime,
  groupMoneyByDay,
  listMoney,
  moneyOptions,
  moneyTitle,
  type MoneyEntry,
  type MoneyFilter as MoneyFilterInput,
} from '../../db/journal';
import type { MoneyType } from '../../db/money';
import { formatMoneyWeb } from '../../domain/money';
import { useQuery } from '../../state/DatabaseProvider';
import { WebIcon } from '../../ui/icons';
import { web, webText, WEB_FONT } from '../../ui/webTheme';

/** Поле «тип» строки отбора — те же три слова, что в кабинете. */
const TYPES = [
  { value: 'income', label: 'Приход' },
  { value: 'expense', label: 'Расход' },
  { value: 'transfer', label: 'Перевод' },
];

const COLUMNS: Column[] = [
  { key: 'order', title: 'Заказ', width: 210 },
  { key: 'time', title: 'Время', width: 90 },
  { key: 'income', title: 'Приход, руб', width: 150 },
  { key: 'expense', title: 'Расход, руб', width: 150 },
  { key: 'party', title: 'Контрагент', width: 210 },
  { key: 'account', title: 'Счёт', width: 210 },
  { key: 'category', title: 'Категория плате…', width: 190 },
  { key: 'author', title: 'Автор', width: 150 },
];

/** «Движение денег» — журнал кабинета. */
export function MoneyTable() {
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [values, setValues] = useState<Record<string, FilterValue>>({});

  const filter = useMemo<MoneyFilterInput>(
    () => ({
      search,
      from: values.dateFrom as string | undefined,
      to: values.dateTo as string | undefined,
      account: values.account as string | undefined,
      counterparty: values.counterparty as string | undefined,
      author: values.author as string | undefined,
      category: values.category as string | undefined,
      types: values.types as MoneyType[] | undefined,
    }),
    [search, values],
  );

  const entries = useQuery((db) => listMoney(db, 500, filter), [filter]);
  const options = useQuery((db) => moneyOptions(db));

  const fields: FilterField[] = [
    { key: 'date', label: 'Дата', kind: 'dates' },
    {
      key: 'account',
      label: 'Счёт',
      kind: 'select',
      options: options.accounts.map((value) => ({ value, label: value })),
    },
    {
      key: 'counterparty',
      label: 'Контрагент',
      kind: 'select',
      options: options.counterparties.map((value) => ({ value, label: value })),
    },
    {
      key: 'author',
      label: 'Автор',
      kind: 'select',
      options: options.authors.map((value) => ({ value, label: value })),
    },
    {
      key: 'category',
      label: 'Категория платежа',
      kind: 'select',
      options: options.categories.map((value) => ({ value, label: value })),
    },
    {
      key: 'types',
      label: 'Тип',
      kind: 'checks',
      options: [
        { value: 'income', label: 'Приход' },
        { value: 'expense', label: 'Расход' },
        { value: 'transfer', label: 'Перевод' },
      ],
    },
  ];

  const active = activeCount(values);
  const groups = groupMoneyByDay(entries);
  const set = (key: string, value: FilterValue) =>
    setValues((current) => ({ ...current, [key]: value }));

  return (
    <View style={styles.screen}>
      <Toolbar>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="поиск по номеру или комментарию"
          width={306}
        />

        {/* Строка отбора, как в кабинете: дата и тип. Поля «оплата» здесь
            нет — его нет и у него. Поля «статус» тоже нет, хотя у него оно
            есть: денежный документ у нас всегда проведён, отложенных не
            бывает, и это поле не отбирало бы ничего. Рисовать кнопку,
            которая ничего не делает, хуже, чем не рисовать её. */}
        <DateBox
          from={values.dateFrom as string | undefined}
          to={values.dateTo as string | undefined}
          onChange={(key, value) => set(key === 'from' ? 'dateFrom' : 'dateTo', value)}
          onClear={() => {
            set('dateFrom', undefined);
            set('dateTo', undefined);
          }}
        />
        <FilterBox
          label="тип"
          placeholder="Выберите"
          value={TYPES.find((item) => item.value === (values.types as string[])?.[0])?.label}
          options={TYPES}
          onPick={(value) => set('types', value ? [value] : undefined)}
          onClear={() => set('types', undefined)}
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
          <HeadRow
            columns={COLUMNS}
            lead={
              <View style={styles.statusHead}>
                <Text style={webText.column}>Статус</Text>
              </View>
            }
          />

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

/** Полоска слева: приход зелёный, расход красный, перевод синий. */
const STRIPE: Record<MoneyEntry['type'], string> = {
  income: web.stripeMoney,
  expense: web.danger,
  transfer: web.link,
};

function MoneyRow({ entry }: { entry: MoneyEntry }) {
  const [order, time, income, expense, party, account, category, author] = COLUMNS;
  const stripe = STRIPE[entry.type];

  return (
    <View style={styles.rowWrap}>
      <View style={[styles.stripe, { backgroundColor: stripe }]} />

      <View style={styles.rowInner}>
        <Row>
          <View style={styles.status}>
            <WebIcon.done color={stripe} />
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
          {/* Автор — тот, кто провёл документ. Раньше здесь стояло слово
              «waystea» прямо в разметке, у всех строк одинаково. */}
          <Text style={[webText.link, { width: author.width }]} numberOfLines={1}>
            {entry.author ?? ''}
          </Text>
        </Row>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  statusHead: { width: 46, justifyContent: 'center' },
  day: { fontFamily: WEB_FONT, fontSize: 22, color: web.text, paddingHorizontal: 22, paddingTop: 20, paddingBottom: 10 },
  rowWrap: { flexDirection: 'row' },
  stripe: { width: 4 },
  rowInner: { flex: 1 },
  status: { width: 42, alignItems: 'center' },
  empty: { padding: 40, fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },
});
