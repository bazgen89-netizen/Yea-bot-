import Constants from 'expo-constants';
import { useRouter, type Href } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { countCounterparties } from '../../src/db/counterparties';
import { useQuery } from '../../src/state/DatabaseProvider';
import { Icon, MenuIcon } from '../../src/ui/icons';
import { colors, radius, spacing, text } from '../../src/ui/theme';

interface MenuRow {
  label: string;
  icon: keyof typeof MenuIcon;
  href?: Href;
  /** Ссылка на сайт — открывается в браузере, со стрелкой справа. */
  url?: string;
  /** Число справа: сколько записей в справочнике. */
  count?: number;
  /** Приглушённая строка, как «Корзина» в исходном приложении. */
  dim?: boolean;
  /** Ещё не сделано — строка видна, но помечена. */
  soon?: boolean;
}

/**
 * Меню повторяет разделы привычного пользователю приложения: те же названия,
 * тот же порядок, счётчики справа. Разделы, до которых ещё не дошли руки,
 * не прячутся — иначе непонятно, чего в приложении не хватает.
 */
function useSections(): { title: string; rows: MenuRow[] }[] {
  const customers = useQuery((db) => countCounterparties(db, 'customer'));
  const suppliers = useQuery((db) => countCounterparties(db, 'supplier'));

  return [
    {
      title: 'Компания',
      rows: [
        { label: 'Настройки компании', icon: 'company', soon: true },
        { label: 'Программа лояльности', icon: 'loyalty', soon: true },
        { label: 'Тарифы и оплата', icon: 'billing', soon: true },
      ],
    },
    {
      title: 'Справочники',
      rows: [
        {
          label: 'Клиенты',
          icon: 'customers',
          count: customers,
          href: { pathname: '/counterparties', params: { kind: 'customer' } },
        },
        {
          label: 'Поставщики',
          icon: 'suppliers',
          count: suppliers,
          href: { pathname: '/counterparties', params: { kind: 'supplier' } },
        },
        { label: 'Магазины', icon: 'shops', soon: true },
        { label: 'Счета', icon: 'accounts', soon: true },
        { label: 'Сотрудники', icon: 'staff', soon: true },
        { label: 'Корзина', icon: 'trash', dim: true, soon: true },
      ],
    },
    {
      title: 'Точка продаж',
      rows: [
        { label: 'Кассы', icon: 'register', soon: true },
        { label: 'Смены', icon: 'shifts', soon: true },
      ],
    },
    {
      title: 'Журнал',
      rows: [{ label: 'Движение денег', icon: 'money', href: '/journal' }],
    },
    {
      title: 'Информация',
      rows: [
        { label: 'Задать вопрос', icon: 'question', url: 'mailto:waystea@gmail.com' },
        { label: 'База знаний', icon: 'knowledge', url: 'https://docs.expo.dev' },
        { label: 'Политика конфиденциальности', icon: 'privacy', soon: true },
        { label: 'Лицензионное соглашение', icon: 'license', soon: true },
      ],
    },
  ];
}

export default function MenuScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const sections = useSections();

  const company = 'waystea';
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const open = (row: MenuRow) => {
    if (row.url) {
      void Linking.openURL(row.url);
      return;
    }
    if (row.href) router.push(row.href);
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={styles.avatar}>
          <Text style={styles.avatarLetter}>{company.slice(0, 1).toUpperCase()}</Text>
        </View>

        <View style={styles.identity}>
          <Text style={styles.company} numberOfLines={1}>
            {company}
          </Text>
          <Text style={styles.role}>Владелец</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Настройки"
          hitSlop={10}
          onPress={() => router.push('/reports')}
          style={({ pressed }) => pressed && { opacity: 0.6 }}
        >
          <MenuIcon.gear />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {sections.map((section) => (
          <View key={section.title} style={styles.block}>
            <Text style={[text.block, styles.blockTitle]}>{section.title}</Text>

            {section.rows.map((row, index) => (
              <Pressable
                key={row.label}
                accessibilityRole="button"
                accessibilityState={{ disabled: row.soon }}
                onPress={() => open(row)}
                disabled={row.soon}
                style={({ pressed }) => [
                  styles.row,
                  index < section.rows.length - 1 && styles.divider,
                  pressed && { backgroundColor: colors.bg },
                ]}
              >
                <View style={styles.rowIcon}>
                  {MenuIcon[row.icon]({
                    color: row.dim || row.soon ? colors.textMuted : colors.accent,
                  })}
                </View>

                <Text
                  style={[styles.label, (row.dim || row.soon) && { color: colors.textMuted }]}
                  numberOfLines={1}
                >
                  {row.label}
                </Text>

                {row.count !== undefined ? <Text style={styles.count}>{row.count}</Text> : null}
                {row.soon ? <Text style={styles.soon}>скоро</Text> : null}
                {row.url ? <MenuIcon.external /> : <Icon.chevron />}
              </Pressable>
            ))}
          </View>
        ))}

        <Text style={styles.version}>Версия {version}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: colors.primaryText, fontSize: 20, fontWeight: '700' },
  identity: { flex: 1 },
  company: { color: colors.primaryText, fontSize: 21, fontWeight: '700' },
  role: { color: 'rgba(255,255,255,0.72)', fontSize: 14, marginTop: 1 },

  content: { paddingBottom: spacing.xl, gap: spacing.md },
  block: { backgroundColor: colors.surface, paddingTop: spacing.md },
  blockTitle: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
  },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowIcon: { width: 26, alignItems: 'center' },
  label: { flex: 1, fontSize: 16, color: colors.text },
  count: { fontSize: 16, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  soon: { fontSize: 11, color: colors.textMuted },
  version: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: 13,
    paddingVertical: spacing.lg,
  },
});
