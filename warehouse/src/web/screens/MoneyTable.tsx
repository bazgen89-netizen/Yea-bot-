import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../Translated';

import { DateBox, FilterBox } from '../FilterBox';
import { activeCount, JournalFilter, type FilterField, type FilterValue } from '../JournalFilter';
import { Column, HeadRow, Row, SearchBox, ToolButton, Toolbar } from '../Table';
import { MoneyDocumentDrawer } from './MoneyDocument';
import { PartyCard } from './PartyCard';
import {
  formatDay,
  formatTime,
  groupMoneyByDay,
  lastMoneyDay,
  listMoney,
  moneyOptions,
  moneyTitle,
  type MoneyEntry,
  type MoneyFilter as MoneyFilterInput,
} from '../../db/journal';
import { findCounterpartyByName } from '../../db/counterparties';
import type { MoneySource, MoneyType } from '../../db/money';
import { weekEndingAt } from '../../domain/calendar';
import { formatMoneyWeb } from '../../domain/money';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { WebIcon } from '../../ui/icons';
import { web, webText, WEB_FONT } from '../../ui/webTheme';

/** Поле «тип» строки отбора — те же три слова, что в кабинете. */
const TYPES = [
  { value: 'income', label: 'Приход' },
  { value: 'expense', label: 'Расход' },
  { value: 'transfer', label: 'Перевод' },
];

/**
 * Ширины — из их же таблицы стилей, как и в движении товара:
 * `.table.order-table tr td[data-name=…]` — статус 60, название 180,
 * дата 80, суммы 110, контрагент, счёт, категория и автор по 180.
 */
const COLUMNS: Column[] = [
  { key: 'order', title: 'Заказ', width: 180 },
  { key: 'time', title: 'Время', width: 80 },
  { key: 'income', title: 'Приход, руб', width: 110 },
  { key: 'expense', title: 'Расход, руб', width: 110 },
  { key: 'party', title: 'Контрагент', width: 180 },
  { key: 'account', title: 'Счёт', width: 180 },
  { key: 'category', title: 'Категория платежа', width: 180 },
  { key: 'author', title: 'Автор', width: 180 },
];

/** «Движение денег» — журнал кабинета. */
export function MoneyTable() {
  const router = useRouter();
  const { db } = useDatabase();
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  /** Открытый ордер — панелью поверх списка. */
  const [openDoc, setOpenDoc] = useState<{ id: number; source: MoneySource } | null>(null);
  /** Открытая карточка контрагента — панелью поверх списка. */
  const [partyOpen, setPartyOpen] = useState<number | null>(null);

  const last = useQuery((db) => lastMoneyDay(db));
  const [values, setValues] = useState<Record<string, FilterValue>>(() => {
    const { from, to } = weekEndingAt(last);
    return { dateFrom: from, dateTo: to };
  });

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

  /**
   * Что открывает строка.
   *
   * В их таблице (`js/components/money-table/_view.html`) на
   * `card.money_show({orderId})` ведёт **каждая** строка, а не только
   * заведённая руками: приход по чеку у них тоже ордер.
   *
   * И открывается он панелью поверх списка, а не отдельной страницей — в
   * присланном им адресе стоит `card/money/m/money/show/…`, и кусок `/m/`
   * это их «панель». Список остаётся слева: закрыл — и ты там же, где был,
   * с тем же отбором и тем же местом прокрутки.
   */
  const open = (entry: MoneyEntry) => setOpenDoc({ id: entry.id, source: entry.source });

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

      {openDoc ? (
        <MoneyDocumentDrawer
          id={openDoc.id}
          source={openDoc.source}
          onClose={() => setOpenDoc(null)}
        />
      ) : null}

      {partyOpen !== null ? (
        <PartyCard id={partyOpen} kind="customer" onClose={() => setPartyOpen(null)} />
      ) : null}

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
                  <MoneyRow
                    key={`${entry.source}${entry.id}`}
                    entry={entry}
                    onOpen={() => open(entry)}
                    onParty={() => {
                      // Карточка панелью, а не список и не телефонный экран:
                      // синее имя должно открывать именно карточку.
                      const party =
                        entry.counterparty_id ??
                        (entry.counterparty ? findCounterpartyByName(db, entry.counterparty) : null);

                      if (party) setPartyOpen(party);
                      else router.push('/counterparties');
                    }}
                    onAccount={() => router.push('/accounts')}
                    onAuthor={() => router.push('/staff')}
                  />
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

/**
 * Строка движения денег.
 *
 * Синие столбцы ведут ровно туда же, куда у него: контрагент — в его
 * карточку (`item.contragent.go()`), счёт — на счета
 * (`card.account_show`), автор — в сотрудников (`card.profile`). Сама
 * строка открывает документ.
 */
function MoneyRow({
  entry,
  onOpen,
  onParty,
  onAccount,
  onAuthor,
}: {
  entry: MoneyEntry;
  onOpen: () => void;
  onParty: () => void;
  onAccount: () => void;
  onAuthor: () => void;
}) {
  const [order, time, income, expense, party, account, category, author] = COLUMNS;
  const stripe = STRIPE[entry.type];

  return (
    <View style={styles.rowWrap}>
      <View style={[styles.stripe, { backgroundColor: stripe }]} />

      <View style={styles.rowInner}>
        <Row onPress={onOpen}>
          {/* Галочка синяя у всех, цветом отличается только полоска слева:
              так в их разметке — `ng-class="{red: credit, green: debit}"`
              на полоске и `color: '#4183C4'` на галочке. Я красил галочку
              в цвет полоски, и красная галочка у расхода читалась как
              «что-то не так с документом». */}
          <View style={styles.status}>
            <WebIcon.done color={web.link} />
          </View>

          <Text style={[webText.rowLink, { width: order.width }]} numberOfLines={1}>
            {moneyTitle(entry)}
          </Text>
          <Text style={[webText.rowNumber, { width: time.width }]}>
            {formatTime(entry.created_at)}
          </Text>
          <Text style={[webText.rowNumber, { width: income.width }]}>
            {entry.income ? formatMoneyWeb(entry.income) : ''}
          </Text>
          <Text style={[webText.rowNumber, { width: expense.width }]}>
            {entry.expense ? formatMoneyWeb(entry.expense) : ''}
          </Text>
          <Text
            accessibilityRole="link"
            style={[webText.rowLink, { width: party.width }]}
            numberOfLines={1}
            onPress={onParty}
          >
            {entry.counterparty}
          </Text>
          <Text
            accessibilityRole="link"
            style={[webText.rowLink, { width: account.width }]}
            numberOfLines={1}
            onPress={onAccount}
          >
            {entry.account}
          </Text>
          <Text style={[webText.rowCell, { width: category.width }]} numberOfLines={1}>
            {entry.category}
          </Text>
          {/* Автор — тот, кто провёл документ. Раньше здесь стояло слово
              «waystea» прямо в разметке, у всех строк одинаково. */}
          <Text
            accessibilityRole={entry.author ? 'link' : 'text'}
            style={[webText.rowLink, { width: author.width }]}
            numberOfLines={1}
            onPress={entry.author ? onAuthor : undefined}
          >
            {entry.author ?? ''}
          </Text>
        </Row>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  statusHead: { width: 60, justifyContent: 'center' },
  day: { fontFamily: WEB_FONT, fontSize: 20, color: web.text, paddingHorizontal: 22, paddingTop: 20, paddingBottom: 10 },
  rowWrap: { flexDirection: 'row', position: 'relative' },
  /** Их `i.indicator`: `top:4 bottom:4 left:4 width:4 radius:2`. */
  stripe: { position: 'absolute', top: 4, bottom: 4, left: 4, width: 4, borderRadius: 2 },
  rowInner: { flex: 1 },
  status: { width: 60, alignItems: 'center' },
  empty: { padding: 40, fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },
});
