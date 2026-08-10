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

  /** Подложка шапки таблицы — из Semantic UI, на котором собран оригинал. */
  tableHead: '#F9FAFB',
};

/**
 * Экран кассира — отдельное приложение со своей палитрой и своим шрифтом.
 * Значения сняты с его бандла и разметки, а не с кабинета: там Material,
 * а не Semantic, и синий с зелёным другие.
 */
export const pos = {
  /** Полоса «ПРОДАЖА» внизу. */
  bar: '#2196F3',
  barDark: '#266798',
  /** Кнопка добавления клиента справа вверху. */
  accent: '#F57C00',
  green: '#4CAF50',
  bg: '#F2F2F7',
  tile: '#FFFFFF',
  border: '#EEEEEE',
  text: '#3C3C43',
  muted: '#9E9E9E',
  font: 'Oswald, Roboto, sans-serif',
};

/**
 * Шрифт кабинета — тот же, что в оригинале.
 * Со шрифтом, отличным от Roboto, не сойдутся ни ширины колонок, ни высоты строк.
 */
export const WEB_FONT = 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';

/** Ширина, с которой показываем кабинет вместо телефонной вёрстки. */
export const DESKTOP_WIDTH = 1000;

export const SIDEBAR_WIDTH = 292;
/** Свёрнутое меню — одни значки, как `body_smallMenu` в оригинале. */
export const SIDEBAR_SMALL_WIDTH = 64;
export const HEADER_HEIGHT = 64;

/**
 * Размеры шрифта.
 *
 * Все до одного взяты из таблицы стилей оригинала, а не подобраны на глаз.
 * Ключевое: у него `html { font-size: 14px }`, а не привычные 16 — поэтому
 * каждый `rem` в его вёрстке на восьмую меньше, чем кажется по цифре.
 * Заголовок `h1: 1.9rem` — это 26,6 пикселя, а не 30, и всё, что считалось
 * от шестнадцати, было крупнее оригинала.
 *
 *   html            14px    (vendor.css)
 *   h1              1.9rem  = 26,6
 *   h2              1.6rem  = 22,4
 *   .ui.menu        1rem    = 14      — пункт бокового меню
 *   вложенный пункт .857em  = 12
 *   .ui.table       14px             — тело таблицы
 *   ссылка в строке 15px
 *   подпись под ней 11px
 *   плитка отчёта   15,5px, значок 66px
 */
export const REM = 14;

export const webText = StyleSheet.create({
  /** Заголовок страницы — `h1`, 1.9rem при базе 14. */
  pageTitle: { fontFamily: WEB_FONT, fontSize: 27, color: web.text, fontWeight: '400' },
  /**
   * Заголовок дашборда. У него он не `h1`, а выпадающий список внутри
   * заголовка, и размер задан явно: 28 пикселей начертанием 300.
   */
  dashboardTitle: { fontFamily: WEB_FONT, fontSize: 28, color: '#33425B', fontWeight: '300' },
  /** «Документы», «Оценка склада по всем магазинам» — `h2`, 1.6rem. */
  blockTitle: { fontFamily: WEB_FONT, fontSize: 22, color: '#37474F', fontWeight: '400' },
  /** Крупные суммы показателей. */
  metric: { fontFamily: WEB_FONT, fontSize: 28, color: web.text, fontVariant: ['tabular-nums'] as const },
  metricLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted },
  /**
   * Заголовок колонки: `.ui.table thead th` — 14 пикселей, начертание 700,
   * `text-transform: none`. Прописные с разрядкой были моей выдумкой.
   */
  column: { fontFamily: WEB_FONT, fontSize: 14, color: 'rgba(0,0,0,0.87)', fontWeight: '700' },
  cell: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  cellNumber: { fontFamily: WEB_FONT, fontSize: 14, color: web.text, fontVariant: ['tabular-nums'] as const },
  /** Название товара, номер документа — 15 пикселей, крупнее остальных ячеек. */
  link: { fontFamily: WEB_FONT, fontSize: 15, color: web.link },
  /** Вторая строка в ячейке: артикул, дата, комментарий. */
  cellSmall: { fontFamily: WEB_FONT, fontSize: 11, color: web.textMuted },
});
