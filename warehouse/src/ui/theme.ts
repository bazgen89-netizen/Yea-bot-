import { Platform, StyleSheet } from 'react-native';

/**
 * Палитра снята со скриншотов привычного пользователю приложения: синяя шапка,
 * светло-серый фон, белые карточки, тёмно-серая круглая кнопка создания.
 *
 * ## Светлая и тёмная — по настройке телефона
 *
 * У него телефон переключается сам: «после заката всё меняется со светлого
 * на тёмное». Значит, и программа обязана — иначе ночью она одна светит
 * белым среди тёмных приложений.
 *
 * В браузере цвет берётся не отсюда, а из переменной оформления: `colors.bg`
 * превращается в `var(--app-bg)`, а сами значения ставятся на корень
 * страницы и меняются вместе с системной темой. Иначе никак: `StyleSheet`
 * запоминает цвет в тот миг, когда впервые прочитан файл, и позже подменить
 * его нечем.
 *
 * На телефоне переменных нет, и палитра остаётся светлой — родное тёмное
 * оформление там делается отдельно и в другой раз.
 */
const LIGHT = {
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

/**
 * Тёмная — по его снимку: чёрная подложка, тёмно-серые карточки, синие
 * заголовки, красные отрицательные суммы.
 */
const DARK: typeof LIGHT = {
  primary: '#0A84FF',
  accent: '#4C9DFF',
  accentSoft: '#16243A',
  primaryText: '#FFFFFF',

  bg: '#000000',
  surface: '#1C1C1E',
  border: '#2C2C2E',

  text: '#FFFFFF',
  textMuted: '#8E8E93',

  danger: '#FF453A',
  warning: '#FFB340',
  warningBg: '#2A1F08',
  successBg: '#0E2716',
  success: '#30D158',

  fab: '#48484A',
  tabInactive: '#8E8E93',
};

type Palette = typeof LIGHT;

/** Как называется переменная оформления: `bg` → `--app-bg`. */
const varName = (key: string) => `--app-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/**
 * В браузере — ссылки на переменные, на телефоне — сами цвета.
 *
 * Ссылка вместо цвета нужна ровно затем, чтобы тему можно было сменить после
 * запуска: `StyleSheet` цвет запоминает, а переменную — нет, её он оставляет
 * браузеру, и тот читает её заново при каждой перерисовке.
 */
export const colors: Palette =
  Platform.OS === 'web'
    ? (Object.fromEntries(
        Object.keys(LIGHT).map((key) => [key, `var(${varName(key)})`]),
      ) as Palette)
    : LIGHT;

/**
 * Поставить значения переменных и следить за системной темой.
 *
 * Возвращает отписку. Вызывается один раз при запуске в браузере; на
 * телефоне не делает ничего.
 */
export function followSystemTheme(): () => void {
  const root = globalThis.document?.documentElement;
  if (!root) return () => {};

  const paint = (dark: boolean) => {
    const palette = dark ? DARK : LIGHT;
    for (const [key, value] of Object.entries(palette)) {
      root.style.setProperty(varName(key), value);
    }
    // Подложка страницы за пределами разметки — иначе при прокрутке
    // «резинкой» из-под тёмного экрана выглядывает белое.
    root.style.backgroundColor = palette.bg;
  };

  const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  paint(media?.matches === true);

  if (!media) return () => {};

  const onChange = (event: MediaQueryListEvent) => paint(event.matches);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

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
