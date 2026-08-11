import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { REPORTS, reportById } from '../../src/db/reportTypes';
import { periodFor, type PeriodKind } from '../../src/db/reports';
import { useDatabase, useQuery } from '../../src/state/DatabaseProvider';
import { saveFile } from '../../src/ui/download';
import { useDesktop } from '../../src/ui/useDesktop';
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
        <ToolButton label="Фильтр" tone="plain" onPress={download} />
        <ToolButton label="Все отчёты" onPress={() => router.replace('/reports')} />
      </Toolbar>

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <HeadRow columns={columns} />

          <ScrollView>
            {/* «ИТОГ» стоит первой строкой, а не последней: в отчёте на
                семьсот строк итог внизу пришлось бы искать прокруткой. */}
            {total ? (
              <View style={styles.totalRow}>
                {total.map((cell, index) => (
                  <Text
                    key={index}
                    style={[
                      styles.totalCell,
                      { width: report.columns[index]?.width ?? 160 },
                      report.columns[index]?.numeric && styles.right,
                    ]}
                  >
                    {cell}
                  </Text>
                ))}
              </View>
            ) : null}

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
    </View>
  );
}

const styles = StyleSheet.create({
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
