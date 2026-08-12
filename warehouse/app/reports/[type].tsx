import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { REPORTS, reportById, type ReportDefinition } from '../../src/db/reportTypes';
import { periodFor, type PeriodKind } from '../../src/db/reports';
import { useDatabase, useQuery } from '../../src/state/DatabaseProvider';
import { saveFile } from '../../src/ui/download';
import { useDesktop } from '../../src/ui/useDesktop';
import { WebIcon } from '../../src/ui/icons';
import { web, webText } from '../../src/ui/webTheme';
import { colors, spacing, text as phoneText } from '../../src/ui/theme';
import { Dropdown, type Option } from '../../src/web/Dropdown';
import { Column, HeadRow, Row, ToolButton, Toolbar } from '../../src/web/Table';

/**
 * Один экран на все отчёты.
 *
 * Отчёт описан данными — колонки и функция строк, — поэтому экран не знает,
 * что именно он показывает. Новый отчёт добавляется записью в реестр, а не
 * ещё одним экраном, который придётся вручную держать похожим на остальные.
 */

const PERIODS: Option<PeriodKind>[] = [
  { value: 'today', label: 'сегодня' },
  { value: 'week', label: 'неделю' },
  { value: 'month', label: 'месяц' },
  { value: 'quarter', label: 'квартал' },
  { value: 'year', label: 'год' },
];

/** Список отчётов для выпадающего списка в панели. */
const REPORT_OPTIONS: Option<string>[] = REPORTS.map((report) => ({
  value: report.id,
  label: report.title,
}));

export default function ReportScreen() {
  const router = useRouter();
  const { db } = useDatabase();
  const desktop = useDesktop();
  const params = useLocalSearchParams<{ type?: string }>();

  const report = reportById(params.type);
  const [kind, setKind] = useState<PeriodKind>('month');
  // Таблица или график — переключатель у него стоит в той же панели.
  const [view, setView] = useState<'table' | 'chart'>('table');
  const period = useMemo(() => periodFor(kind), [kind]);

  const rows = useQuery(
    (database) => (report ? report.rows(database, period) : []),
    [report?.id, period.from],
  );
  const total = useQuery(
    (database) => (report?.total ? report.total(database, period) : null),
    [report?.id, period.from],
  );

  if (!report) {
    return (
      <View style={styles.missing}>
        <Stack.Screen options={{ title: 'Отчёт' }} />
        <Text style={webText.pageTitle}>Такого отчёта нет</Text>
        <ToolButton label="К списку отчётов" onPress={() => router.replace('/reports')} />
      </View>
    );
  }

  const columns: Column[] = report.columns.map((column, index) => ({
    key: String(index),
    title: column.title,
    width: column.width,
    numeric: column.numeric,
    help: column.help,
    // Итог стоит в шапке, под названием колонки, — так у него. Отдельной
    // строкой над таблицей он был нашим: у него её нет.
    total: total?.[index],
    // Полоска-график — только у отчётов по датам и только в числовых
    // колонках: в «Наименовании» рисовать нечего.
    chart: report.dates && column.numeric ? columnValues(rows, index) : undefined,
    report: true,
  }));

  async function download() {
    if (!report) return;
    // Точка с запятой и BOM — иначе Excel открывает файл одной колонкой
    // и портит кириллицу.
    const csv =
      '﻿' +
      [report.columns.map((c) => c.title), ...rows, ...(total ? [total] : [])]
        .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
        .join('\r\n');

    await saveFile(`${report.title}.csv`, csv, 'text/csv;charset=utf-8');
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: report.title }} />

      <Toolbar>
        {desktop ? null : <Text style={phoneText.heading}>{report.title}</Text>}
        {/* Отчёт переключается прямо здесь, не возвращаясь к плиткам —
            так это устроено у него: список отчётов первым элементом панели. */}
        <Dropdown
          value={report.id}
          options={REPORT_OPTIONS}
          onChange={(id) => router.replace({ pathname: '/reports/[type]', params: { type: id } })}
          width={232}
          label="Отчёт"
        />
        <Dropdown value={kind} options={PERIODS} onChange={setKind} width={150} label="дата" />
        {report.dates ? (
          <Dropdown
            value={view}
            options={[
              { value: 'table' as const, label: 'таблица' },
              { value: 'chart' as const, label: 'график' },
            ]}
            onChange={setView}
            width={140}
            label="отображение"
          />
        ) : null}
        <ToolButton
          label="Скачать в Excel"
          icon={<WebIcon.excel color={web.text} />}
          onPress={download}
        />
        <ToolButton label="Все отчёты" onPress={() => router.replace('/reports')} />
      </Toolbar>

      {report.dates && view === 'chart' ? (
        <ReportChart report={report} rows={rows} />
      ) : null}

      {report.dates && view === 'chart' ? null : (
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <HeadRow columns={columns} />

          <ScrollView>
            {rows.map((line, index) => (
              <Row key={index}>
                {line.map((cell, cellIndex) => (
                  <Text
                    key={cellIndex}
                    style={[
                      report.columns[cellIndex]?.numeric ? webText.cellNumber : webText.cell,
                      { width: report.columns[cellIndex]?.width ?? 160 },
                      report.columns[cellIndex]?.numeric && styles.right,
                    ]}
                    numberOfLines={1}
                  >
                    {cell}
                  </Text>
                ))}
              </Row>
            ))}

            {rows.length === 0 ? (
              <Text style={styles.empty}>За выбранный период данных нет</Text>
            ) : null}
          </ScrollView>
        </View>
      </ScrollView>
      )}
    </View>
  );
}

/** Столбец таблицы числами — из него рисуется полоска в шапке и большой график. */
function columnValues(rows: string[][], index: number): number[] {
  return rows.map((line) => {
    // В ячейках уже отформатированные строки: «1,300.00», «12», «45%».
    // Разбираем обратно — держать рядом второй, «сырой» набор значило бы
    // иметь два источника правды об одном столбце.
    const clean = String(line[index] ?? '').replace(/\s|,|%|₽/g, '');
    const value = Number(clean);
    return Number.isFinite(value) ? value : 0;
  });
}

/**
 * Крупный график отчёта по датам — то, что показывает переключатель
 * «отображение». По оси названия строк, столбцы — выбранная колонка.
 */
function ReportChart({ report, rows }: { report: ReportDefinition; rows: string[][] }) {
  // Числовых колонок несколько; показываем первую — у него график тоже
  // строится по одной, а не по всем сразу.
  const index = report.columns.findIndex((column) => column.numeric);
  if (index < 0 || rows.length === 0) {
    return <Text style={styles.empty}>За выбранный период данных нет</Text>;
  }

  const values = columnValues(rows, index);
  const peak = Math.max(...values, 1);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View style={styles.chart}>
        {rows.map((line, at) => (
          <View key={at} style={styles.chartSlot}>
            <Text style={styles.chartValue}>{line[index]}</Text>
            <View
              style={[styles.chartBar, { height: Math.max(2, (values[at] / peak) * 240) }]}
            />
            <Text style={styles.chartLabel} numberOfLines={2}>
              {line[0]}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 26, minHeight: 340 },
  chartSlot: { width: 64, alignItems: 'center', gap: 6 },
  chartValue: { fontSize: 11, color: web.textMuted },
  chartBar: { width: '100%', backgroundColor: web.link, borderRadius: 2 },
  chartLabel: { fontSize: 11, color: web.text, textAlign: 'center' },
  screen: { flex: 1, backgroundColor: web.bg },
  missing: { flex: 1, backgroundColor: web.bg, padding: 26, gap: 20, alignItems: 'flex-start' },
  note: { fontSize: 14, color: web.textMuted, paddingHorizontal: 22, paddingBottom: 14 },
  right: { textAlign: 'right' },
  empty: { padding: 40, fontSize: 15, color: web.textMuted },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: web.border,
    backgroundColor: colors.bg,
    gap: spacing.xs,
  },
  totalCell: {
    fontSize: 15,
    fontWeight: '600',
    color: web.text,
    fontVariant: ['tabular-nums'],
  },
});
