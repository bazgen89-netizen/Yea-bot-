import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  formatDay,
  formatTime,
  groupMoneyByDay,
  lastMoneyDay,
  listMoney,
  moneyTitle,
  type MoneyEntry,
} from '../../src/db/journal';
import { weekEndingAt } from '../../src/domain/calendar';
import { formatMoneyWithSign, итогДвижения } from '../../src/domain/money';
import { useQuery } from '../../src/state/DatabaseProvider';
import { Empty } from '../../src/ui/components';
import { colors, radius, spacing, text } from '../../src/ui/theme';
import { useDesktop } from '../../src/ui/useDesktop';
import { MoneyTable } from '../../src/web/screens/MoneyTable';

/**
 * «Движение денег».
 *
 * На компьютере — таблица кабинета. На телефоне она была в два с половиной
 * раза шире экрана: столбцы «Приход» и «Расход» уезжали за край, и их
 * приходилось таскать пальцем вбок. Нашлось обходом всех экранов телефона.
 *
 * Здесь — то же движение списком по дням, как в «Журнале»: слева что это и
 * откуда, справа сумма и время. Сверху одной строкой итог периода.
 */
export default function MoneyScreen() {
  const desktop = useDesktop();
  if (desktop) return <MoneyTable />;
  return <MoneyPhone />;
}

type Период = 'неделя' | 'месяц' | 'всё';

const ПЕРИОДЫ: { key: Период; label: string }[] = [
  { key: 'неделя', label: 'Неделя' },
  { key: 'месяц', label: 'Месяц' },
  { key: 'всё', label: 'Всё' },
];

function MoneyPhone() {
  const router = useRouter();
  const [поиск, setПоиск] = useState('');
  const [период, setПериод] = useState<Период>('неделя');

  // Как и у таблицы — неделя, кончающаяся последним днём с движением, а не
  // сегодняшним: иначе после выходных экран открывался бы пустым.
  const last = useQuery((db) => lastMoneyDay(db));
  const границы = useMemo(() => {
    if (период === 'всё') return {};
    const { from, to } = weekEndingAt(last);
    if (период === 'неделя') return { from, to };
    const начало = new Date(`${to}T00:00:00Z`);
    начало.setUTCDate(начало.getUTCDate() - 29);
    return { from: начало.toISOString().slice(0, 10), to };
  }, [период, last]);

  const строки = useQuery(
    (db) => listMoney(db, 500, { ...границы, search: поиск.trim() || undefined }),
    [границы, поиск],
  );
  const итог = useMemo(() => итогДвижения(строки), [строки]);
  const разделы = useMemo(
    () => groupMoneyByDay(строки).map((группа) => ({ title: группа.day, data: группа.entries })),
    [строки],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <TextInput
          value={поиск}
          onChangeText={setПоиск}
          placeholder="Номер или комментарий"
          placeholderTextColor={colors.textMuted}
          style={styles.search}
        />
        <View style={styles.chips}>
          {ПЕРИОДЫ.map((один) => (
            <Pressable
              key={один.key}
              accessibilityRole="button"
              accessibilityState={{ selected: период === один.key }}
              onPress={() => setПериод(один.key)}
              style={[styles.chip, период === один.key && styles.chipOn]}
            >
              <Text style={[styles.chipText, период === один.key && styles.chipTextOn]}>
                {один.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.totals}>
          <Итог подпись="Пришло" сумма={итог.приход} цвет={colors.success} />
          <Итог подпись="Ушло" сумма={итог.расход} цвет={colors.danger} />
          <Итог подпись="Итого" сумма={итог.разница} цвет={colors.text} />
        </View>
      </View>

      <SectionList
        sections={разделы}
        keyExtractor={(одна) => `${одна.source}:${одна.id}`}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={styles.day}>{formatDay(section.title)}</Text>
        )}
        renderItem={({ item }) => (
          <Строка
            одна={item}
            onPress={() => router.push(`/money/show/${item.id}?source=${item.source}`)}
          />
        )}
        ListEmptyComponent={
          <Empty
            title="Движения нет"
            hint={поиск ? 'По этому номеру или слову ничего не нашлось.' : 'За этот период денег не было.'}
          />
        }
        contentContainerStyle={{ paddingBottom: 90 }}
      />

      {/* Новый документ — кнопкой снизу, как «Создать» у кабинета. */}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/money/new')}
        style={({ pressed }) => [styles.create, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.createText}>+ Приход или расход</Text>
      </Pressable>
    </View>
  );
}

function Итог({ подпись, сумма, цвет }: { подпись: string; сумма: number; цвет: string }) {
  return (
    <View style={styles.total}>
      <Text style={text.muted}>{подпись}</Text>
      <Text
        style={[styles.totalValue, { color: сумма ? цвет : colors.textMuted }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {formatMoneyWithSign(сумма)}
      </Text>
    </View>
  );
}

function Строка({ одна, onPress }: { одна: MoneyEntry; onPress: () => void }) {
  /*
   * Цвет — по виду документа, а не по сумме. Сперва было по сумме, и приход
   * без суммы (у части чеков её нет — стопроцентная скидка) выходил красным,
   * как расход.
   */
  const пришло = одна.type !== 'expense';
  const цвет = одна.type === 'income' ? colors.success : одна.type === 'expense' ? colors.danger : colors.accent;
  const сумма = одна.income || одна.expense;
  // Второй строкой — от кого, на какой счёт и комментарий: «пил работяга»
  // сразу объясняет, почему у чека нет денег.
  const откуда = [одна.counterparty, одна.account, одна.note].filter(Boolean).join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.bg }]}
    >
      <View style={[styles.stripe, { backgroundColor: цвет }]} />
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>{moneyTitle(одна)}</Text>
        {откуда ? (
          <Text style={text.muted} numberOfLines={1}>
            {откуда}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowRight}>
        {/* Приход без денег — не пустое место, а чек со скидкой 100 %: чай
            для своих, дегустация. Таких среди наличных — каждый третий, и
            прочерк на их месте выглядел как потерянная выручка. */}
        <Text style={[styles.amount, { color: сумма ? цвет : colors.textMuted }]}>
          {сумма ? `${пришло ? '+' : '−'}${formatMoneyWithSign(сумма)}` : 'бесплатно'}
        </Text>
        <Text style={text.muted}>{formatTime(одна.created_at)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.surface },
  search: {
    height: 42,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.text,
  },
  chips: { flexDirection: 'row', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
  },
  chipOn: { backgroundColor: colors.primary },
  chipText: { fontSize: 14, color: colors.text },
  chipTextOn: { color: colors.primaryText, fontWeight: '600' },
  totals: { flexDirection: 'row', gap: spacing.sm },
  total: { flex: 1, gap: 2 },
  totalValue: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },

  day: {
    ...text.heading,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingRight: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  stripe: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.accent },
  rowRight: { alignItems: 'flex-end', gap: 2 },
  amount: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },

  create: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
});
