import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../Translated';

import { Chart } from '../Chart';
import { Dropdown, type Option } from '../Dropdown';
import { listLocations } from '../../db/locations';
import {
  documentTotals,
  periodFor,
  salesSummary,
  stockOverview,
  dailySales,
  type PeriodKind,
  type Scope,
} from '../../db/reports';
import { formatMoneyWeb } from '../../domain/money';
import { formatQtyWeb } from '../../domain/qty';
import { useQuery } from '../../state/DatabaseProvider';
import { useLanguage } from '../../state/LanguageProvider';
import { web, webText, WEB_FONT } from '../../ui/webTheme';

/** Периоды выпадающего списка — те же и в том же порядке, что в оригинале. */
const PERIODS: Option<PeriodKind>[] = [
  { value: 'today', label: 'сегодня' },
  { value: 'week', label: 'неделю' },
  { value: 'month', label: 'месяц' },
  { value: 'quarter', label: 'квартал' },
  { value: 'year', label: 'год' },
];

/** Сколько столбиков рисует график — по длине выбранного периода. */
const CHART_DAYS: Record<PeriodKind, number> = {
  today: 1,
  week: 7,
  month: 31,
  quarter: 90,
  year: 365,
};

/** Главная кабинета: показатели за период, график, документы и оценка склада. */
export function HomeDashboard() {
  const { t } = useLanguage();
  const [kind, setKind] = useState<PeriodKind>('month');
  // «Документы» живут своим периодом: в оригинале там по умолчанию неделя,
  // а в показателях — месяц.
  const [docsKind, setDocsKind] = useState<PeriodKind>('week');
  const [scope, setScope] = useState<Scope>(null);

  const period = useMemo(() => periodFor(kind), [kind]);
  const docsPeriod = useMemo(() => periodFor(docsKind), [docsKind]);

  const periods = PERIODS.map((period) => ({ ...period, label: t(period.label) }));
  const locations = useQuery((db) => listLocations(db));
  const byName = locations.map((location) => ({
    value: String(location.id),
    label: location.name,
  }));
  // В заголовке список стоит после предлога — «по [всем магазинам]»; отдельной
  // кнопкой предлог нужен ей самой.
  const stores: Option<string>[] = [{ value: 'all', label: t('всем магазинам') }, ...byName];
  const storesChip: Option<string>[] = [{ value: 'all', label: t('по всем магазинам') }, ...byName];

  const summary = useQuery((db) => salesSummary(db, period, scope), [period.from, scope]);
  const daily = useQuery((db) => dailySales(db, period, scope), [period.from, scope]);
  const documents = useQuery(
    (db) => documentTotals(db, docsPeriod, scope),
    [docsPeriod.from, scope],
  );
  const stock = useQuery((db) => stockOverview(db, scope), [scope]);

  const pickStore = (value: string) => setScope(value === 'all' ? null : Number(value));
  const storeValue = scope === null ? 'all' : String(scope);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.pageTitle}>
        <Text style={webText.pageTitle}>{t('Показатели за')}</Text>
        <Dropdown
          value={kind}
          options={periods}
          onChange={setKind}
          variant="dotted"
          label={t('Показатели за')}
        />
        <Text style={webText.pageTitle}>{t('по')}</Text>
        <Dropdown
          value={storeValue}
          options={stores}
          onChange={pickStore}
          variant="dotted"
          label={t('Магазины')}
        />
      </View>

      <View style={styles.top}>
        <View style={styles.metrics}>
          <Metric label={t('Выручка')} value={formatMoneyWeb(summary.revenue)} highlight />
          <Metric label={t('Себестоимость продаж')} value={formatMoneyWeb(summary.cost)} />
          <Metric label={t('Прибыль')} value={formatMoneyWeb(summary.profit)} />
          <Metric label={t('Средний чек')} value={formatMoneyWeb(summary.averageReceipt)} />
        </View>

        <View style={styles.chartCard}>
          <View style={styles.chartLegend}>
            <Text style={styles.chartLegendText}>{t('Выручка')}</Text>
          </View>
          <Chart points={daily.map((point) => point.revenue)} days={CHART_DAYS[kind]} />
        </View>
      </View>

      <View style={styles.bottom}>
        <View style={styles.documents}>
          <View style={styles.blockHead}>
            <Text style={webText.blockTitle}>{t('Документы')}</Text>
            <Dropdown
              value={docsKind}
              options={periods}
              onChange={setDocsKind}
              width={150}
              label={t('Документы')}
            />
          </View>

          <View style={styles.docHead}>
            <Text style={[styles.docName, styles.docHeadText]}>{t('Наименование')}</Text>
            <Text style={[styles.docCount, styles.docHeadText]}>{t('Кол-во')}</Text>
            <Text style={[styles.docNumber, styles.docHeadText]}>{t('Сумма')}</Text>
            <Text style={[styles.docNumber, styles.docHeadText]}>{t('Склад')}</Text>
          </View>

          {documents.map((row) => (
            <View key={row.name} style={styles.docRow}>
              <Text style={[styles.docName, webText.cell]}>{t(row.name)}</Text>
              <Text style={[styles.docCount, webText.cellNumber]}>{row.count}</Text>
              <Text style={[styles.docNumber, webText.cellNumber]}>
                {formatMoneyWeb(row.amount)}
              </Text>
              <Text style={[styles.docNumber, webText.cellNumber]}>
                {row.quantity === 0 ? '0' : formatQtyWeb(row.quantity)}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.stock}>
          <View style={styles.blockHead}>
            <Text style={webText.blockTitle}>{t('Оценка склада')}</Text>
            <Dropdown
              value={storeValue}
              options={storesChip}
              onChange={pickStore}
              width={220}
              label={t('Оценка склада')}
            />
          </View>

          {stock.zeroCost > 0 || stock.negative > 0 ? (
            <View style={styles.warning}>
              <Text style={styles.warningTitle}>{t('Внимание')}</Text>
              {stock.zeroCost > 0 ? (
                <Text style={styles.warningLine}>
                  •{' '}
                  <Text style={styles.warningLink}>
                    {stock.zeroCost} {t('поз. с себестоимостью равной 0 руб')}
                  </Text>
                </Text>
              ) : null}
              {stock.negative > 0 ? (
                <Text style={styles.warningLine}>
                  •{' '}
                  <Text style={styles.warningLink}>
                    {stock.negative} {t('поз. с остатком меньше 0')}
                  </Text>
                </Text>
              ) : null}
            </View>
          ) : null}

          <Text style={styles.stockLabel}>{t('Количество товара')}</Text>
          <Text style={styles.stockQty}>{formatQtyWeb(stock.quantity)} {t('ед.')}</Text>

          <View style={styles.stockValues}>
            <View style={styles.stockValue}>
              <Text style={styles.stockLabel}>{t('Стоимость товара')}</Text>
              <Text style={styles.stockSub}>{t('В розничных ценах')}</Text>
              <Text style={styles.stockAmount}>{formatMoneyWeb(stock.retailValue)} {t('руб')}</Text>
            </View>
            <View style={styles.stockValue}>
              <Text style={styles.stockLabel}>{t('Стоимость товара')}</Text>
              <Text style={styles.stockSub}>{t('По себестоимости')}</Text>
              <Text style={styles.stockAmount}>{formatMoneyWeb(stock.costValue)} {t('руб')}</Text>
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
  pageTitle: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
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
  chartLegendText: { color: '#FFFFFF', fontFamily: WEB_FONT, fontSize: 14 },
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
  docHead: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: web.border,
  },
  docHeadText: { fontFamily: WEB_FONT, fontSize: 15, color: web.text },
  docRow: {
    flexDirection: 'row',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: web.gridLine,
  },
  // Доли колонок — те же, что в оригинале: 36 / 24 / 20 / 20 %.
  docName: { width: '36%' },
  docCount: { width: '24%', textAlign: 'right' },
  docNumber: { width: '20%', textAlign: 'right' },
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
  warningTitle: { fontFamily: WEB_FONT, fontSize: 15, fontWeight: '700', color: web.warningText },
  warningLine: { fontFamily: WEB_FONT, fontSize: 14, color: web.warningText },
  warningLink: { color: web.link },
  stockLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.text },
  stockSub: { fontFamily: WEB_FONT, fontSize: 15, color: web.text, fontWeight: '600' },
  stockQty: { fontFamily: WEB_FONT, fontSize: 30, color: web.text, fontVariant: ['tabular-nums'] },
  stockValues: { flexDirection: 'row', gap: 26, marginTop: 6 },
  stockValue: { flex: 1, gap: 2 },
  stockAmount: { fontFamily: WEB_FONT, fontSize: 26, color: web.text, fontVariant: ['tabular-nums'], marginTop: 6 },
});
