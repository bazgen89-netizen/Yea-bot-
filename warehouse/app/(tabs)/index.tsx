import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { listProducts } from '../../src/db/products';
import { periodFor, salesSummary, stockValue } from '../../src/db/reports';
import { formatMoney, formatMoneyWithSign } from '../../src/domain/money';
import { formatQty } from '../../src/domain/qty';
import { pluralize } from '../../src/domain/plural';
import { useQuery } from '../../src/state/DatabaseProvider';
import { AppHeader } from '../../src/ui/AppHeader';
import { colors, radius, shadow, spacing, text } from '../../src/ui/theme';

type PeriodKind = 'today' | 'week' | 'month' | 'year';

const PERIODS: { value: PeriodKind; label: string }[] = [
  { value: 'today', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'year', label: 'Год' },
];

const REPORTS = [
  { key: 'daily', label: 'Продажи\nпо дням', symbol: '📅', tint: '#E3F3E7' },
  { key: 'products', label: 'Продажи\nпо товарам', symbol: '📦', tint: '#E4ECFE' },
  { key: 'customers', label: 'Отчёт по\nпокупателям', symbol: '👥', tint: '#FCE4EC' },
  { key: 'moves', label: 'Отчёт\nпо движению', symbol: '🔁', tint: '#FDEBDF' },
  { key: 'staff', label: 'Отчёт по\nсотрудникам', symbol: '🧑', tint: '#E1F1F7' },
  { key: 'finance', label: 'Финансовый\nотчёт', symbol: '💲', tint: '#F0E7FB' },
];

export default function HomeScreen() {
  const router = useRouter();
  const [kind, setKind] = useState<PeriodKind>('today');

  const period = periodFor(kind);
  const summary = useQuery((db) => salesSummary(db, period), [kind]);
  const stock = useQuery((db) => stockValue(db));
  const lowStock = useQuery((db) => listProducts(db, { lowStockOnly: true }));
  const totalQty = useQuery((db) =>
    listProducts(db).reduce((sum, product) => sum + product.stock, 0),
  );

  return (
    <View style={styles.screen}>
      <AppHeader
        title="WAYSTEA"
        onPickLocation={() => router.push('/locations')}
        onNotifications={() => router.push('/notifications')}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <Card>
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

          <Text style={[text.muted, styles.periodDate]}>{periodLabel(kind)}</Text>
          <Text style={text.hero}>{formatMoney(summary.revenue)}</Text>

          <View style={styles.metrics}>
            <Metric label="Выручка" value={formatMoney(summary.revenue)} highlight />
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
                  <Text style={styles.reportSymbol}>{report.symbol}</Text>
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
            value={formatMoneyWithSign(stock.retailValue)}
          />
          <StatRow
            label="Стоимость товара"
            caption="По себестоимости"
            value={formatMoneyWithSign(stock.costValue)}
            last
          />
          <SoftButton title="Подробнее" onPress={() => router.push('/reports/stock')} />
        </Card>

        <Card>
          <Text style={text.block}>Пора закупить</Text>
          {lowStock.length === 0 ? (
            <Text style={[text.muted, styles.empty]}>Всё в наличии</Text>
          ) : (
            lowStock.slice(0, 5).map((product) => (
              <Pressable
                key={product.id}
                accessibilityRole="button"
                onPress={() =>
                  router.push({ pathname: '/product/[id]', params: { id: String(product.id) } })
                }
                style={({ pressed }) => [styles.lowRow, pressed && { opacity: 0.6 }]}
              >
                <Text style={text.body} numberOfLines={1}>
                  {product.name}
                </Text>
                <Text style={[text.mono, product.stock <= 0 && { color: colors.danger }]}>
                  {formatQty(product.stock)} {product.unit}
                </Text>
              </Pressable>
            ))
          )}
          {lowStock.length > 0 ? (
            <Text style={[text.muted, styles.empty]}>
              {pluralize(lowStock.length, 'позиция', 'позиции', 'позиций')} ниже порога
            </Text>
          ) : null}
        </Card>
      </ScrollView>
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function Metric({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={[styles.metric, highlight && styles.metricActive]}>
      <Text style={[styles.metricValue, highlight && { color: colors.accent }]}>{value}</Text>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadow,
  },
  periods: { flexDirection: 'row', gap: spacing.xs },
  period: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  periodActive: { backgroundColor: colors.surface, ...shadow },
  periodText: { fontSize: 15, color: colors.textMuted, fontWeight: '500' },
  periodTextActive: { color: colors.text, fontWeight: '700' },
  periodDate: { textTransform: 'capitalize' },
  metrics: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  metric: { flex: 1, alignItems: 'center', paddingBottom: spacing.sm },
  metricActive: { borderBottomWidth: 2, borderBottomColor: colors.accent },
  metricValue: { fontSize: 15, fontWeight: '700', color: colors.text },
  metricLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
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
  reportSymbol: { fontSize: 22 },
  reportLabel: { flex: 1, fontSize: 14, color: colors.text, lineHeight: 18 },
  statRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  statDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  statLabels: { flex: 1 },
  statCaption: { fontSize: 17, color: colors.text, marginTop: 2 },
  statValue: {
    fontSize: 19,
    fontWeight: '600',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  lowRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  empty: { paddingVertical: spacing.sm },
  soft: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  softText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
});
