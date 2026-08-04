import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppHeader } from '../../src/ui/AppHeader';
import { colors, radius, shadow, spacing, text } from '../../src/ui/theme';

interface MenuItem {
  label: string;
  symbol: string;
  href: string;
  hint?: string;
}

const SECTIONS: { title: string; items: MenuItem[] }[] = [
  {
    title: 'Справочники',
    items: [
      { label: 'Товары', symbol: '📦', href: '/catalog' },
      { label: 'Клиенты', symbol: '🧍', href: '/counterparties?kind=customer' },
      { label: 'Поставщики', symbol: '🚚', href: '/counterparties?kind=supplier' },
      { label: 'Магазины', symbol: '🏪', href: '/locations' },
    ],
  },
  {
    title: 'Отчёты',
    items: [
      { label: 'Все отчёты', symbol: '📊', href: '/reports' },
      { label: 'Оценка склада', symbol: '🏷️', href: '/reports/stock' },
    ],
  },
  {
    title: 'Настройки',
    items: [
      { label: 'Сотрудники', symbol: '🧑‍💼', href: '/staff' },
      { label: 'Синхронизация', symbol: '🔄', href: '/settings/sync' },
      { label: 'Резервная копия', symbol: '💾', href: '/settings/backup' },
    ],
  },
];

export default function MenuScreen() {
  const router = useRouter();

  return (
    <View style={styles.screen}>
      <AppHeader title="Меню" />

      <ScrollView contentContainerStyle={styles.content}>
        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.card}>
            <Text style={text.block}>{section.title}</Text>
            {section.items.map((item, index) => (
              <Pressable
                key={item.label}
                accessibilityRole="button"
                onPress={() => router.push(item.href)}
                style={({ pressed }) => [
                  styles.row,
                  index < section.items.length - 1 && styles.divider,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Text style={styles.symbol}>{item.symbol}</Text>
                <Text style={styles.label}>{item.label}</Text>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    ...shadow,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  symbol: { fontSize: 20, width: 28, textAlign: 'center' },
  label: { flex: 1, fontSize: 16, color: colors.text },
  chevron: { fontSize: 22, color: colors.textMuted },
});
