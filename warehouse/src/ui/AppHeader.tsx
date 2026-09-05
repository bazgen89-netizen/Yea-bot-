import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from './icons';
import { colors, spacing } from './theme';

/**
 * Синяя шапка: название организации слева, действия справа.
 * Отступ сверху берётся из безопасной зоны — под «чёлкой» текст прятаться
 * не должен.
 *
 * `back` рисует стрелку возврата. Экраны, которые прячут системную шапку
 * (`headerShown: false`), обязаны её просить: без неё с экрана нельзя уйти
 * иначе как кнопкой браузера, а в приложении на телефоне — вообще никак.
 */
export function AppHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  back?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Назад"
          hitSlop={12}
          // Экран могли открыть по прямой ссылке — тогда возвращаться некуда,
          // и уводим на Главную, а не оставляем в тупике.
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
        >
          <Icon.arrowBack color={colors.primaryText} size={26} />
        </Pressable>
      ) : null}

      <View style={styles.titles}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

export function HeaderAction({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  back: { paddingRight: spacing.md, paddingBottom: 2 },
  titles: { flex: 1 },
  title: {
    color: colors.primaryText,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  subtitle: { color: 'rgba(255,255,255,0.72)', fontSize: 15, marginTop: 1 },
  actions: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  action: { padding: 1 },
});
