import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';

import { colors, radius, shadow, spacing, text } from './theme';

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        pressed && styles.buttonPressed,
        inactive && styles.buttonDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? colors.text : colors.primaryText} />
      ) : (
        <Text
          style={[styles.buttonText, variant === 'secondary' && { color: colors.text }]}
          numberOfLines={1}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  containerStyle,
  ...props
}: TextInputProps & { label: string; hint?: string; containerStyle?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={text.muted}>{label}</Text>
      <TextInput
        {...props}
        style={[styles.input, props.style]}
        placeholderTextColor={colors.textMuted}
      />
      {hint ? <Text style={[text.muted, { fontSize: 12 }]}>{hint}</Text> : null}
    </View>
  );
}

export function Row({
  left,
  right,
  onPress,
}: {
  left: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
}) {
  const content = (
    <View style={styles.row}>
      <View style={styles.rowLeft}>{left}</View>
      {right ? <View style={styles.rowRight}>{right}</View> : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && styles.rowPressed}
    >
      {content}
    </Pressable>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={text.heading}>{title}</Text>
      {hint ? <Text style={[text.muted, styles.emptyHint]}>{hint}</Text> : null}
    </View>
  );
}

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'warning' | 'success' | 'danger';
}) {
  const toneStyle = {
    neutral: { bg: colors.bg, fg: colors.textMuted },
    warning: { bg: colors.warningBg, fg: colors.warning },
    success: { bg: colors.successBg, fg: colors.primary },
    danger: { bg: '#FDECEA', fg: colors.danger },
  }[tone];

  return (
    <View style={[styles.badge, { backgroundColor: toneStyle.bg }]}>
      <Text style={[styles.badgeText, { color: toneStyle.fg }]}>{label}</Text>
    </View>
  );
}

/** Пара «подпись — значение» для сводок в отчётах. */
export function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <View style={styles.stat}>
      <Text style={text.muted}>{label}</Text>
      <Text style={[text.amount, tone === 'danger' && { color: colors.danger }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    ...shadow,
  },
  button: {
    minHeight: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonDanger: { backgroundColor: colors.danger },
  buttonPressed: { opacity: 0.8 },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  field: { gap: spacing.xs, marginBottom: spacing.md },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  rowLeft: { flex: 1, gap: 2 },
  rowRight: { alignItems: 'flex-end', gap: 2 },
  rowPressed: { opacity: 0.6 },
  empty: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  emptyHint: { textAlign: 'center' },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontWeight: '600' },
  stat: { flex: 1, minWidth: 120, gap: 2 },
});
