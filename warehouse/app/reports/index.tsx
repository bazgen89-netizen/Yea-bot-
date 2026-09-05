import { File, Paths } from 'expo-file-system';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { stockCsv } from '../../src/db/export';
import { listProducts } from '../../src/db/products';
import {
  dailySales,
  periodFor,
  salesSummary,
  stockValue,
  topProducts,
  type DailyPoint,
} from '../../src/db/reports';
import { formatMoney, formatMoneyWithSign } from '../../src/domain/money';
import { formatQtyWithUnit } from '../../src/domain/qty';
import { pluralize } from '../../src/domain/plural';
import { useDatabase, useQuery } from '../../src/state/DatabaseProvider';
import { useDesktop } from '../../src/ui/useDesktop';
import { ReportsGrid } from '../../src/web/screens/ReportsGrid';
import { AppHeader } from '../../src/ui/AppHeader';
import { Badge, Button, Card, Empty, Row, Stat } from '../../src/ui/components';
import { colors, radius, spacing, text } from '../../src/ui/theme';
import { say } from '../../src/ui/alert';

type PeriodKind = 'today' | 'week' | 'month' | 'year';

const PERIODS: { value: PeriodKind; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: '7 дней' },
  { value: 'month', label: '30 дней' },
  { value: 'year', label: 'Год' },
];

export default function ReportsScreen() {
  // На широком экране отчёты выбираются плитками, как в кабинете.
  const desktop = useDesktop();
  if (desktop) return <ReportsGrid />;

  return <ReportsPhone />;
}

function ReportsPhone() {
  const router = useRouter();
  const { db } = useDatabase();
  const [kind, setKind] = useState<PeriodKind>('week');

  const period = periodFor(kind);

  const summary = useQuery((database) => salesSummary(database, period), [kind]);
  const top = useQuery((database) => topProducts(database, period, 5), [kind]);
  const daily = useQuery((database) => dailySales(database, period), [kind]);
  const stock = useQuery((database) => stockValue(database));
  const lowStock = useQuery((database) => listProducts(database, { lowStockOnly: true }));

  async function exportStock() {
    try {
      const file = new File(Paths.cache, `Остатки ${new Date().toISOString().slice(0, 10)}.csv`);
      if (file.exists) file.delete();
      file.create();
      file.write(stockCsv(db));

      if (!(await Sharing.isAvailableAsync())) {
        say('Не получится поделиться', `Файл сохранён: ${file.uri}`);
        return;
      }
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
    } catch (error) {
      say('Не удалось выгрузить остатки', String(error));
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
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

      <Card>
        <View style={styles.stats}>
          <Stat label="Выручка" value={formatMoneyWithSign(summary.revenue)} />
          <Stat
            label="Прибыль"
            value={formatMoneyWithSign(summary.profit)}
            tone={summary.profit < 0 ? 'danger' : undefined}
          />
        </View>
        <View style={[styles.stats, styles.statsSecond]}>
          <Stat label="Чеков" value={String(summary.receipts)} />
          <Stat label="Средний чек" value={formatMoneyWithSign(summary.averageReceipt)} />
        </View>
        {summary.discounts > 0 ? (
          <Text style={[text.muted, styles.discountNote]}>
            Скидок дано на {formatMoneyWithSign(summary.discounts)}
          </Text>
        ) : null}
      </Card>

      <Chart points={daily} />

      <Card style={styles.listCard}>
        <Text style={[text.heading, styles.listTitle]}>Лучше всего продаётся</Text>
        {top.length === 0 ? (
          <Text style={[text.muted, styles.listEmpty]}>За период продаж не было</Text>
        ) : (
          top.map((item) => (
            <Row
              key={item.product_id}
              left={
                <>
                  <Text style={text.body} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={text.muted}>{formatQtyWithUnit(item.qty, item.unit)}</Text>
                </>
              }
              right={
                <>
                  <Text style={text.amount}>{formatMoneyWithSign(item.revenue)}</Text>
                  <Text style={text.muted}>прибыль {formatMoney(item.profit)}</Text>
                </>
              }
            />
          ))
        )}
      </Card>

      <Card style={styles.listCard}>
        <Text style={[text.heading, styles.listTitle]}>Пора закупить</Text>
        {lowStock.length === 0 ? (
          <Text style={[text.muted, styles.listEmpty]}>Всё в наличии</Text>
        ) : (
          lowStock.map((product) => (
            <Row
              key={product.id}
              onPress={() =>
                router.push({ pathname: '/product/[id]', params: { id: String(product.id) } })
              }
              left={
                <>
                  <Text style={text.body} numberOfLines={1}>
                    {product.name}
                  </Text>
                  <Text style={text.muted}>
                    порог {formatQtyWithUnit(product.min_qty, product.unit)}
                  </Text>
                </>
              }
              right={
                <Badge
                  label={formatQtyWithUnit(product.stock, product.unit)}
                  tone={product.stock <= 0 ? 'danger' : 'warning'}
                />
              }
            />
          ))
        )}
      </Card>

      <Card>
        <Text style={text.heading}>Склад сейчас</Text>
        <View style={[styles.stats, styles.statsSecond]}>
          <Stat label="В закупочных ценах" value={formatMoneyWithSign(stock.costValue)} />
          <Stat label="В ценах продажи" value={formatMoneyWithSign(stock.retailValue)} />
        </View>
        <Text style={[text.muted, styles.discountNote]}>
          {pluralize(stock.positions, 'позиция', 'позиции', 'позиций')} с остатком
        </Text>
      </Card>

      <Button title="Выгрузить остатки в CSV" variant="secondary" onPress={exportStock} />
    </ScrollView>
  );
}

/**
 * График выручки по дням — обычными View, без графической библиотеки:
 * столбики и подписи это всё, что здесь нужно показать.
 */
function Chart({ points }: { points: DailyPoint[] }) {
  if (points.length === 0) {
    return (
      <Card>
        <Empty title="Продаж за период не было" />
      </Card>
    );
  }

  const max = Math.max(...points.map((p) => p.revenue), 1);

  return (
    <Card>
      <Text style={text.heading}>Выручка по дням</Text>
      <View style={styles.chart}>
        {points.map((point) => (
          <View key={point.day} style={styles.chartColumn}>
            <View style={styles.chartBarArea}>
              <View
                style={[
                  styles.chartBar,
                  // Минимум 2% — иначе день с маленькой выручкой выглядит как ноль.
                  { height: `${Math.max((point.revenue / max) * 100, 2)}%` },
                ]}
              />
            </View>
            <Text style={styles.chartLabel} numberOfLines={1}>
              {point.day.slice(8)}
            </Text>
          </View>
        ))}
      </View>
      <Text style={text.muted}>Максимум за день: {formatMoneyWithSign(max)}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  periods: { flexDirection: 'row', gap: spacing.sm },
  period: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodActive: { backgroundColor: colors.primary },
  periodText: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  periodTextActive: { color: colors.primaryText },
  stats: { flexDirection: 'row', gap: spacing.md },
  statsSecond: { marginTop: spacing.md },
  discountNote: { marginTop: spacing.sm },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    height: 140,
    marginVertical: spacing.md,
  },
  chartColumn: { flex: 1, alignItems: 'center', height: '100%' },
  chartBarArea: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  chartBar: { width: '100%', backgroundColor: colors.primary, borderRadius: 4 },
  chartLabel: { fontSize: 10, color: colors.textMuted, marginTop: spacing.xs },
  listCard: { padding: 0, paddingTop: spacing.lg, overflow: 'hidden' },
  listTitle: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  listEmpty: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
});
