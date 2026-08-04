import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from './theme';

/**
 * Синяя шапка: название организации слева, выбор магазина и оповещения справа.
 * Отступ сверху берётся из безопасной зоны — под «чёлкой» текст не должен
 * прятаться.
 */
export function AppHeader({
  title,
  subtitle,
  onPickLocation,
  onNotifications,
  right,
}: {
  title: string;
  subtitle?: string;
  onPickLocation?: () => void;
  onNotifications?: () => void;
  right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.titles}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      <View style={styles.actions}>
        {right}
        {onPickLocation ? (
          <HeaderButton label="Выбрать магазин" symbol="🏪" onPress={onPickLocation} />
        ) : null}
        {onNotifications ? (
          <HeaderButton label="Оповещения" symbol="🔔" onPress={onNotifications} />
        ) : null}
      </View>
    </View>
  );
}

export function HeaderButton({
  label,
  symbol,
  onPress,
}: {
  label: string;
  symbol: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
    >
      <Text style={styles.symbol}>{symbol}</Text>
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
  titles: { flex: 1 },
  title: {
    color: colors.primaryText,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  subtitle: { color: 'rgba(255,255,255,0.75)', fontSize: 14, marginTop: 2 },
  actions: { flexDirection: 'row', gap: spacing.lg, alignItems: 'center' },
  action: { padding: 2 },
  symbol: { fontSize: 22 },
});
