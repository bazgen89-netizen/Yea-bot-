import { scaleFor } from '../chart';

/**
 * Ось графика подписана круглыми числами.
 *
 * На его снимке при вершине 46 501 ось размечена нулём, десятками тысяч и
 * шестьюдесятью тысячами сверху. Если просто поделить вершину на пять,
 * подписи выйдут вида «9 300» — таких у него нет, и сравнивать два графика
 * глазами становится нельзя.
 */
describe('разметка оси графика', () => {
  it('вершина 46 501 даёт ось до 60 000 с шагом 10 000 — как у него', () => {
    const { top, ticks } = scaleFor(4_650_142);

    expect(top).toBe(6_000_000);
    expect(ticks.map((tick) => tick / 100)).toEqual([60_000, 50_000, 40_000, 30_000, 20_000, 10_000, 0]);
  });

  it('подписи идут сверху вниз и кончаются нулём', () => {
    const { ticks } = scaleFor(123_456);

    expect(ticks[ticks.length - 1]).toBe(0);
    expect(ticks[0]).toBeGreaterThan(123_456);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeLessThan(ticks[i - 1]);
  });

  it('вершина всегда выше самого высокого дня: столбик не упирается в потолок', () => {
    for (const peak of [1, 999, 100_000, 4_650_142, 98_765_432]) {
      expect(scaleFor(peak).top).toBeGreaterThan(peak);
    }
  });

  it('шаг круглый на любом порядке', () => {
    for (const peak of [500, 7_000, 250_000, 3_000_000, 41_000_000]) {
      const { ticks } = scaleFor(peak);
      const step = ticks[0] - ticks[1];
      const rubles = step / 100;
      const power = 10 ** Math.floor(Math.log10(rubles));

      expect([1, 2, 2.5, 5, 10]).toContain(Number((rubles / power).toFixed(1)));
    }
  });
});
