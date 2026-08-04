import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppHeader } from '../../src/ui/AppHeader';
import { Icon } from '../../src/ui/icons';
import { colors, radius, shadow, spacing, text } from '../../src/ui/theme';

interface MenuItem {
  label: string;
  icon: keyof typeof Icon;
  href: string;
}

const SECTIONS: { title: string; items: MenuItem[] }[] = [
  {
    title: 'Справочники',
    items: [
      { label: 'Товары', icon: 'box', href: '/catalog' },
      { label: 'Клиенты', icon: 'store', href: '/counterparties?kind=customer' },
      { label: 'Поставщики', icon: 'store', href: '/counterparties?kind=supplier' },
      { label: 'Магазины', icon: 'store', href: '/locations' },
    ],
  },
  {
    title: 'Отчёты',
    items: [
      { label: 'Все отчёты', icon: 'journal', href: '/reports' },
      { label: 'Оценка склада', icon: 'box', href: '/reports/stock' },
    ],
  },
  {
    title: 'Настройки',
    items: [
      { label: 'Сотрудники', icon: 'store', href: '/staff' },
      { label: 'Синхронизация', icon: 'refresh', href: '/settings/sync' },
      { label: 'Резервная копия', icon: 'journal', href: '/settings/backup' },
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
                <View style={styles.symbol}>
                  {Icon[item.icon]({ size: 21, color: colors.textMuted })}
                </View>
                <Text style={styles.label}>{item.label}</Text>
                <Icon.chevron />
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
  symbol: { width: 28, alignItems: 'center' },
  label: { flex: 1, fontSize: 16, color: colors.text },
});
