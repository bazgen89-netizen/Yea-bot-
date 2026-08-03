import { Platform, StyleSheet } from 'react-native';

export const colors = {
  bg: '#F5F6F8',
  surface: '#FFFFFF',
  border: '#E3E6EB',
  text: '#14181F',
  textMuted: '#697386',
  primary: '#1F6F4A',
  primaryText: '#FFFFFF',
  danger: '#C0392B',
  warning: '#B26B00',
  warningBg: '#FFF6E5',
  successBg: '#E8F5EE',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
};

export const shadow = Platform.select({
  ios: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  android: { elevation: 2 },
  default: {},
});

export const text = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  heading: { fontSize: 17, fontWeight: '600', color: colors.text },
  body: { fontSize: 15, color: colors.text },
  muted: { fontSize: 13, color: colors.textMuted },
  /** Цифры выравниваются по колонкам — суммы в списках не «пляшут». */
  mono: {
    fontSize: 15,
    color: colors.text,
    fontVariant: ['tabular-nums'] as const,
  },
  amount: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    fontVariant: ['tabular-nums'] as const,
  },
});
