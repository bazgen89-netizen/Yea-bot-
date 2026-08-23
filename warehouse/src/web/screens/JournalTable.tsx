import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../Translated';

import { DateBox, FilterBox } from '../FilterBox';
import { activeCount, JournalFilter, type FilterField, type FilterValue } from '../JournalFilter';
import { SaleDocumentDrawer } from './SaleDocument';
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
import { listLocations } from '../../db/locations';
import { DOC_TYPES } from '../../domain/docTypes';
import { DOC_KIND_LABEL } from '../../domain/types';
import { formatMoneyWeb } from '../../domain/money';
import { useQuery } from '../../state/DatabaseProvider';
import { WebIcon } from '../../ui/icons';
import { web, webText, WEB_FONT } from '../../ui/webTheme';

const COLUMNS: Column[] = [
  { key: 'doc', title: 'Документ', width: 230 },
  { key: 'time', title: 'Время', width: 90 },
  { key: 'positions', title: 'Позиций', width: 100 },
  { key: 'amount', title: 'Сумма', width: 130 },
  // Узкая колонка со значком «%»: у него он стоит сразу за суммой и
  // отмечает документы, где была скидка.
  { key: 'discount', title: '', width: 40 },
  { key: 'paid', title: 'Оплаченные', width: 150 },
  { key: 'sender', title: 'Отправитель', width: 210 },
  { key: 'receiver', title: 'Получатель', width: 210 },
  { key: 'author', title: 'Автор', width: 160 },
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

/** Неделя, в которой мы сейчас: с понедельника по воскресенье. */
function thisWeek(): { from: string; to: string } {
  const day = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };

  const from = new Date();
  from.setDate(from.getDate() - ((from.getDay() + 6) % 7));

  const to = new Date(from);
  to.setDate(to.getDate() + 6);

  return { from: day(from), to: day(to) };
}

/** Что стоит в поле «статус» строки отбора. */
const STATUS = [
  { value: 'posted', label: 'Проведенные' },
  { value: 'draft', label: 'Отложенные' },
];

/** Поле «оплата». */
const PAID = [
  { value: 'paid', label: 'Оплаченные' },
  { value: 'unpaid', label: 'Неоплаченные' },
];

/** Поле «тип» — виды документов, как они названы в кабинете. */
const KIND_OPTIONS = [
  { value: 'sale', label: 'Продажа' },
  { value: 'refund', label: 'Возврат продажи' },
  ...(Object.keys(DOC_KIND_LABEL) as (keyof typeof DOC_KIND_LABEL)[]).map((kind) => ({
    value: kind,
    label: DOC_KIND_LABEL[kind],
  })),
];

/** Подпись поля «тип»: один вид — его название, несколько — сколько их. */
function typeLabel(kinds?: string[]): string | undefined {
  if (!kinds || kinds.length === 0) return undefined;
  if (kinds.length === 1) return KIND_OPTIONS.find((item) => item.value === kinds[0])?.label;

  return `Выбрано: ${kinds.length}`;
}

/** «Движение товара» — журнал кабинета. */
export function JournalTable() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  /**
   * Открытый чек — панелью поверх журнала, как у него.
   *
   * Он кликает документ в списке, и список остаётся слева: закрыл панель — и
   * ты там же, где был. Раньше мы уходили на отдельную страницу, и журнал
   * пропадал целиком вместе с отбором и местом прокрутки.
   */
  const [openSale, setOpenSale] = useState<number | null>(null);
  /**
   * Отбор. Дата с самого начала стоит неделей — как в его журнале: там в
   * поле «дата» написано «17 авг — 23 авг», и список открывается уже
   * отобранным. Иначе журнал на сорок пять тысяч документов открывается
   * всей историей сразу, и найти вчерашний чек тяжелее, чем нужно.
   */
  const [values, setValues] = useState<Record<string, FilterValue>>(() => {
    const { from, to } = thisWeek();
    return { dateFrom: from, dateTo: to };
  });

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
  const stores = useQuery((db) => listLocations(db));
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
  const set = (key: string, value: FilterValue) =>
    setValues((current) => ({ ...current, [key]: value }));

  /**
   * Куда ведут синие строки таблицы.
   *
   * Магазин — в список магазинов, покупатель — в справочник клиентов с
   * открытой карточкой, автор — в сотрудников. Это его переходы: в разметке
   * их журнала у тех же полей стоят `ui-sref` на карточку магазина, клиента
   * и профиль сотрудника.
   */
  const open = (what: 'sender' | 'receiver' | 'author', entry: JournalEntry) => {
    if (what === 'author') {
      router.push('/staff');
      return;
    }

    const name = what === 'sender' ? entry.sender : entry.receiver;
    if (!name) return;

    // Отправитель у чека — магазин, у прихода — поставщик. Отличаем по тому,
    // есть ли такой магазин: искать по названию здесь честнее, чем гадать по
    // виду документа, — у перемещения магазины с обеих сторон.
    const store = stores.find((location: { name: string }) => location.name === name);
    if (store) {
      router.push('/stores');
      return;
    }

    router.push({ pathname: '/counterparties', params: { search: name } });
  };

  return (
    <View style={styles.screen}>
      <Toolbar>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="поиск по номеру или комментарию"
          width={306}
        />

        {/* Отбор стоит строкой над таблицей, как в кабинете: дата, статус,
            оплата, тип. За кнопкой «Фильтр» остаётся то, чему в строке
            места нет — отправитель, получатель, автор. */}
        <DateBox
          from={values.dateFrom as string | undefined}
          to={values.dateTo as string | undefined}
          onChange={(key, value) =>
            set(key === 'from' ? 'dateFrom' : 'dateTo', value)
          }
          onClear={() => {
            set('dateFrom', undefined);
            set('dateTo', undefined);
          }}
        />
        <FilterBox
          label="статус"
          placeholder="Выберите"
          value={STATUS.find((item) => item.value === values.status)?.label}
          options={STATUS}
          onPick={(value) => set('status', value)}
          onClear={() => set('status', undefined)}
        />
        <FilterBox
          label="оплата"
          placeholder="Выберите"
          value={PAID.find((item) => item.value === values.paid)?.label}
          options={PAID}
          onPick={(value) => set('paid', value)}
          onClear={() => set('paid', undefined)}
        />
        <FilterBox
          label="тип"
          placeholder="введите"
          width={196}
          value={typeLabel(values.kinds as string[] | undefined)}
          options={KIND_OPTIONS}
          onPick={(value) => set('kinds', value ? [value] : undefined)}
          onClear={() => set('kinds', undefined)}
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
                  <EntryRow
                    key={`${entry.kind}${entry.id}`}
                    entry={entry}
                    onOpen={open}
                    onPress={() => {
                      // Чек открывается панелью поверх журнала, складской
                      // документ — своей страницей: у него там контрагент,
                      // магазины и правка строк, и на панель это не садится.
                      if (entry.kind === 'sale' || entry.kind === 'refund') {
                        setOpenSale(Number(entry.id));
                        return;
                      }

                      router.push({ pathname: '/doc/[id]', params: { id: String(entry.id) } });
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

      {openSale !== null ? (
        <SaleDocumentDrawer id={openSale} onClose={() => setOpenSale(null)} />
      ) : null}
    </View>
  );
}

function EntryRow({
  entry,
  onPress,
  onOpen,
}: {
  entry: JournalEntry;
  onPress: () => void;
  onOpen: (what: 'sender' | 'receiver' | 'author', entry: JournalEntry) => void;
}) {
  const [doc, time, positions, amount, discount, paid, sender, receiver, author] = COLUMNS;

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

          {/* Название документа и, если есть комментарий, значок рядом —
              как у него: по значку видно, что в документе есть заметка. */}
          <View style={[styles.docCell, { width: doc.width }]}>
            <Text style={webText.link} numberOfLines={1}>
              {entryTitle(entry)}
            </Text>
            {entry.note ? <Text style={styles.note}>💬</Text> : null}
          </View>

          <Text style={[webText.cellNumber, { width: time.width }]}>
            {formatTime(entry.created_at)}
          </Text>
          <Text style={[webText.cellNumber, { width: positions.width }]}>{entry.positions}</Text>
          {/* Ноль — это ноль, а не прочерк: у него чек на 0.00 так и
              подписан, и прочерк вместо суммы читался бы как «неизвестно». */}
          <Text style={[webText.cellNumber, { width: amount.width }]}>
            {formatMoneyWeb(entry.amount)}
          </Text>

          {/* Значок «%» — у чеков, как в кабинете: там он стоит в этой
              колонке у каждой продажи. У складских документов скидки нет,
              и колонка пустая. Сама скидка подписана рядом для чтения с
              экрана: глазами её видно в самом документе. */}
          <View style={[styles.discount, { width: discount.width }]}>
            {entry.kind === 'sale' || entry.kind === 'refund' ? (
              <Text
                style={styles.percent}
                accessibilityLabel={
                  entry.discount ? `Скидка ${formatMoneyWeb(entry.discount)}` : 'Без скидки'
                }
              >
                %
              </Text>
            ) : null}
          </View>

          {/* Прочерк — только у складских документов: оплаты у них нет
              вовсе, а ноль означал бы «не оплачено». */}
          <Text style={[webText.cellNumber, { width: paid.width }]}>
            {entry.paid === null ? '-' : formatMoneyWeb(entry.paid)}
          </Text>
          {/* Синее — значит нажимаемое. В его кабинете отправитель ведёт в
              карточку магазина, получатель — в карточку клиента, автор — в
              профиль сотрудника; это прямо в разметке их экрана
              (`ui-sref="…card.profile"`). Синий текст, который никуда не
              ведёт, обещает переход, которого нет. */}
          <Text
            accessibilityRole="link"
            style={[webText.link, { width: sender.width }]}
            numberOfLines={1}
            onPress={() => onOpen('sender', entry)}
          >
            {entry.sender ?? ''}
          </Text>
          <Text
            accessibilityRole="link"
            style={[webText.link, { width: receiver.width }]}
            numberOfLines={1}
            onPress={() => onOpen('receiver', entry)}
          >
            {entry.receiver ?? ''}
          </Text>
          {/* Автор — тот, кто пробил документ. Раньше здесь стояло слово
              «waystea» прямо в разметке, и у чеков «Чайного бара» и
              «Черёмушек» тоже значился владелец. */}
          <Text
            accessibilityRole="link"
            style={[webText.link, { width: author.width }]}
            numberOfLines={1}
            onPress={() => onOpen('author', entry)}
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
  statusHead: { width: 46, justifyContent: 'center' },
  docCell: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  note: { fontSize: 12 },
  discount: { alignItems: 'center' },
  percent: { fontFamily: WEB_FONT, fontSize: 14, fontWeight: '700', color: web.link },
  day: { fontFamily: WEB_FONT, fontSize: 22, color: web.text, paddingHorizontal: 22, paddingTop: 20, paddingBottom: 10 },
  rowWrap: { flexDirection: 'row' },
  stripe: { width: 4 },
  rowInner: { flex: 1 },
  status: { width: 42, alignItems: 'center' },
  empty: { padding: 40, fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },
});
