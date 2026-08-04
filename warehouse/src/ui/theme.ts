import { Platform, StyleSheet } from 'react-native';

/**
 * Палитра снята со скриншотов привычного пользователю приложения: синяя шапка,
 * светло-серый фон, белые карточки, тёмно-серая круглая кнопка создания.
 */
export const colors = {
  /** Шапка и активные элементы. */
  primary: '#0A37F0',
  /** Заголовки блоков и ссылки внутри карточек — светлее шапки. */
  accent: '#1A66FF',
  /** Подложка кнопок «Подробнее», «Все смены». */
  accentSoft: '#E8EFFE',
  primaryText: '#FFFFFF',

  bg: '#EFF0F4',
  surface: '#FFFFFF',
  border: '#E4E6EB',

  text: '#111318',
  textMuted: '#8A8F98',

  /** Отрицательные остатки и суммы. */
  danger: '#E5252A',
  warning: '#B26B00',
  warningBg: '#FFF4E5',
  successBg: '#E9F3EC',
  success: '#1F8A4C',

  /** Круглая кнопка создания в центре нижней панели. */
  fab: '#4C4C4C',
  tabInactive: '#5A5F68',
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
  md: 14,
  lg: 20,
  pill: 999,
};

export const shadow = Platform.select({
  ios: {
    shadowColor: '#0B1220',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
  android: { elevation: 1 },
  default: {},
});

export const text = StyleSheet.create({
  /** Крупная сумма, как «0» под датой на главной. */
  hero: { fontSize: 40, fontWeight: '700', color: colors.text },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  /** Синий заголовок блока: «Открытые смены», «Отчёты». */
  block: { fontSize: 19, fontWeight: '700', color: colors.accent },
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
