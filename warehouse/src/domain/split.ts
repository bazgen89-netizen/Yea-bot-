/**
 * Где может стоять граница между витриной и чеком.
 *
 * Границу двигают, но не куда угодно: ни витрина, ни чек не должны схлопнуться
 * в полоску. Пределы заданы **в сантиметрах, а не в долях экрана**, потому что
 * смысл у них физический — сколько места нужно, чтобы в чек влезала строка, а
 * на витрину помещался ряд плиток. Доля же на широком мониторе и на ноутбуке
 * означает совсем разное.
 *
 *   — чеку остаётся не меньше 8 см;
 *   — витрине — не меньше 22 см.
 *
 * Если окно уже, чем оба предела вместе, ужимаются оба в одинаковой доле:
 * запретить в таком окне вообще всё было бы хуже, чем потесниться.
 */

/** Точек в сантиметре: CSS считает дюйм за 96 точек. */
export const PX_IN_CM = 96 / 2.54;

/** Сколько сантиметров остаётся чеку, когда границу двигают вправо до упора. */
export const MIN_RECEIPT_CM = 8;
/**
 * Сколько остаётся витрине, когда границу двигают влево до упора.
 *
 * 22, а не 18: на восемнадцати витрина ужимается до четырёх плиток в ряду и
 * перестаёт быть витриной — по ней уже не выбирают, а ищут.
 */
export const MIN_CATALOG_CM = 22;

/**
 * Загоняет долю в допустимые пределы.
 *
 * `usable` — ширина, которую делят между собой витрина и чек, то есть окно
 * без самой разделительной полосы.
 */
export function clampSplit(fraction: number, usable: number): number {
  if (!Number.isFinite(fraction) || usable <= 0) return fraction;

  let catalog = MIN_CATALOG_CM * PX_IN_CM;
  let receipt = MIN_RECEIPT_CM * PX_IN_CM;

  if (catalog + receipt > usable) {
    const squeeze = usable / (catalog + receipt);
    catalog *= squeeze;
    receipt *= squeeze;
  }

  const min = catalog / usable;
  const max = (usable - receipt) / usable;
  return Math.min(max, Math.max(min, fraction));
}

/**
 * Сколько плиток в ряду при такой ширине окна — их таблица, снятая с кассы.
 *
 * ```
 * breakpoints: {xs:0, sm:370, md:400, lg:500, l:600, xl:700,
 *               x2l:900, x3l:1200, x4l:1500, x5l:1900, x6l:2300, x7l:2600}
 * columns:     {xs:2, sm:3, md:3, lg:4, xl:5, x2l:4, x3l:6,
 *               x4l:7, x5l:8, x6l:9, x7l:10}
 * ```
 */
export function tileColumns(windowWidth: number): number {
  if (windowWidth >= 2600) return 10;
  if (windowWidth >= 2300) return 9;
  if (windowWidth >= 1900) return 8;
  if (windowWidth >= 1500) return 7;
  if (windowWidth >= 1200) return 6;
  if (windowWidth >= 900) return 4;
  if (windowWidth >= 700) return 5;
  if (windowWidth >= 500) return 4;
  if (windowWidth >= 370) return 3;
  return 2;
}

/** Доля, отданная витрине по умолчанию: 1,55 к 1. */
export const DEFAULT_SPLIT = 1.55 / 2.55;

/**
 * Сколько плиток в ряду: от пяти до семи.
 *
 * Пределы названы числами, а не выведены из желаемой ширины плитки, потому
 * что так это и просят: сдвинул границу влево — пять в ряду, вправо — семь.
 * Прежний расчёт («сколько плиток желаемой ширины поместится») давал на
 * широком мониторе от шести до девяти, и на глаз это выглядело так, будто
 * от движения границы не меняется ничего: плитки то же число, только шире.
 *
 * Ряд при этом всегда заполнен целиком — пустых полей справа не остаётся, —
 * а размер плитки меняется вместе с числом столбцов. Иначе никак: ширина
 * витрины не делится нацело на «правильную» карточку.
 */
export const MIN_COLUMNS = 5;
export const MAX_COLUMNS = 7;

export function columnsFor(windowWidth: number, catalogWidth: number): number {
  // Раскладки ещё не было — начинаем с пяти, как при границе слева.
  if (catalogWidth <= 0 || windowWidth <= 0) return MIN_COLUMNS;

  // Крайние положения границы для этого окна — те же, что стережёт clampSplit.
  const narrow = clampSplit(0, windowWidth) * windowWidth;
  const wide = clampSplit(1, windowWidth) * windowWidth;
  if (wide - narrow < 1) return MIN_COLUMNS;

  const part = Math.min(1, Math.max(0, (catalogWidth - narrow) / (wide - narrow)));
  return Math.round(MIN_COLUMNS + part * (MAX_COLUMNS - MIN_COLUMNS));
}
