import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { WebIcon } from '../../ui/icons';
import { web, webText } from '../../ui/webTheme';

/**
 * «Выберите тип отчёта» — плитки кабинета.
 *
 * Плитки перечислены все, что есть в исходном приложении, включая ещё не
 * сделанные: список отчётов — это обещание, и урезать его молча нельзя.
 * Готовые открываются, остальные помечены.
 */

interface Tile {
  label: string;
  icon: keyof typeof WebIcon;
  href?: Href;
}

const MAIN: Tile[] = [
  { label: 'Продажи по\nдням', icon: 'calendar', href: '/reports' },
  { label: 'Продажи по\nнеделям', icon: 'calendar' },
  { label: 'Продажи по\nмесяцам', icon: 'calendar' },
  { label: 'Отчёт по\nдвижению', icon: 'goods', href: '/journal' },
  { label: 'Отчёт по\nагентам', icon: 'company' },
  { label: 'Финансовый\nотчёт', icon: 'money', href: '/money' },
  { label: 'Отчёт по\nсотрудникам', icon: 'company' },
  { label: 'Отчет по\nсчетам', icon: 'money' },
];

const BUILDER: Record<string, Tile[]> = {
  Продажи: [
    { label: 'Продажи по\nтоварам', icon: 'products', href: '/reports' },
    { label: 'Продажи по\nкатегориям', icon: 'billing' },
    { label: 'Продажи по\nкомплектам', icon: 'products' },
    { label: 'Продажи по\nдням', icon: 'calendar', href: '/reports' },
    { label: 'Продажи по\nнеделям', icon: 'calendar' },
    { label: 'Продажи по\nмесяцам', icon: 'calendar' },
  ],
  Склад: [
    { label: 'Остатки по\nмагазинам', icon: 'products', href: '/catalog' },
    { label: 'Движение\nтовара', icon: 'goods', href: '/journal' },
    { label: 'Оценка\nсклада', icon: 'reports', href: '/' },
  ],
  Финансы: [
    { label: 'Движение\nденег', icon: 'money', href: '/money' },
    { label: 'Отчет по\nсчетам', icon: 'money' },
    { label: 'Финансовый\nотчёт', icon: 'money', href: '/money' },
  ],
};

export function ReportsGrid() {
  const [tab, setTab] = useState<keyof typeof BUILDER>('Продажи');

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={webText.pageTitle}>Выберите тип отчёта</Text>

      <View style={styles.divider} />
      <Grid tiles={MAIN} />

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

      <Grid tiles={BUILDER[tab]} />
    </ScrollView>
  );
}

function Grid({ tiles }: { tiles: Tile[] }) {
  const router = useRouter();

  return (
    <View style={styles.grid}>
      {tiles.map((tile) => (
        <Pressable
          key={tile.label}
          accessibilityRole="button"
          onPress={() => tile.href && router.push(tile.href)}
          style={(state) => [
            styles.tile,
            (state as { hovered?: boolean }).hovered && tile.href && styles.tileHover,
          ]}
        >
          {WebIcon[tile.icon]({ size: 62, color: '#D3D6D9' })}
          <Text style={[styles.tileLabel, !tile.href && { color: web.textMuted }]}>
            {tile.label}
          </Text>
          {tile.href ? null : <Text style={styles.soon}>скоро</Text>}
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
    width: '33.33%',
    alignItems: 'center',
    paddingVertical: 34,
    gap: 14,
    borderRadius: 3,
  },
  tileHover: { backgroundColor: web.rowHover },
  tileLabel: { fontSize: 17, color: web.text, textAlign: 'center', lineHeight: 23 },
  soon: { fontSize: 12, color: web.textMuted },
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
