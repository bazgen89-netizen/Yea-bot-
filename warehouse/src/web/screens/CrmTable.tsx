import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '../Translated';

import { Dropdown } from '../Dropdown';
import { CELL, HeadRow, Pager, Row, SearchBox, ToolButton, Toolbar } from '../Table';
import { PartyCard } from './PartyCard';
import {
  addTask,
  allTags,
  crmClients,
  filterClients,
  listTasks,
  removeTask,
  setTaskDone,
  tagsOf,
  today,
  type CrmClient,
} from '../../db/crm';
import { crmCsv } from '../../db/export';
import {
  SEGMENTS,
  SEGMENT_LABEL,
  SEGMENT_NOTE,
  whatsappLink,
  сроком,
  type Segment,
} from '../../domain/crm';
import { formatMoney } from '../../domain/money';
import { pluralize } from '../../domain/plural';
import type { Id } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { saveFile } from '../../ui/download';
import { WebIcon } from '../../ui/icons';
import { web, webText, WEB_FONT } from '../../ui/webTheme';
import { confirm, say } from '../../ui/alert';

const PAGE_SIZE = 50;

type Tab = 'clients' | 'tasks';

/**
 * CRM: те же клиенты, что и в справочнике, но разложенные по тому, когда они
 * были в последний раз.
 *
 * Отдельный раздел, а не колонка в справочнике, потому что вопрос другой. В
 * справочник заходят, чтобы найти человека, которого уже знают по имени; сюда
 * — чтобы узнать, кого потеряли и кому написать сегодня. Одним списком эти
 * два вопроса не решаются: в первом нужен поиск, во втором — порядок.
 */
export function CrmTable() {
  const [tab, setTab] = useState<Tab>('clients');

  return (
    <View style={styles.screen}>
      <View style={styles.tabs}>
        {(
          [
            ['clients', 'Клиенты'],
            ['tasks', 'Дела'],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === value }}
            onPress={() => setTab(value)}
            style={[styles.tab, tab === value && styles.tabOn]}
          >
            <Text style={[styles.tabLabel, tab === value && styles.tabLabelOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'clients' ? <Clients /> : <Tasks />}
    </View>
  );
}

function Clients() {
  const { db } = useDatabase();

  const [segment, setSegment] = useState<Segment | 'all' | 'vip'>('sleeping');
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [withPhone, setWithPhone] = useState(false);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Id | null>(null);

  const all = useQuery((database) => crmClients(database), []);
  const tags = useMemo(() => allTags(all), [all]);

  const found = useMemo(
    () => filterClients(all, { segment, search, tag, withPhone }),
    [all, segment, search, tag, withPhone],
  );

  const pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const shown = found.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  /** Сколько человек в каждой группе — числа на плитках наверху. */
  const counts = useMemo(() => {
    const по: Record<string, number> = { all: all.length, vip: 0 };
    for (const s of SEGMENTS) по[s] = 0;
    for (const one of all) {
      по[one.standing.segment] += 1;
      if (one.vip) по.vip += 1;
    }
    return по;
  }, [all]);

  /** Сколько денег стоит за отобранными — то, что можно вернуть. */
  const деньги = useMemo(() => found.reduce((sum, one) => sum + one.purchases, 0), [found]);

  function перейти(куда: Segment | 'all' | 'vip') {
    setSegment(куда);
    setPage(1);
  }

  return (
    <>
      <View style={styles.cards}>
        {(['sleeping', 'regular', 'new', 'lost', 'none'] as Segment[]).map((one) => (
          <Tile
            key={one}
            label={SEGMENT_LABEL[one]}
            value={counts[one] ?? 0}
            note={SEGMENT_NOTE[one]}
            on={segment === one}
            tone={one === 'sleeping' ? 'warn' : undefined}
            onPress={() => перейти(one)}
          />
        ))}
        <Tile
          label="Крупные"
          value={counts.vip}
          note="Верхние 10 % по выручке. Бывают и постоянными, и пропавшими"
          on={segment === 'vip'}
          tone="good"
          onPress={() => перейти('vip')}
        />
        <Tile
          label="Все"
          value={counts.all}
          note="Вся клиентская база"
          on={segment === 'all'}
          onPress={() => перейти('all')}
        />
      </View>

      <Toolbar>
        <SearchBox
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="имя, телефон или метка"
          width={278}
        />
        <Dropdown
          value={tag || '—'}
          onChange={(value) => {
            setTag(value === '—' ? '' : value);
            setPage(1);
          }}
          options={[
            { value: '—', label: 'Все метки' },
            ...tags.map((one) => ({ value: one, label: one })),
          ]}
          width={170}
          label="Метка"
        />
        <ToolButton
          label={withPhone ? '✓ Только с телефоном' : 'Только с телефоном'}
          tone={withPhone ? 'green' : undefined}
          onPress={() => {
            setWithPhone((was) => !was);
            setPage(1);
          }}
        />
        <Text style={styles.total}>
          Найдено {found.length} · за ними {formatMoney(деньги)} ₽
        </Text>
        <ToolButton
          label="Скачать в Excel"
          icon={<WebIcon.excel color={web.text} />}
          onPress={() => {
            // Выгружается ровно то, что на экране: список «кто не вернулся»
            // за тем и выгружают, чтобы обзвонить именно его.
            void saveFile(
              `CRM ${SEGMENT_LABEL[segment as Segment] ?? 'все'} ${today()}.csv`,
              crmCsv(found),
              'text/csv;charset=utf-8',
            );
          }}
        />
      </Toolbar>

      <Text style={styles.note}>{noteFor(segment)}</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator style={styles.table}>
        <View style={styles.tableInner}>
          <HeadRow
            celled
            columns={[
              { key: 'name', title: 'Клиент', width: 240 },
              { key: 'tags', title: 'Метки', width: 150 },
              { key: 'phone', title: 'Телефон', width: 150 },
              { key: 'purchases', title: 'Купил на, ₽', width: 130, numeric: true },
              { key: 'receipts', title: 'Чеков', width: 80, numeric: true },
              { key: 'last', title: 'Последняя покупка', width: 160 },
              { key: 'cadence', title: 'Ходит раз в', width: 120, numeric: true },
              { key: 'overdue', title: 'Опоздал на', width: 120, numeric: true },
              { key: 'crm', title: 'Заметки и дела', width: 140 },
              { key: 'write', title: '', width: 120 },
            ]}
          />

          <ScrollView style={styles.body}>
            {shown.map((one) => (
              <ClientRow key={one.id} client={one} onOpen={() => setOpen(one.id)} />
            ))}

            {shown.length === 0 ? (
              <Text style={styles.empty}>
                {search || tag || withPhone
                  ? 'Ничего не нашлось — попробуйте снять отбор'
                  : 'В этой группе пока никого'}
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </ScrollView>

      <Pager page={current} pages={pages} onPage={setPage} />

      {open !== null ? (
        <PartyCard id={open} kind="customer" onClose={() => setOpen(null)} />
      ) : null}
    </>
  );
}

function ClientRow({ client, onOpen }: { client: CrmClient; onOpen: () => void }) {
  const ссылка = whatsappLink(client.phone, приветствие(client));

  return (
    <Row onPress={onOpen} celled>
      <View style={[styles.nameCell, { width: 240 }]}>
        <WebIcon.parties size={15} color={web.link} />
        <Text style={webText.rowLink} numberOfLines={2}>
          {client.name}
        </Text>
        {client.vip ? <Text style={styles.vip}>крупный</Text> : null}
      </View>

      <View style={[styles.cell, { width: 150 }]}>
        <View style={styles.tags}>
          {tagsOf(client.tags).map((one) => (
            <Text key={one} style={styles.tag}>
              {one}
            </Text>
          ))}
        </View>
      </View>

      <Cell width={150} link>
        {client.phone ?? '—'}
      </Cell>
      <Cell width={130} numeric>
        {formatMoney(client.purchases)}
      </Cell>
      <Cell width={80} numeric>
        {String(client.receipts)}
      </Cell>
      <Cell width={160}>{сроком(client.standing.idle)}</Cell>
      <Cell width={120} numeric>
        {client.receipts ? `${client.standing.cadence} дн.` : '—'}
      </Cell>
      <Cell width={120} numeric warn={client.standing.overdue > 0}>
        {client.standing.overdue > 0 ? `${client.standing.overdue} дн.` : '—'}
      </Cell>
      <Cell width={140}>
        {[
          client.notes ? `${client.notes} зам.` : '',
          client.tasks ? `${client.tasks} дел` : '',
        ]
          .filter(Boolean)
          .join(' · ') || '—'}
      </Cell>

      <View style={[styles.cell, { width: 120 }]}>
        {ссылка ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Написать ${client.name} в WhatsApp`}
            onPress={() => void Linking.openURL(ссылка)}
            style={styles.write}
          >
            <Text style={styles.writeLabel}>Написать</Text>
          </Pressable>
        ) : (
          <Text style={styles.noPhone}>нет телефона</Text>
        )}
      </View>
    </Row>
  );
}

function Cell({
  width,
  numeric,
  link,
  warn,
  children,
}: {
  width: number;
  numeric?: boolean;
  link?: boolean;
  warn?: boolean;
  children: string;
}) {
  return (
    <View style={[styles.cell, { width }]}>
      <Text
        style={[
          link ? webText.rowLink : numeric ? webText.rowNumber : webText.rowCell,
          numeric && styles.right,
          warn && styles.warnText,
        ]}
        numberOfLines={2}
      >
        {children}
      </Text>
    </View>
  );
}

/**
 * Дела: список на сегодня и всё остальное.
 *
 * Дело можно завести и не привязывая к человеку — «заказать коробки» тоже
 * дело, и заводить ради него карточку клиента никто не станет.
 */
function Tasks() {
  const { db, refresh } = useDatabase();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(today());
  const [done, setDone] = useState(false);

  const tasks = useQuery(
    (database) => listTasks(database, { state: done ? 'done' : 'open' }),
    [done],
  );

  const сегодня = today();

  function завести() {
    if (!title.trim()) {
      say('Нужно название', 'Без названия дело потом не понять.');
      return;
    }

    try {
      addTask(db, { title, due });
    } catch (error) {
      say('Не сохранилось', String((error as Error).message));
      return;
    }

    setTitle('');
    refresh();
  }

  return (
    <>
      <View style={styles.newTask}>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Что сделать — «позвонить Никите про пуэр»"
          placeholderTextColor={web.textMuted}
          style={styles.newTaskInput}
          onSubmitEditing={завести}
          returnKeyType="done"
        />
        <TextInput
          value={due}
          onChangeText={setDue}
          placeholder="ГГГГ-ММ-ДД"
          placeholderTextColor={web.textMuted}
          style={styles.newTaskDate}
        />
        <ToolButton label="Добавить" tone="green" onPress={завести} />
        <ToolButton
          label={done ? 'Показать невыполненные' : 'Показать выполненные'}
          onPress={() => setDone((was) => !was)}
        />
      </View>

      <ScrollView style={styles.body}>
        {tasks.map((task) => {
          const горит = !task.done_at && task.due_date <= сегодня;

          return (
            <View key={task.id} style={styles.task}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: Boolean(task.done_at) }}
                accessibilityLabel={task.title}
                onPress={() => {
                  setTaskDone(db, task.id, !task.done_at);
                  refresh();
                }}
                style={[styles.box, task.done_at ? styles.boxOn : null]}
              >
                <Text style={styles.boxMark}>{task.done_at ? '✓' : ''}</Text>
              </Pressable>

              <View style={styles.taskBody}>
                <Text style={[styles.taskTitle, task.done_at ? styles.taskDone : null]}>
                  {task.title}
                </Text>
                <Text style={styles.taskNote}>
                  {[
                    датой(task.due_date),
                    task.client_name ?? '',
                    task.client_phone ?? '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>

              {горит ? <Text style={styles.due}>пора</Text> : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Удалить дело «${task.title}»`}
                onPress={() =>
                  confirm('Удалить дело?', task.title, 'Удалить', () => {
                    removeTask(db, task.id);
                    refresh();
                  })
                }
                style={styles.remove}
              >
                <Text style={styles.removeLabel}>×</Text>
              </Pressable>
            </View>
          );
        })}

        {tasks.length === 0 ? (
          <Text style={styles.empty}>
            {done ? 'Выполненных дел пока нет' : 'Дел нет. Заведите первое — строкой выше'}
          </Text>
        ) : null}
      </ScrollView>
    </>
  );
}

function Tile({
  label,
  value,
  note,
  on,
  tone,
  onPress,
}: {
  label: string;
  value: number;
  note: string;
  on: boolean;
  tone?: 'warn' | 'good';
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${label}: ${value}. ${note}`}
      onPress={onPress}
      style={[styles.tile, on && styles.tileOn]}
    >
      <Text
        style={[
          styles.tileValue,
          tone === 'warn' && styles.warnText,
          tone === 'good' && styles.goodText,
        ]}
      >
        {value}
      </Text>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileNote} numberOfLines={3}>
        {note}
      </Text>
    </Pressable>
  );
}

/** Пояснение под панелью — чтобы группа не была просто словом. */
function noteFor(segment: Segment | 'all' | 'vip'): string {
  if (segment === 'vip') return 'Верхние 10 % по выручке за всё время.';
  if (segment === 'all') return 'Вся клиентская база, кроме «Розничного покупателя».';
  return SEGMENT_NOTE[segment];
}

/** «2026-09-15» → «15 сентября». */
function датой(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/**
 * Первая строка письма — не готовый текст, а начало.
 *
 * Дописать «у нас приехал шэн, который вы брали» может только человек;
 * подставлять это за него значило бы рассылать одинаковые письма, а их и
 * читают одинаково — никак.
 */
function приветствие(client: CrmClient): string {
  const имя = client.name.trim().split(/\s+/)[0];
  return `${имя}, здравствуйте! Это WAYSTEA. `;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },

  tabs: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 14,
    paddingTop: 12,
    borderBottomWidth: 1,
    borderBottomColor: web.border,
  },
  tab: { paddingHorizontal: 18, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: web.link },
  tabLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },
  tabLabelOn: { color: web.text, fontWeight: '600' },

  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 14 },
  tile: {
    minWidth: 150,
    flexGrow: 1,
    flexBasis: 150,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 4,
    padding: 12,
    gap: 2,
  },
  tileOn: { borderColor: web.link, backgroundColor: '#F2F8FD' },
  tileValue: { fontFamily: WEB_FONT, fontSize: 26, color: web.text, fontVariant: ['tabular-nums'] },
  tileLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text, fontWeight: '600' },
  tileNote: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted, lineHeight: 16 },

  note: {
    fontFamily: WEB_FONT,
    fontSize: 13,
    color: web.textMuted,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },

  table: { flex: 1 },
  tableInner: { flex: 1 },
  body: { flex: 1 },
  nameCell: { flexDirection: 'row', alignItems: 'center', gap: 8, ...CELL },
  cell: { justifyContent: 'center', ...CELL },
  right: { textAlign: 'right' },
  warnText: { color: web.orange },
  goodText: { color: web.greenText },
  vip: { fontFamily: WEB_FONT, fontSize: 11, color: web.greenText },

  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  tag: {
    fontFamily: WEB_FONT,
    fontSize: 11,
    color: web.text,
    backgroundColor: '#EFF1F3',
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },

  write: {
    borderWidth: 1,
    borderColor: web.green,
    borderRadius: 3,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  writeLabel: { fontFamily: WEB_FONT, fontSize: 13, color: web.greenText },
  noPhone: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted },

  total: { fontFamily: WEB_FONT, fontSize: 15, color: web.text, marginHorizontal: 6 },
  empty: { padding: 40, fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },

  newTask: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14 },
  newTaskInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
  },
  newTaskDate: {
    width: 130,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
  },

  task: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: web.gridLine,
  },
  box: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: web.green, borderColor: web.green },
  boxMark: { color: '#FFFFFF', fontSize: 13, lineHeight: 16 },
  taskBody: { flex: 1, gap: 2 },
  taskTitle: { fontFamily: WEB_FONT, fontSize: 15, color: web.text },
  taskDone: { color: web.textMuted, textDecorationLine: 'line-through' },
  taskNote: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted },
  due: { fontFamily: WEB_FONT, fontSize: 12, color: web.orange },
  remove: { paddingHorizontal: 8 },
  removeLabel: { fontFamily: WEB_FONT, fontSize: 20, color: web.textMuted },
});
