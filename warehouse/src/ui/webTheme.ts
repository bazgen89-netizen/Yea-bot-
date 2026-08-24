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
  /**
   * Подпись пункта. У Semantic UI, на котором собран оригинал, пункт меню
   * не красится отдельно — берётся общий цвет текста `rgba(0,0,0,.87)`.
   * Значок красится тем же: в его меню значки и подписи одного тона, а не
   * значки посветлее, как было у нас.
   */
  sidebarText: 'rgba(0,0,0,0.87)',
  sidebarIcon: 'rgba(0,0,0,0.87)',
  /** Подсветка открытого раздела. */
  sidebarActive: '#EFEFEF',
  sidebarBorder: '#E0E0E0',
  /** Вложенные пункты и нижний ряд: `rgba(0,0,0,.5)`. */
  sidebarChild: 'rgba(0,0,0,0.5)',
  sidebarDisabled: '#BDBDBD',

  /**
   * Синяя кнопка «Создать документ» — `ui blue button` Semantic UI, но весь
   * блок идёт с `opacity: .8`, поэтому на белом она выглядит светлее самого
   * синего.
   */
  createButton: '#2185D0',

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
 *
 * Значения — не подбор на глаз, а их тема Material, слово в слово:
 *
 * ```
 * light: {
 *   primary:   { main: 'rgb(25, 118, 210)' },
 *   secondary: { main: '#ed6c02' },
 *   background:{ paper: 'rgb(255, 255, 255)', default: 'rgb(247, 249, 252)' },
 *   text:      { primary: 'rgb(31, 35, 40)', secondary: 'rgb(101, 109, 118)' },
 *   divider:   'rgb(216, 222, 228)',
 * },
 * typography: { fontFamily: "'Oswald', sans-serif" }
 * ```
 *
 * Шрифт в этой теме назван Oswald — и это ловушка, в которую я попал. Файла
 * шрифта их касса **не отдаёт**: браузер имени не находит и берёт следующее
 * в списке, `sans-serif`. На снимках их кассы буквы обычные, не узкие, — то
 * есть Roboto, а не Oswald. Мы же честно вшили Oswald, и текст стал узким
 * там, где у них широкий. Поэтому здесь то, что видит пользователь, а не то,
 * что написано у них в теме.
 */
/**
 * Цвета кассы заданы **переменными CSS**, а не значениями.
 *
 * Это единственный способ дать кассе тёмное оформление, не переписывая все
 * её экраны. `StyleSheet.create` вычисляет стили один раз при загрузке: если
 * положить сюда `#FFFFFF`, белый останется белым навсегда, сколько потом ни
 * меняй палитру. А `var(--pos-tile)` — строка, она не меняется никогда;
 * меняется значение переменной у корня страницы, и вместе с ним перекрашивается
 * всё разом, включая уже созданные стили.
 *
 * Сами значения — светлые и тёмные — лежат в `POS_LIGHT` и `POS_DARK` ниже,
 * а расставляет их `applyPosTheme`.
 */
export const pos = {
  /** Полоса «ПРОДАЖА» внизу; она же — главная кнопка. `primary.main`. */
  bar: 'var(--pos-bar)',
  barDark: 'var(--pos-bar-dark)',
  /** Кнопка добавления клиента и подтверждения. `secondary.main`. */
  accent: 'var(--pos-accent)',
  green: 'var(--pos-green)',
  red: 'var(--pos-red)',
  /** `background.default` — подложка витрины. */
  bg: 'var(--pos-bg)',
  /** `background.paper` — плитки, чек, окна. */
  tile: 'var(--pos-tile)',
  /** `divider`. */
  border: 'var(--pos-border)',
  /** `text.primary`. */
  text: 'var(--pos-text)',
  /** `text.secondary`. */
  muted: 'var(--pos-muted)',
  /** `action.hover` — подсветка строки под курсором. */
  hover: 'var(--pos-hover)',
  /** Вторая подложка: строка списка, полоса прокрутки. */
  raise: 'var(--pos-raise)',
  /**
   * Шапка окна поверх кассы.
   *
   * Днём она синяя, ночью серо-синяя: у него в тёмной теме шапка не красится
   * основным цветом, а берёт тон поверхности — как принято в тёмных темах
   * Material.
   */
  appbar: 'var(--pos-appbar)',
  /** Цвет тени: в темноте она светлая, а не чёрная. */
  shadow: 'var(--pos-shadow)',
  /** Подсветка выбранной строки — голубая на светлом, синяя на тёмном. */
  select: 'var(--pos-select)',
  /** Крупные серые знаки: замок на пустом чеке, значок без картинки. */
  faint: 'var(--pos-faint)',
  /**
   * Шрифт кассы — узкий, как у них.
   *
   * Касса CloudShop — отдельное приложение, и в её таблице стилей стоит
   * `font-family:Fira Sans Extra Condensed` при основном размере 14 px. Мы
   * рисовали кассу обычным Roboto: буквы шире, строки длиннее, и весь экран
   * выглядел крупнее оригинала при тех же числах.
   *
   * Запасные — тоже узкие: если файл шрифта почему-то не подхватился, пусть
   * подставится хотя бы похожий, а не вдвое более широкий.
   */
  font: '"Fira Sans Extra Condensed", "Roboto Condensed", "Arial Narrow", Roboto, sans-serif',
};

/** Светлое оформление — те самые значения из его темы Material. */
export const POS_LIGHT: Record<string, string> = {
  '--pos-bar': '#1976D2',
  '--pos-bar-dark': '#115293',
  '--pos-accent': '#ED6C02',
  '--pos-green': '#2E7D32',
  '--pos-red': '#D32F2F',
  '--pos-bg': '#F7F9FC',
  '--pos-tile': '#FFFFFF',
  '--pos-border': '#D8DEE4',
  '--pos-text': '#1F2328',
  '--pos-muted': '#656D76',
  '--pos-hover': 'rgba(0,0,0,0.04)',
  '--pos-raise': '#EEF1F5',
  '--pos-shadow': 'rgba(0,0,0,0.12)',
  '--pos-appbar': '#1976D2',
  '--pos-select': '#E8F1FB',
  '--pos-faint': '#C7C7CC',
};

/**
 * Тёмное оформление — тёмно-синее, а не чёрное.
 *
 * Первый раз я взял палитру из их **нового** кассового приложения — там она
 * чёрная, по-иосовски. Но у Вазгена касса другой сборки, и на его снимке
 * тёмная тема сине-серая: подложка почти чёрно-синяя, карточки серо-синие,
 * шапка окна светлее них, и ни одного по-настоящему чёрного пятна.
 *
 * Значения взяты с его снимка, а не сочинены: подложка `#1B2436`, карточка
 * `#2A3446`, вторая подложка (полосы переключателей) `#333E52`, шапка окна
 * `#3F4B60`. Синий, оранжевый и красный — Material, но светлее дневных:
 * дневные на тёмном проваливаются.
 */
export const POS_DARK: Record<string, string> = {
  '--pos-bar': '#2196F3',
  '--pos-bar-dark': '#1565C0',
  // Шапка окна в тёмной теме не синяя, а серо-синяя — так у него.
  '--pos-appbar': '#3F4B60',
  '--pos-accent': '#FFA726',
  '--pos-green': '#66BB6A',
  '--pos-red': '#EF5350',
  '--pos-bg': '#1B2436',
  '--pos-tile': '#2A3446',
  '--pos-border': 'rgba(255,255,255,0.12)',
  '--pos-text': '#FFFFFF',
  '--pos-muted': 'rgba(255,255,255,0.62)',
  '--pos-hover': 'rgba(255,255,255,0.08)',
  '--pos-raise': '#333E52',
  '--pos-select': 'rgba(255,255,255,0.12)',
  '--pos-faint': '#5A6478',
  // Тень в темноте не работает: границу держит разница тонов, а не чернота.
  '--pos-shadow': 'rgba(0,0,0,0.55)',
};

/**
 * Ставит выбранное оформление кассы.
 *
 * `auto` — как в системе: у ноутбука за прилавком ночью включается тёмная
 * тема, и касса не должна светить в глаза белым.
 */
export function applyPosTheme(theme: 'auto' | 'light' | 'dark'): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;

  const dark =
    theme === 'dark' ||
    (theme === 'auto' &&
      globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches === true);

  for (const [name, value] of Object.entries(dark ? POS_DARK : POS_LIGHT)) {
    root.style.setProperty(name, value);
  }
}

/**
 * Шрифт кабинета — тот же, что в оригинале.
 * Со шрифтом, отличным от Roboto, не сойдутся ни ширины колонок, ни высоты строк.
 */
export const WEB_FONT = 'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';

/** Ширина, с которой показываем кабинет вместо телефонной вёрстки. */
export const DESKTOP_WIDTH = 1000;

/**
 * Ширина бокового меню — его же: `#subMenu > div { width: 210px }`.
 *
 * Раньше здесь стояло 292, и из-за этого не сходилось всё остальное: при
 * широком меню подписи и строки приходилось растягивать, разделы переставали
 * помещаться по высоте и список начинал прокручиваться там, где у него
 * помещается целиком.
 */
export const SIDEBAR_WIDTH = 210;
/** Свёрнутое меню — одни значки, как `body_smallMenu` в оригинале: 70. */
export const SIDEBAR_SMALL_WIDTH = 70;
/** Шапка: `body > header .ui.menu.inverted { min-height: 46px }`. */
export const HEADER_HEIGHT = 46;

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

/**
 * Размеры формы — из Semantic UI, на котором собран оригинал.
 *
 *   .ui.form .field>label   .92857143em = 13, начертание 700, обычный регистр
 *   .ui.form input          14, отступы .67857143em 1em = 9,5 и 14,
 *                           рамка 1px rgba(34,36,38,.15), радиус .28571429rem = 4
 *   .ui.form .field         отступ снизу 1em = 14
 *   .ui.form .fields        поля по 0,5em с каждой стороны — между ними 14
 *   h3                      1.28571429rem = 18, начертание 700
 *   .ui.divider             1 пиксель, отступы 1rem = 14
 *   .ui.toggle.checkbox     дорожка 3,5rem × 1,5rem = 49 × 21, кружок 21,
 *                           включённая — #2185D0, выключенная — rgba(0,0,0,.05)
 *   .panel                  отступы 35 сверху и снизу, 100 по бокам
 *
 * Раньше подписи в карточке были 12 пикселей прописными серым — это было
 * придумано, а не снято. У него они чёрные, полужирные и обычным регистром.
 */
export const FORM_BORDER = 'rgba(34,36,38,0.15)';
export const FORM_LABEL = 'rgba(0,0,0,0.87)';
export const FORM_INPUT_HEIGHT = 38;
export const FORM_GAP = 14;

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
   * Заголовок колонки в справочнике и журналах: 14 пикселей, начертание 700,
   * обычным регистром — так у него в `.ui.table thead th`.
   */
  /**
   * Заголовок колонки — их же правило, а не на глаз.
   *
   * `.fixed-title .ui.table thead th > div` в их `my-*.css`:
   * `font-weight: 400; font-size: .8em; text-transform: uppercase`. Восемь
   * десятых от 14 — это 11 точек. У меня было 14 полужирным и с большой
   * буквы: заголовки выглядели тяжелее строк, хотя должны быть тише их.
   */
  column: {
    fontFamily: WEB_FONT,
    fontSize: 10,
    color: 'rgba(0,0,0,0.87)',
    fontWeight: '400' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.2,
  },
  /**
   * Заголовок колонки в отчётах — другой: прописные, синие, без полужирного.
   * Две разные шапки в одном приложении выглядят ошибкой, но у него они
   * действительно разные, и повторяем то, что есть.
   */
  reportColumn: {
    fontFamily: WEB_FONT,
    fontSize: 13,
    color: web.link,
    textTransform: 'uppercase' as const,
  },
  cell: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  /**
   * Ячейка журнала — мельче, чем ячейка справочника.
   *
   * Это не вкусовщина: у них две разные таблицы. Справочник лежит в
   * `.table-content`, где стоит `.ui.table{font-size:14px}`, а журналы
   * движения товара и денег — в `.fixed-title`, где такого правила нет и
   * работает `.ui.small.table{font-size:.9em}` — 12,6 от четырнадцати. Он
   * сказал «шрифт как был крупный, так и остался»: журнал у меня был
   * набран справочниковым кеглем.
   */
  rowCell: { fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  rowNumber: {
    fontFamily: WEB_FONT,
    fontSize: 13,
    color: web.text,
    fontVariant: ['tabular-nums'] as const,
  },
  rowLink: { fontFamily: WEB_FONT, fontSize: 13, color: web.link },
  cellNumber: { fontFamily: WEB_FONT, fontSize: 14, color: web.text, fontVariant: ['tabular-nums'] as const },
  /** Название товара, номер документа — 15 пикселей, крупнее остальных ячеек. */
  link: { fontFamily: WEB_FONT, fontSize: 15, color: web.link },
  /** Вторая строка в ячейке: артикул, дата, комментарий. */
  cellSmall: { fontFamily: WEB_FONT, fontSize: 11, color: web.textMuted },
});
