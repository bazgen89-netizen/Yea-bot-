import { StyleSheet } from 'react-native';

/**
 * Палитра веб-кабинета — она своя, не та, что в телефоне.
 *
 * На телефоне шапка густо-синяя (`colors.primary`), а в вебе — светлее и
 * с градиентом, боковое меню белое, кнопки действий зелёные и оранжевые.
 * Смешивать их в одном наборе нельзя: значения снимались с разных экранов,
 * и «поправил синий» в одном месте молча испортило бы другое.
 */
export const web = {
  /**
   * Шапка. В оригинале `linear-gradient(310deg, #01579b, #0288d1)` — значения
   * взяты из его же таблицы стилей, а не подобраны на глаз по скриншоту.
   */
  headerFrom: '#01579B',
  headerTo: '#0288D1',
  headerText: '#FFFFFF',

  /** Кнопка «Интерфейс кассира» в шапке. */
  headerButton: '#2C8FD6',

  sidebarBg: '#FFFFFF',
  sidebarText: '#3C4043',
  sidebarIcon: '#5F6368',
  /** Подсветка открытого раздела. */
  sidebarActive: '#EFEFEF',
  sidebarBorder: '#E0E0E0',
  /** Вложенные пункты — Смены, Кассы, Настройки. */
  sidebarChild: '#5F6368',
  sidebarDisabled: '#BDBDBD',

  /** Синяя кнопка «Создать документ». */
  createButton: '#5FA8DE',

  bg: '#FFFFFF',
  pageBg: '#F5F6F8',
  border: '#E4E6EB',
  /** Линии внутри таблиц — светлее рамок. */
  gridLine: '#ECEDEF',
  rowHover: '#F7F8FA',

  text: '#212121',
  textMuted: '#9AA0A6',
  /** Заголовки колонок в таблицах. */
  columnHead: '#7A7F85',

  /** Ссылки в таблицах: названия товаров, номера документов, магазины. */
  link: '#2185D0',

  // Semantic UI, на котором собран оригинал: те же значения, что у него.
  green: '#21BA45',
  greenText: '#1EA83C',
  orange: '#F2711C',
  danger: '#DB2828',

  /** Полоска слева у строки журнала. */
  stripeSale: '#00BFA5',
  stripeDoc: '#7B5FD3',
  stripeMoney: '#00BFA5',

  /** Блок «Внимание» на оценке склада. */
  warningBg: '#FFF8E1',
  warningText: '#8A6D3B',
};

/**
 * Шрифт кабинета — тот же, что в оригинале.
 * Со шрифтом, отличным от Roboto, не сойдутся ни ширины колонок, ни высоты строк.
 */
export const WEB_FONT = 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';

/** Ширина, с которой показываем кабинет вместо телефонной вёрстки. */
export const DESKTOP_WIDTH = 1000;

export const SIDEBAR_WIDTH = 292;
export const HEADER_HEIGHT = 64;

export const webText = StyleSheet.create({
  /** «Показатели за месяц по всем магазинам», «Выберите тип отчёта». */
  pageTitle: { fontSize: 30, color: web.text, fontWeight: '400' },
  /** «Документы», «Оценка склада по всем магазинам». */
  blockTitle: { fontSize: 25, color: '#37474F', fontWeight: '400' },
  /** Крупные суммы показателей. */
  metric: { fontSize: 30, color: web.text, fontVariant: ['tabular-nums'] as const },
  metricLabel: { fontSize: 14, color: web.textMuted },
  column: {
    fontSize: 12,
    color: web.columnHead,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
  cell: { fontSize: 14, color: web.text },
  cellNumber: { fontSize: 14, color: web.text, fontVariant: ['tabular-nums'] as const },
  link: { fontSize: 14, color: web.link },
});
