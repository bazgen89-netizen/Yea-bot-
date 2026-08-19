import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { listLocations } from '../../src/db/locations';
import {
  dailySales,
  periodFor,
  salesSummary,
  stockQty,
  stockValue,
  type Scope,
} from '../../src/db/reports';
import { formatMoney } from '../../src/domain/money';
import { formatQty } from '../../src/domain/qty';
import { useQuery } from '../../src/state/DatabaseProvider';
import { AppHeader, HeaderAction } from '../../src/ui/AppHeader';
import { Icon, ReportIcon } from '../../src/ui/icons';
import { colors, radius, shadow, spacing, text } from '../../src/ui/theme';
import { useDesktop } from '../../src/ui/useDesktop';
import { HomeDashboard } from '../../src/web/screens/HomeDashboard';

type PeriodKind = 'today' | 'week' | 'month' | 'year';

const PERIODS: { value: PeriodKind; label: string }[] = [
  { value: 'today', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'year', label: 'Год' },
];

const REPORTS = [
  { key: 'daily', label: 'Продажи\nпо дням', tint: '#DFF1E4', color: '#2E9E5B', Icon: ReportIcon.daily },
  { key: 'products', label: 'Продажи\nпо товарам', tint: '#DEE8FD', color: '#1A66FF', Icon: ReportIcon.products },
  { key: 'customers', label: 'Отчет по\nпокупателям', tint: '#FBDCE6', color: '#E23B72', Icon: ReportIcon.customers },
  { key: 'moves', label: 'Отчёт\nпо движению', tint: '#FCE4D4', color: '#E4691E', Icon: ReportIcon.moves },
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

  const stores = useQuery((db) => listLocations(db));
  const storeName = stores.find((store) => store.id === scope)?.name ?? null;

  const period = periodFor(kind);
  const summary = useQuery((db) => salesSummary(db, period, scope), [kind, scope]);
  const stock = useQuery((db) => stockValue(db, scope), [scope]);
  const daily = useQuery((db) => dailySales(db, period, scope), [kind, scope]);
  const totalQty = useQuery((db) => stockQty(db, scope), [scope]);

  // Насколько выручка отличается от предыдущего такого же периода.
  const previous = useQuery((db) => salesSummary(db, previousPeriod(kind), scope), [kind, scope]);
  const change = percentChange(summary.revenue, previous.revenue);

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
              onPress={() => setKind(option.value)}
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

        <Card style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <View style={styles.chartTitles}>
              <Text style={[text.muted, styles.periodDate]}>{periodLabel(kind)}</Text>
              {change !== null ? (
                <Text style={[styles.change, change < 0 && { color: colors.danger }]}>
                  {change < 0 ? '▼' : '▲'} {Math.abs(change)}%
                </Text>
              ) : null}
            </View>
            <Icon.info size={22} />
          </View>

          <Text style={text.hero}>{formatMoney(summary.revenue)}</Text>
          <Chart points={daily} />
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
          <SoftButton title="Все отчёты" onPress={() => router.push('/reports')} />
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
 * Список, а не переход на отдельный экран: выбрать магазин и увидеть, как
 * поменялись цифры, надо здесь же. Уход на другой экран и возврат обратно
 * рвёт это движение надвое.
 */
function StorePicker({
  visible,
  stores,
  chosen,
  onPick,
  onClose,
}: {
  visible: boolean;
  stores: { id: number; name: string }[];
  chosen: Scope;
  onPick: (scope: Scope) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.pickerBackdrop} onPress={onClose} accessibilityRole="button">
        <View style={styles.pickerCard}>
          <Text style={styles.pickerTitle}>Магазин</Text>

          <StoreRow
            label="Все магазины"
            active={chosen === null}
            onPress={() => onPick(null)}
          />
          {stores.map((store) => (
            <StoreRow
              key={store.id}
              label={store.name}
              active={chosen === store.id}
              onPress={() => onPick(store.id)}
            />
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

function StoreRow({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.pickerRow, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.pickerLabel, active && styles.pickerLabelActive]} numberOfLines={1}>
        {label}
      </Text>
      {active ? <Text style={styles.pickerTick}>✓</Text> : null}
    </Pressable>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Столбики выручки по дням. Пусто — показываем пустую область, как в оригинале. */
function Chart({ points }: { points: { day: string; revenue: number }[] }) {
  const max = Math.max(...points.map((point) => point.revenue), 1);

  return (
    <View style={styles.chart}>
      {points.map((point) => (
        <View key={point.day} style={styles.chartColumn}>
          <View
            style={[
              styles.chartBar,
              { height: `${Math.max((point.revenue / max) * 100, 2)}%` },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

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

function periodLabel(kind: PeriodKind): string {
  const now = new Date();
  if (kind === 'today') {
    return now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  return { week: 'Последние 7 дней', month: 'Последние 30 дней', year: 'Последний год' }[kind];
}

/** Предыдущий период той же длины — с ним сравнивается выручка. */
function previousPeriod(kind: PeriodKind) {
  const current = periodFor(kind);
  const from = new Date(current.from);
  const to = new Date(current.to);
  const length = to.getTime() - from.getTime();

  return {
    from: new Date(from.getTime() - length).toISOString(),
    to: current.from,
  };
}

/** null — сравнивать не с чем: в прошлом периоде продаж не было. */
function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? null : 100;
  return Math.round(((current - previous) / previous) * 100);
}

const styles = StyleSheet.create({
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  pickerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    ...shadow,
  },
  pickerTitle: {
    ...text.block,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  pickerLabel: { flex: 1, fontSize: 16, color: colors.text },
  pickerLabelActive: { color: colors.primary, fontWeight: '600' },
  pickerTick: { fontSize: 16, color: colors.primary },

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
  periodDate: { textTransform: 'capitalize' },
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
    gap: 3,
    height: 190,
    marginTop: spacing.sm,
  },
  chartColumn: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  chartBar: { width: '100%', backgroundColor: colors.accent, borderRadius: 3 },
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
