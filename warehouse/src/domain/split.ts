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
 *   — витрине — не меньше 18 см.
 *
 * Если окно уже, чем оба предела вместе, ужимаются оба в одинаковой доле:
 * запретить в таком окне вообще всё было бы хуже, чем потесниться.
 */

/** Точек в сантиметре: CSS считает дюйм за 96 точек. */
export const PX_IN_CM = 96 / 2.54;

/** Сколько сантиметров остаётся чеку, когда границу двигают вправо до упора. */
export const MIN_RECEIPT_CM = 8;
/** Сколько остаётся витрине, когда границу двигают влево до упора. */
export const MIN_CATALOG_CM = 18;

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
