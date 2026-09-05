/**
 * Счёт для графика выручки: разметка оси и сглаживание линии.
 *
 * Здесь нет ни React, ни базы — только арифметика, поэтому её видно тестам.
 * Экран рисует то, что тут посчитано.
 */

/**
 * Разметка оси: круглый шаг и подписи сверху вниз.
 *
 * Шаг берётся круглый — 1, 2, 2,5 или 5 на своём порядке, — а вершина
 * поднимается на шаг выше самого высокого дня: столбик, упирающийся в потолок,
 * читается хуже. На его снимке при вершине 46 501 ось размечена до 60 000
 * с шагом 10 000 — ровно это правило.
 */
export function scaleFor(peak: number): { top: number; ticks: number[] } {
  const step = niceStep(peak / 5);
  const top = (Math.floor(peak / step) + 2) * step;
  const count = Math.round(top / step) + 1;

  return { top, ticks: Array.from({ length: count }, (_, i) => top - step * i) };
}

/** Ближайшее «круглое» число не меньше заданного: 9 300 → 10 000. */
function niceStep(value: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(1, value)));
  for (const multiple of [1, 2, 2.5, 5, 10]) {
    if (power * multiple >= value) return power * multiple;
  }
  return power * 10;
}

/**
 * Кубический сплайн через точки — тот же, каким сглажены графики у него.
 *
 * Монотонный: обычный сплайн на подъёме после нуля проваливается ниже нуля,
 * и заливка вылезает под ось. Здесь наклон в точке ограничен наклонами
 * соседних отрезков, поэтому кривая не выходит за данные.
 */
export function smooth(pts: [number, number][]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`;

  const slopes: number[] = [];
  const secants: number[] = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0] || 1;
    secants.push((pts[i + 1][1] - pts[i][1]) / dx);
  }

  slopes.push(secants[0]);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = secants[i - 1];
    const b = secants[i];
    slopes.push(a * b <= 0 ? 0 : (2 * a * b) / (a + b));
  }
  slopes.push(secants[secants.length - 1]);

  let path = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = (pts[i + 1][0] - pts[i][0]) / 3;
    path +=
      ` C ${pts[i][0] + dx} ${pts[i][1] + slopes[i] * dx}` +
      ` ${pts[i + 1][0] - dx} ${pts[i + 1][1] - slopes[i + 1] * dx}` +
      ` ${pts[i + 1][0]} ${pts[i + 1][1]}`;
  }

  return path;
}

/** «32 125» — рублями, тысячи через пробел: так подписан его график. */
export function spaced(kopecks: number): string {
  return String(Math.round(kopecks / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

