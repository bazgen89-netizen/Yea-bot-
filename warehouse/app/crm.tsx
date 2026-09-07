import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  addTask,
  allTags,
  crmClients,
  filterClients,
  listTasks,
  setTaskDone,
  today,
  type CrmClient,
} from '../src/db/crm';
import {
  SEGMENTS,
  SEGMENT_LABEL,
  SEGMENT_NOTE,
  whatsappLink,
  сроком,
  type Segment,
} from '../src/domain/crm';
import { formatMoney } from '../src/domain/money';
import { pluralize } from '../src/domain/plural';
import { useDatabase, useQuery } from '../src/state/DatabaseProvider';
import { AppHeader } from '../src/ui/AppHeader';
import { Icon } from '../src/ui/icons';
import { colors, radius, spacing, text } from '../src/ui/theme';
import { useDesktop } from '../src/ui/useDesktop';
import { CrmTable } from '../src/web/screens/CrmTable';
import { say } from '../src/ui/alert';

/**
 * CRM с телефона.
 *
 * На широком экране — таблица кабинета. На телефоне таблицу листать нечем,
 * поэтому здесь список карточек и один вопрос сверху: кого возвращаем.
 */
export default function CrmScreen() {
  const desktop = useDesktop();
  if (desktop) return <CrmTable />;

  return <CrmPhone />;
}

type View_ = Segment | 'all' | 'vip' | 'tasks';

function CrmPhone() {
  const [view, setView] = useState<View_>('sleeping');
  const [search, setSearch] = useState('');

  const all = useQuery((db) => crmClients(db), []);

  const counts = useMemo(() => {
    const по: Record<string, number> = { all: all.length, vip: 0 };
    for (const s of SEGMENTS) по[s] = 0;
    for (const one of all) {
      по[one.standing.segment] += 1;
      if (one.vip) по.vip += 1;
    }
    return по;
  }, [all]);

  const found = useMemo(
    () => (view === 'tasks' ? [] : filterClients(all, { segment: view, search })),
    [all, view, search],
  );

  const деньги = useMemo(() => found.reduce((sum, one) => sum + one.purchases, 0), [found]);

  const кнопки: { value: View_; label: string }[] = [
    { value: 'sleeping', label: `Пропали · ${counts.sleeping}` },
    { value: 'regular', label: `Постоянные · ${counts.regular}` },
    { value: 'new', label: `Новые · ${counts.new}` },
    { value: 'vip', label: `Крупные · ${counts.vip}` },
    { value: 'lost', label: `Потеряны · ${counts.lost}` },
    { value: 'all', label: `Все · ${counts.all}` },
    { value: 'tasks', label: 'Дела' },
  ];

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <AppHeader
        back
        title="CRM"
        subtitle={
          view === 'tasks'
            ? 'Что сделать'
            : `${pluralize(found.length, 'клиент', 'клиента', 'клиентов')} · ${formatMoney(деньги)} ₽`
        }
      />

      <FlatList
        horizontal
        data={кнопки}
        keyExtractor={(item) => item.value}
        showsHorizontalScrollIndicator={false}
        style={styles.chipsRow}
        contentContainerStyle={styles.chips}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: view === item.value }}
            onPress={() => setView(item.value)}
            style={[styles.chip, view === item.value && styles.chipOn]}
          >
            <Text style={[styles.chipLabel, view === item.value && styles.chipLabelOn]}>
              {item.label}
            </Text>
          </Pressable>
        )}
      />

      {view === 'tasks' ? (
        <TasksPhone />
      ) : (
        <>
          <View style={styles.searchRow}>
            <Icon.search />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Имя, телефон или метка"
              placeholderTextColor={colors.textMuted}
              style={styles.search}
              clearButtonMode="while-editing"
            />
          </View>

          <Text style={styles.note}>
            {view === 'vip'
              ? 'Верхние 10 % по выручке за всё время.'
              : view === 'all'
                ? 'Вся база, кроме «Розничного покупателя».'
                : SEGMENT_NOTE[view]}
          </Text>

          <FlatList
            data={found}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => <ClientRow client={item} />}
            initialNumToRender={15}
            windowSize={11}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={text.heading}>
                  {search ? 'Ничего не нашлось' : 'В этой группе пока никого'}
                </Text>
              </View>
            }
          />
        </>
      )}
    </View>
  );
}

function ClientRow({ client }: { client: CrmClient }) {
  const router = useRouter();
  const ссылка = whatsappLink(client.phone, `${client.name.trim().split(/\s+/)[0]}, здравствуйте! Это WAYSTEA. `);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({ pathname: '/counterparty/[id]', params: { id: String(client.id) } })
      }
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarLetter}>
          {client.name.trim().slice(0, 1).toUpperCase() || '?'}
        </Text>
      </View>

      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {client.name}
          {client.vip ? ' ★' : ''}
        </Text>
        <Text style={styles.rowNote} numberOfLines={1}>
          {[
            сроком(client.standing.idle),
            client.receipts
              ? pluralize(client.receipts, 'чек', 'чека', 'чеков')
              : 'без покупок',
            client.standing.overdue ? `опоздал на ${client.standing.overdue} дн.` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>

      <View style={styles.rowRight}>
        <Text style={styles.rowSum}>{formatMoney(client.purchases)} ₽</Text>
        {ссылка ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Написать ${client.name} в WhatsApp`}
            onPress={() => void Linking.openURL(ссылка)}
            hitSlop={8}
            style={styles.write}
          >
            <Text style={styles.writeLabel}>Написать</Text>
          </Pressable>
        ) : (
          <Text style={styles.rowCount}>нет телефона</Text>
        )}
      </View>
    </Pressable>
  );
}

function TasksPhone() {
  const { db, refresh } = useDatabase();
  const [title, setTitle] = useState('');
  const tasks = useQuery((database) => listTasks(database), []);
  const сегодня = today();

  function завести() {
    if (!title.trim()) {
      say('Нужно название', 'Без названия дело потом не понять.');
      return;
    }
    addTask(db, { title });
    setTitle('');
    refresh();
  }

  return (
    <>
      <View style={styles.searchRow}>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Что сделать"
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          onSubmitEditing={завести}
          returnKeyType="done"
        />
        <Pressable accessibilityRole="button" onPress={завести} hitSlop={8}>
          <Text style={styles.add}>Добавить</Text>
        </Pressable>
      </View>

      <FlatList
        data={tasks}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: Boolean(item.done_at) }}
            accessibilityLabel={item.title}
            onPress={() => {
              setTaskDone(db, item.id, !item.done_at);
              refresh();
            }}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
          >
            <View style={[styles.box, item.done_at ? styles.boxOn : null]}>
              <Text style={styles.boxMark}>{item.done_at ? '✓' : ''}</Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowName}>{item.title}</Text>
              <Text style={styles.rowNote}>
                {[item.due_date, item.client_name ?? ''].filter(Boolean).join(' · ')}
              </Text>
            </View>
            {!item.done_at && item.due_date <= сегодня ? (
              <Text style={styles.due}>пора</Text>
            ) : null}
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={text.heading}>Дел нет</Text>
            <Text style={text.muted}>Заведите первое строкой выше</Text>
          </View>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  chipsRow: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  chips: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
  },
  chipOn: { backgroundColor: colors.accentSoft },
  chipLabel: { fontSize: 14, color: colors.textMuted },
  chipLabelOn: { color: colors.accent, fontWeight: '600' },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  search: { flex: 1, fontSize: 17, color: colors.text, paddingVertical: spacing.xs },
  add: { fontSize: 16, color: colors.accent, fontWeight: '600' },
  note: {
    fontSize: 13,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: colors.accent, fontSize: 18, fontWeight: '700' },
  rowBody: { flex: 1, gap: 2 },
  rowName: { fontSize: 17, fontWeight: '600', color: colors.text },
  rowNote: { fontSize: 13, color: colors.textMuted },
  rowRight: { alignItems: 'flex-end', gap: spacing.xs },
  rowSum: { fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
  rowCount: { fontSize: 12, color: colors.textMuted },
  write: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  writeLabel: { fontSize: 13, color: colors.accent },

  box: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.success, borderColor: colors.success },
  boxMark: { color: '#FFFFFF', fontSize: 15 },
  due: { fontSize: 13, color: colors.warning },

  empty: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
});
