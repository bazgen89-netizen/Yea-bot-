import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Chart } from '../Chart';
import { documentTotals, periodFor, salesSummary, stockOverview, dailySales } from '../../db/reports';
import { formatMoneyWeb } from '../../domain/money';
import { formatQty } from '../../domain/qty';
import { pluralize } from '../../domain/plural';
import { useQuery } from '../../state/DatabaseProvider';
import { web, webText } from '../../ui/webTheme';

/** Главная кабинета: показатели за месяц, график, документы и оценка склада. */
export function HomeDashboard() {
  const period = periodFor('month');

  const summary = useQuery((db) => salesSummary(db, period), [period.from]);
  const daily = useQuery((db) => dailySales(db, period), [period.from]);
  const documents = useQuery((db) => documentTotals(db, period), [period.from]);
  const stock = useQuery((db) => stockOverview(db));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={webText.pageTitle}>
        Показатели за <Text style={styles.dotted}>месяц</Text> по{' '}
        <Text style={styles.dotted}>всем магазинам</Text>
      </Text>

      <View style={styles.top}>
        <View style={styles.metrics}>
          <Metric label="Выручка" value={formatMoneyWeb(summary.revenue)} highlight />
          <Metric label="Себестоимость продаж" value={formatMoneyWeb(summary.cost)} />
          <Metric label="Прибыль" value={formatMoneyWeb(summary.profit)} />
          <Metric label="Средний чек" value={formatMoneyWeb(summary.averageReceipt)} />
        </View>

        <View style={styles.chartCard}>
          <View style={styles.chartLegend}>
            <Text style={styles.chartLegendText}>Выручка</Text>
          </View>
          <Chart points={daily.map((point) => point.revenue)} days={31} />
        </View>
      </View>

      <View style={styles.bottom}>
        <View style={styles.documents}>
          <View style={styles.blockHead}>
            <Text style={webText.blockTitle}>Документы</Text>
            <View style={styles.periodChip}>
              <Text style={styles.periodChipText}>неделю</Text>
            </View>
          </View>

          <View style={styles.docHead}>
            <Text style={[styles.docName, styles.docHeadText]}>Наименование</Text>
            <Text style={[styles.docNumber, styles.docHeadText]}>Кол-во</Text>
            <Text style={[styles.docNumber, styles.docHeadText]}>Сумма</Text>
            <Text style={[styles.docNumber, styles.docHeadText]}>Склад</Text>
          </View>

          {documents.map((row) => (
            <View key={row.name} style={styles.docRow}>
              <Text style={[styles.docName, webText.cell]}>{row.name}</Text>
              <Text style={[styles.docNumber, webText.cellNumber]}>{row.count}</Text>
              <Text style={[styles.docNumber, webText.cellNumber]}>
                {formatMoneyWeb(row.amount)}
              </Text>
              <Text style={[styles.docNumber, webText.cellNumber]}>
                {row.quantity === 0 ? '0' : formatQty(row.quantity)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.stock}>
          <Text style={webText.blockTitle}>
            Оценка склада по <Text style={styles.dotted}>всем магазинам</Text>
          </Text>

          {stock.zeroCost > 0 || stock.negative > 0 ? (
            <View style={styles.warning}>
              <Text style={styles.warningTitle}>Внимание</Text>
              {stock.zeroCost > 0 ? (
                <Text style={styles.warningLine}>
                  •{' '}
                  <Text style={styles.warningLink}>
                    {pluralize(stock.zeroCost, 'поз.', 'поз.', 'поз.')} с себестоимостью равной 0 руб
                  </Text>
                </Text>
              ) : null}
              {stock.negative > 0 ? (
                <Text style={styles.warningLine}>
                  •{' '}
                  <Text style={styles.warningLink}>
                    {pluralize(stock.negative, 'поз.', 'поз.', 'поз.')} с остатком меньше 0
                  </Text>
                </Text>
              ) : null}
            </View>
          ) : null}

          <Text style={styles.stockLabel}>Количество товара</Text>
          <Text style={styles.stockQty}>{formatQty(stock.quantity)} ед.</Text>

          <View style={styles.stockValues}>
            <View style={styles.stockValue}>
              <Text style={styles.stockLabel}>Стоимость товара</Text>
              <Text style={styles.stockSub}>В розничных ценах</Text>
              <Text style={styles.stockAmount}>{formatMoneyWeb(stock.retailValue)} руб</Text>
            </View>
            <View style={styles.stockValue}>
              <Text style={styles.stockLabel}>Стоимость товара</Text>
              <Text style={styles.stockSub}>По себестоимости</Text>
              <Text style={styles.stockAmount}>{formatMoneyWeb(stock.costValue)} руб</Text>
            </View>
          </View>
        </View>
      </View>
    </ScrollView>
  );
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
    <View style={[styles.metric, highlight && styles.metricHighlight]}>
      <Text style={webText.metric}>{value}</Text>
      <Text style={webText.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  content: { padding: 26, gap: 26 },
  dotted: { textDecorationLine: 'underline', textDecorationStyle: 'dotted' },
  top: { flexDirection: 'row', gap: 26 },
  metrics: { width: 350, gap: 4 },
  metric: { paddingVertical: 16, paddingHorizontal: 18, gap: 4 },
  metricHighlight: { backgroundColor: '#F4F5F7' },
  chartCard: { flex: 1, minHeight: 300, justifyContent: 'flex-end' },
  chartLegend: {
    alignSelf: 'center',
    backgroundColor: '#5FA8DE',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 3,
    marginBottom: 12,
  },
  chartLegendText: { color: '#FFFFFF', fontSize: 14 },
  bottom: { flexDirection: 'row', gap: 26, alignItems: 'flex-start' },
  documents: {
    flex: 1,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    padding: 22,
  },
  blockHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  periodChip: {
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  periodChipText: { fontSize: 14, color: web.text },
  docHead: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: web.border,
  },
  docHeadText: { fontSize: 15, color: web.text },
  docRow: {
    flexDirection: 'row',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: web.gridLine,
  },
  docName: { flex: 1 },
  docNumber: { width: 120, textAlign: 'right' },
  stock: {
    flex: 1,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    padding: 22,
    gap: 14,
  },
  warning: {
    backgroundColor: web.warningBg,
    padding: 16,
    gap: 6,
  },
  warningTitle: { fontSize: 15, fontWeight: '700', color: web.warningText },
  warningLine: { fontSize: 14, color: web.warningText },
  warningLink: { color: web.link },
  stockLabel: { fontSize: 15, color: web.text },
  stockSub: { fontSize: 15, color: web.text, fontWeight: '600' },
  stockQty: { fontSize: 30, color: web.text, fontVariant: ['tabular-nums'] },
  stockValues: { flexDirection: 'row', gap: 26, marginTop: 6 },
  stockValue: { flex: 1, gap: 2 },
  stockAmount: { fontSize: 26, color: web.text, fontVariant: ['tabular-nums'], marginTop: 6 },
});
