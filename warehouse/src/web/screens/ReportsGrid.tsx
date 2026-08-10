import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { REPORTS } from '../../db/reportTypes';
import { WebIcon } from '../../ui/icons';
import { web, webText } from '../../ui/webTheme';

/**
 * «Выберите тип отчёта» — плитки кабинета.
 *
 * Плитки собраны из реестра отчётов: каждая существует ровно потому, что за
 * ней есть отчёт, и открывает именно его. Раньше список был написан руками и
 * половина плиток не вела никуда — плитка, которая ничего не открывает, хуже
 * отсутствующей: по ней судят, что в программе есть.
 */

interface Tile {
  id: string;
  label: string;
  icon: keyof typeof WebIcon;
}

const ICONS: Record<string, keyof typeof WebIcon> = {
  'sales-by-day': 'calendar',
  'sales-by-week': 'calendar',
  'sales-by-month': 'calendar',
  'sales-by-product': 'products',
  movement: 'goods',
  financial: 'money',
  accounts: 'money',
  'stock-by-store': 'products',
  'stock-value': 'reports',
  'low-stock': 'funnel',
};

const tiles: Tile[] = REPORTS.map((report) => ({
  id: report.id,
  label: report.title,
  icon: ICONS[report.id] ?? 'reports',
}));

/** Вкладки конструктора: те же отчёты, разложенные по смыслу. */
const BUILDER: Record<string, string[]> = {
  Продажи: ['sales-by-product', 'sales-by-day', 'sales-by-week', 'sales-by-month'],
  Склад: ['stock-by-store', 'movement', 'stock-value', 'low-stock'],
  Финансы: ['financial', 'accounts'],
};

export function ReportsGrid() {
  const [tab, setTab] = useState<keyof typeof BUILDER>('Продажи');

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={webText.pageTitle}>Выберите тип отчёта</Text>

      <View style={styles.divider} />
      <Grid tiles={tiles} />

      <View style={styles.tabs}>
        {(Object.keys(BUILDER) as (keyof typeof BUILDER)[]).map((name) => (
          <Pressable
            key={name}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === name }}
            onPress={() => setTab(name)}
            style={[styles.tab, tab === name && styles.tabActive]}
          >
            <Text style={styles.tabHint}>Конструктор отчетов</Text>
            <Text style={styles.tabLabel}>{name}</Text>
          </Pressable>
        ))}
      </View>

      <Grid tiles={BUILDER[tab].map((id) => tiles.find((tile) => tile.id === id)!).filter(Boolean)} />
    </ScrollView>
  );
}

function Grid({ tiles: items }: { tiles: Tile[] }) {
  const router = useRouter();

  return (
    <View style={styles.grid}>
      {items.map((tile) => (
        <Pressable
          key={tile.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/reports/[type]', params: { type: tile.id } })}
          style={(state) => [styles.tile, (state as { hovered?: boolean }).hovered && styles.tileHover]}
        >
          {WebIcon[tile.icon]({ size: 62, color: '#D3D6D9' })}
          <Text style={styles.tileLabel}>{tile.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  content: { padding: 26, paddingBottom: 60 },
  divider: { height: 1, backgroundColor: web.border, marginTop: 22, marginBottom: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: {
    width: '25%',
    alignItems: 'center',
    paddingVertical: 34,
    gap: 14,
    borderRadius: 3,
  },
  tileHover: { backgroundColor: web.rowHover },
  tileLabel: { fontSize: 17, color: web.text, textAlign: 'center', lineHeight: 23 },
  tabs: { flexDirection: 'row', gap: 24, marginTop: 30, marginBottom: 6 },
  tab: {
    width: 224,
    paddingVertical: 14,
    paddingHorizontal: 18,
    backgroundColor: '#BDBDBD',
    alignItems: 'center',
    gap: 4,
  },
  tabActive: { backgroundColor: '#5FA8DE' },
  tabHint: { fontSize: 13, color: '#FFFFFF' },
  tabLabel: { fontSize: 21, color: '#FFFFFF', fontWeight: '700' },
});
