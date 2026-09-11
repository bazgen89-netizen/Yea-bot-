import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewProps,
} from 'react-native';

import { listLocations } from '../../src/db/locations';
import {
  dailySales,
  hourlySales,
  periodFor,
  salesSummary,
  stockQty,
  stockValue,
  type Scope,
} from '../../src/db/reports';
import { formatMoney } from '../../src/domain/money';
import { anchorOf, byMonth, canGoForward, periodTitle, tickLabel } from '../../src/domain/periods';
import { formatQty } from '../../src/domain/qty';
import { useQuery } from '../../src/state/DatabaseProvider';
import { AppHeader, HeaderAction } from '../../src/ui/AppHeader';
import { Icon, ReportIcon } from '../../src/ui/icons';
import { colors, radius, shadow, spacing, text } from '../../src/ui/theme';
import { useDesktop } from '../../src/ui/useDesktop';
import { ОкноОтчётов } from '../../src/ui/ОкноОтчётов';
import { HomeDashboard } from '../../src/web/screens/HomeDashboard';

type PeriodKind = 'today' | 'week' | 'month' | 'year';

const PERIODS: { value: PeriodKind; label: string }[] = [
  { value: 'today', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'year', label: 'Год' },
];

/*
 * Плитки отчётов на главной.
 *
 * `key` — это имя отчёта в реестре (`src/db/reportTypes.ts`), по нему
 * строится адрес. Четыре из шести здесь были названы по-своему — `daily`
 * вместо `day`, `products` вместо `product`, `customers` вместо `agent`,
 * `moves` вместо `motion`, — и открывали «Такого отчёта нет». Имена должны
 * совпадать с реестром буква в букву; если заводится новый отчёт, он
 * добавляется туда, а не сюда.
 */
const REPORTS = [
  { key: 'day', label: 'Продажи\nпо дням', tint: '#DFF1E4', color: '#2E9E5B', Icon: ReportIcon.daily },
  { key: 'product', label: 'Продажи\nпо товарам', tint: '#DEE8FD', color: '#1A66FF', Icon: ReportIcon.products },
  { key: 'agent', label: 'Отчет по\nпокупателям', tint: '#FBDCE6', color: '#E23B72', Icon: ReportIcon.customers },
  { key: 'motion', label: 'Отчёт\nпо движению', tint: '#FCE4D4', color: '#E4691E', Icon: ReportIcon.moves },
  { key: 'staff', label: 'Отчет по\nсотрудникам', tint: '#D9EDF6', color: '#2A7FA8', Icon: ReportIcon.staff },
  { key: 'finance', label: 'Финансовый\nотчёт', tint: '#EDE2FA', color: '#7B4BC9', Icon: ReportIcon.finance },
];

export default function HomeScreen() {
  // На широком экране главная показывается как в кабинете.
  const desktop = useDesktop();
  if (desktop) return <HomeDashboard />;

  return <HomePhone />;
}

function HomePhone() {
  const router = useRouter();
  const [kind, setKind] = useState<PeriodKind>('today');

  /**
   * Какой магазин показываем. `null` — все сразу.
   *
   * У него магазинов семь, и показатели у них разные: выручка дня по всем
   * втрое больше, чем по одному. Пока магазин нельзя выбрать, число на
   * главной не отвечает ни на один вопрос — «двенадцать тысяч» это где?
   */
  const [scope, setScope] = useState<Scope>(null);
  const [picking, setPicking] = useState(false);
  /** Открыт ли список всех отчётов — у него он всплывает снизу. */
  const [отчётыВидны, показатьОтчёты] = useState(false);

  const stores = useQuery((db) => listLocations(db));
  const storeName = stores.find((store) => store.id === scope)?.name ?? null;

  /**
   * На сколько периодов назад листнули. 0 — нынешний.
   *
   * Сбрасывается при смене «День / Неделя / Месяц / Год»: остаться на третьем
   * шаге назад, переключившись с дней на годы, значило бы прыгнуть на три года
   * назад — а человек всего лишь нажал «Год».
   */
  const [back, setBack] = useState(0);

  function выбрать(value: PeriodKind) {
    setKind(value);
    setBack(0);
  }

  const period = useMemo(() => periodFor(kind, anchorOf(kind, back)), [kind, back]);
  const before = useMemo(() => periodFor(kind, anchorOf(kind, back + 1)), [kind, back]);

  const summary = useQuery((db) => salesSummary(db, period, scope), [kind, back, scope]);
  const stock = useQuery((db) => stockValue(db, scope), [scope]);
  // За день график рисуется по часам: одна точка на весь день — это не
  // график, а синий прямоугольник во всю карточку.
  const daily = useQuery(
    (db) => (kind === 'today' ? hourlySales(db, period, scope) : dailySales(db, period, scope)),
    [kind, back, scope],
  );
  const totalQty = useQuery((db) => stockQty(db, scope), [scope]);

  /**
   * Чем измеряется столбик: часами, днями или месяцами.
   *
   * За год дней триста шестьдесят пять, и в карточке шириной с телефон они
   * схлопывались в ничто — график выходил пустым белым полем, будто выручки
   * за год нет вовсе. Сводим их в двенадцать месяцев.
   */
  const unit = kind === 'today' ? 'hour' : kind === 'year' ? 'month' : 'day';
  const chart = useMemo(() => (unit === 'month' ? byMonth(daily) : daily), [unit, daily]);

  // Насколько выручка отличается от предыдущего такого же периода.
  const previous = useQuery((db) => salesSummary(db, before, scope), [kind, back, scope]);
  const change = percentChange(summary.revenue, previous.revenue);

  /**
   * Листание пальцем по карточке.
   *
   * Тянешь влево — уходишь в прошлое, вправо — возвращаешься, ровно как он
   * показал. Порог в 40 точек нужен, чтобы карточка не улетала от случайного
   * касания при прокрутке страницы вниз; по той же причине жест берётся
   * только когда движение по горизонтали заметно больше вертикального.
   */
  const swipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx <= -40) setBack((was) => was + 1);
        // Вперёд — только если есть куда: будущей выручки не бывает.
        else if (gesture.dx >= 40) setBack((was) => (canGoForward(was) ? was - 1 : was));
      },
    }),
  ).current;

  return (
    <View style={styles.screen}>
      <AppHeader
        title="WAYSTEA"
        subtitle={storeName ?? 'Все магазины'}
        actions={
          <>
            <HeaderAction label="Выбрать магазин" onPress={() => setPicking(true)}>
              <Icon.store color="#FFFFFF" size={26} />
            </HeaderAction>
            <HeaderAction label="Оповещения" onPress={() => router.push('/notifications')}>
              <Icon.bell color="#FFFFFF" size={25} />
            </HeaderAction>
          </>
        }
      />

      <ОкноОтчётов открыто={отчётыВидны} закрыть={() => показатьОтчёты(false)} />

      <StorePicker
        visible={picking}
        stores={stores}
        chosen={scope}
        onPick={(value) => {
          setScope(value);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.periods}>
          {PERIODS.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: kind === option.value }}
              onPress={() => выбрать(option.value)}
              style={({ pressed }) => [
                styles.period,
                kind === option.value && styles.periodActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.periodText, kind === option.value && styles.periodTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Карточка листается пальцем; стрелки — для тех, кто листать не
            догадается, и для мыши в веб-версии. Жест без видимой кнопки
            существует только для того, кто про него узнал. */}
        <Card style={styles.chartCard} {...swipe.panHandlers}>
          <View style={styles.chartHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Предыдущий период"
              onPress={() => setBack((was) => was + 1)}
              hitSlop={10}
              style={({ pressed }) => [styles.arrow, pressed && { opacity: 0.5 }]}
            >
              <Text style={styles.arrowText}>‹</Text>
            </Pressable>

            <View style={styles.chartTitles}>
              <Text style={[text.muted, styles.periodDate]}>{periodTitle(kind, back)}</Text>
              {change !== null ? (
                <Text style={[styles.change, change < 0 && { color: colors.danger }]}>
                  {change < 0 ? '▼' : '▲'} {Math.abs(change)}%
                </Text>
              ) : null}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Следующий период"
              accessibilityState={{ disabled: !canGoForward(back) }}
              disabled={!canGoForward(back)}
              onPress={() => setBack((was) => was - 1)}
              hitSlop={10}
              style={({ pressed }) => [
                styles.arrow,
                !canGoForward(back) && styles.arrowOff,
                pressed && { opacity: 0.5 },
              ]}
            >
              <Text style={styles.arrowText}>›</Text>
            </Pressable>
          </View>

          <Text style={text.hero}>{formatMoney(summary.revenue)}</Text>
          <Chart points={chart} unit={unit} />
        </Card>

        <Card style={styles.metricsCard}>
          <View style={styles.metrics}>
            <Metric label="Выручка" value={formatMoney(summary.revenue)} active />
            <Metric label="Себестоимость" value={formatMoney(summary.cost)} />
            <Metric label="Прибыль" value={formatMoney(summary.profit)} />
            <Metric label="Средний чек" value={formatMoney(summary.averageReceipt)} />
          </View>
        </Card>

        <Card>
          <Text style={text.block}>Отчёты</Text>
          <View style={styles.reports}>
            {REPORTS.map((report) => (
              <Pressable
                key={report.key}
                accessibilityRole="button"
                onPress={() => router.push(`/reports/${report.key}`)}
                style={({ pressed }) => [styles.report, pressed && { opacity: 0.6 }]}
              >
                <View style={[styles.reportIcon, { backgroundColor: report.tint }]}>
                  <report.Icon color={report.color} />
                </View>
                <Text style={styles.reportLabel}>{report.label}</Text>
              </Pressable>
            ))}
          </View>
          {/* У него это всплывающее окно со списком всех отчётов по
              группам, а не отдельный экран сводки. */}
          <SoftButton title="Все отчёты" onPress={() => показатьОтчёты(true)} />
        </Card>

        <Card>
          <Text style={text.block}>Оценка склада</Text>
          <StatRow label="Общее" caption="Количество товара" value={`${formatQty(totalQty)} ед.`} />
          <StatRow
            label="Стоимость товара"
            caption="В розничных ценах"
            value={`${formatMoney(stock.retailValue)}`}
          />
          <StatRow
            label="Стоимость товара"
            caption="По себестоимости"
            value={`${formatMoney(stock.costValue)}`}
            last
          />
          <SoftButton title="Подробнее" onPress={() => router.push('/reports/stock')} />
        </Card>

        <Card>
          <Text style={text.block}>Открытые смены</Text>
          <View style={styles.placeholder}>
            <Icon.refresh />
            <Text style={text.muted}>Не найдено</Text>
          </View>
          <SoftButton title="Все смены" onPress={() => router.push('/shifts')} />
        </Card>

        <Card>
          <Text style={text.block}>Предстоящие события</Text>
          <View style={styles.placeholder}>
            <Icon.refresh />
            <Text style={text.muted}>Не найдено</Text>
          </View>
        </Card>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/settings/blocks')}
          style={({ pressed }) => [styles.reorder, pressed && { opacity: 0.7 }]}
        >
          <Icon.reorder />
          <Text style={styles.reorderText}>Изменить порядок блоков</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

/**
 * Выбор магазина — тот самый значок лавки в шапке.
 *
 * Лист снизу, а не окошко по центру: так это устроено у него, и так удобнее
 * — до списка дотягивается большой палец, а верх экрана с цифрами остаётся
 * на виду, и видно, что именно меняется.
 *
 * Поиск сверху нужен не для трёх магазинов, а для тридцати: список растёт
 * вместе с сетью, и искать глазами тогда нечего.
 */
function StorePicker({
  visible,
  stores,
  chosen,
  onPick,
  onClose,
}: {
  visible: boolean;
  stores: { id: number; name: string; address: string | null }[];
  chosen: Scope;
  onPick: (scope: Scope) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');

  const found = stores.filter((store) => {
    const text = search.trim().toLowerCase();
    if (!text) return true;
    return `${store.name} ${store.address ?? ''}`.toLowerCase().includes(text);
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Нажатие мимо листа закрывает его — как и везде у него. */}
      <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityRole="button" />

      <View style={styles.sheet}>
        <View style={styles.sheetGrip} />

        <View style={styles.sheetSearch}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Поиск"
            placeholderTextColor={colors.textMuted}
            style={styles.sheetSearchInput}
          />
        </View>

        <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
          <StoreRow
            label="Все магазины"
            note="Сводка по всей сети"
            active={chosen === null}
            onPress={() => onPick(null)}
          />
          {found.map((store) => (
            <StoreRow
              key={store.id}
              label={store.name}
              note={store.address}
              active={chosen === store.id}
              onPress={() => onPick(store.id)}
            />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

function StoreRow({
  label,
  note,
  active,
  onPress,
}: {
  label: string;
  note?: string | null;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.sheetRow, pressed && { opacity: 0.6 }]}
    >
      <View style={styles.sheetRowText}>
        <Text style={styles.sheetRowLabel} numberOfLines={1}>
          {label}
        </Text>
        {note ? (
          <Text style={styles.sheetRowNote} numberOfLines={1}>
            {note}
          </Text>
        ) : null}
      </View>

      {/* Кружок, а не галочка: выбрать можно только один магазин. */}
      <View style={[styles.radio, active && styles.radioActive]}>
        {active ? <View style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
}

/**
 * Остальные свойства уходят во `View` — без этого обработчики жеста
 * (`panHandlers`) молча терялись бы: TypeScript не ловит лишние свойства,
 * переданные через `{...}`, и карточка выглядела бы листаемой, не будучи ею.
 */
function Card({
  children,
  style,
  ...rest
}: { children: React.ReactNode; style?: object } & ViewProps) {
  return (
    <View {...rest} style={[styles.card, style]}>
      {children}
    </View>
  );
}

/** Столбики выручки по дням. Пусто — показываем пустую область, как в оригинале. */
function Chart({
  points,
  unit,
}: {
  points: { day: string; revenue: number }[];
  unit: 'hour' | 'day' | 'month';
}) {
  const max = Math.max(...points.map((point) => point.revenue), 1);

  return (
    <View>
      <View style={styles.chart}>
        {points.map((point) => (
          <View key={point.day} style={styles.chartColumn}>
            {/* Серая дорожка во всю высоту, а на ней — столбик. Так у него:
                видно, насколько этот час или день дотянул до лучшего. */}
            <View style={styles.chartTrack}>
              <View
                style={[
                  styles.chartBar,
                  { height: `${Math.max((point.revenue / max) * 100, 3)}%` },
                ]}
              />
            </View>
          </View>
        ))}
      </View>

      <View style={styles.chartAxis}>
        {points.map((point) => (
          <Text key={point.day} style={styles.chartTick} numberOfLines={1}>
            {tickLabel(point.day, unit)}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Подпись под столбиком: час — числом, день — числом месяца. */
function Metric({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <View style={[styles.metric, active && styles.metricActive]}>
      <Text style={[styles.metricValue, active && { color: colors.accent }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function StatRow({
  label,
  caption,
  value,
  last,
}: {
  label: string;
  caption: string;
  value: string;
  last?: boolean;
}) {
  const negative = value.trim().startsWith('-');

  return (
    <View style={[styles.statRow, !last && styles.statDivider]}>
      <View style={styles.statLabels}>
        <Text style={text.muted}>{label}</Text>
        <Text style={styles.statCaption}>{caption}</Text>
      </View>
      <Text style={[styles.statValue, negative && { color: colors.danger }]}>{value}</Text>
    </View>
  );
}

function SoftButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.soft, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.softText}>{title}</Text>
    </Pressable>
  );
}

/** null — сравнивать не с чем: в прошлом периоде продаж не было. */
function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? null : 100;
  return Math.round(((current - previous) / previous) * 100);
}

const styles = StyleSheet.create({
  arrow: { paddingHorizontal: 6, paddingVertical: 2 },
  arrowOff: { opacity: 0.25 },
  arrowText: { fontSize: 26, lineHeight: 28, color: colors.textMuted },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: spacing.lg,
    maxHeight: '70%',
  },
  sheetGrip: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  sheetSearch: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  sheetSearchInput: {
    height: 44,
    borderRadius: 22,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.bg,
    color: colors.text,
    fontSize: 16,
  },
  sheetList: { minHeight: 0 },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sheetRowText: { flex: 1 },
  sheetRowLabel: { fontSize: 17, color: colors.text },
  sheetRowNote: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: colors.primary },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },

  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow,
  },
  chartCard: { gap: spacing.sm },
  // «вторник» из toLocaleDateString приходит с маленькой буквы.
  /**
   * Без `capitalize`. Он остался с тех пор, когда подпись приходила от
   * `toLocaleDateString` со строчной буквы в начале, — и заодно поднимал
   * каждое слово: выходило «7 Сентября» и «2026 Год». Теперь подпись
   * приходит готовой из `domain/periods`, где регистр расставлен по-русски.
   */
  periodDate: {},
  metricsCard: { padding: 0 },
  periods: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.xs },
  period: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  periodActive: { backgroundColor: colors.surface, ...shadow },
  periodText: { fontSize: 16, color: colors.textMuted, fontWeight: '500' },
  periodTextActive: { color: colors.text, fontWeight: '700' },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  chartTitles: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  change: { fontSize: 15, fontWeight: '700', color: colors.success },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    height: 170,
    marginTop: spacing.sm,
  },
  chartColumn: { flex: 1, height: '100%', alignItems: 'center' },
  // Дорожка уже колонки: у него столбики тонкие, а не во всю ширину клетки.
  chartTrack: {
    width: 12,
    maxWidth: '80%',
    height: '100%',
    justifyContent: 'flex-end',
    // Дорожка — цветом рамки, а не подложки: на тёмной карточке подложка
    // черна, и дорожка на ней исчезала.
    backgroundColor: colors.border,
    borderRadius: 6,
    overflow: 'hidden',
  },
  chartBar: { width: '100%', backgroundColor: colors.accent, borderRadius: 6 },
  chartAxis: { flexDirection: 'row', gap: 6, marginTop: spacing.xs },
  chartTick: { flex: 1, textAlign: 'center', fontSize: 11, color: colors.textMuted },
  metrics: { flexDirection: 'row' },
  metric: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  metricActive: { borderBottomColor: colors.accent },
  metricValue: { fontSize: 17, fontWeight: '600', color: colors.text },
  metricLabel: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  reports: { flexDirection: 'row', flexWrap: 'wrap' },
  report: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  reportIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportLabel: { flex: 1, fontSize: 14, color: colors.text, lineHeight: 18 },
  statRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  statDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  statLabels: { flex: 1 },
  statCaption: { fontSize: 17, color: colors.text, marginTop: 2 },
  statValue: {
    fontSize: 19,
    fontWeight: '600',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  placeholder: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  soft: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  softText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
  reorder: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
  },
  reorderText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
});
