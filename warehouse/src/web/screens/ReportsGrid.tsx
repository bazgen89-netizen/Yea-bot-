import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { REPORTS } from '../../db/reportTypes';
import { WebIcon } from '../../ui/icons';
import { web, webText, WEB_FONT } from '../../ui/webTheme';

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

/**
 * Значки — те же, что в исходном приложении: у каждого отчёта в его коде
 * прописан свой (`cube`, `tags`, `cubes`, `refresh`, `users`, `dollar`).
 */
const ICONS: Record<string, keyof typeof WebIcon> = {
  product: 'products',
  categories: 'folder',
  set: 'products',
  day: 'calendar',
  week: 'calendar',
  month: 'calendar',
  motion: 'goods',
  agent: 'company',
  finance: 'money',
  staff: 'company',
  stock: 'reports',
  accounts: 'money',
};

const tiles: Tile[] = REPORTS.map((report) => ({
  id: report.id,
  label: report.title,
  icon: ICONS[report.id] ?? 'reports',
}));

/**
 * Конструктор отчётов. В исходном приложении работает только «Продажи», а
 * «Склад» и «Финансы» помечены ленточкой «В разработке» — повторяем это, а не
 * делаем вид, что у нас их три.
 */
const BUILDER = [
  { name: 'Продажи', ready: true, reports: ['product', 'categories', 'day', 'week', 'month'] },
  { name: 'Склад', ready: false, reports: [] as string[] },
  { name: 'Финансы', ready: false, reports: [] as string[] },
];

export function ReportsGrid() {
  const [tab, setTab] = useState('Продажи');
  const current = BUILDER.find((item) => item.name === tab) ?? BUILDER[0];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={webText.pageTitle}>Выберите тип отчёта</Text>

      <View style={styles.divider} />
      <Grid tiles={tiles} />

      <View style={styles.tabs}>
        {BUILDER.map((item) => (
          <Pressable
            key={item.name}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === item.name, disabled: !item.ready }}
            disabled={!item.ready}
            onPress={() => setTab(item.name)}
            style={[styles.tab, tab === item.name && item.ready && styles.tabActive]}
          >
            <Text style={styles.tabHint}>Конструктор отчетов</Text>
            <Text style={styles.tabLabel}>{item.name}</Text>
            {item.ready ? null : <Text style={styles.ribbon}>В разработке</Text>}
          </Pressable>
        ))}
      </View>

      <Grid tiles={current.reports.map((id) => tiles.find((tile) => tile.id === id)!).filter(Boolean)} />
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
          {WebIcon[tile.icon]({ size: 66, color: '#CCCCCC' })}
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
  // Плитка отчёта в оригинале — 15,5 пикселя, значок 66, цвет значка #ccc.
  tileLabel: { fontFamily: WEB_FONT, fontSize: 15.5, color: web.text, textAlign: 'center', lineHeight: 21 },
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
  tabHint: { fontFamily: WEB_FONT, fontSize: 13, color: '#FFFFFF' },
  tabLabel: { fontFamily: WEB_FONT, fontSize: 21, color: '#FFFFFF', fontWeight: '700' },
  ribbon: { fontFamily: WEB_FONT, fontSize: 12, color: '#FFFFFF', opacity: 0.85 },
});
