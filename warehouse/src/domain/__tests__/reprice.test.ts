import { repricedTo } from '../pricing';
import type { Kopecks } from '../money';

/**
 * Пересчёт цен списком.
 *
 * Проверяется именно то, ради чего этот расчёт вынесен из экрана: проценты
 * считаются от цены каждого товара, а не от одной общей, и цена не уходит
 * в минус.
 */
describe('изменение цен списком', () => {
  const price = 30000 as Kopecks; // 300,00

  it('ставит одну цену всем', () => {
    expect(repricedTo(price, { mode: 'set', value: 45000 })).toBe(45000);
  });

  it('проценты считаются от цены самого товара', () => {
    expect(repricedTo(price, { mode: 'percent', value: 1000 })).toBe(33000);
    expect(repricedTo(300000 as Kopecks, { mode: 'percent', value: 1000 })).toBe(330000);
    expect(repricedTo(price, { mode: 'percent', value: -1000 })).toBe(27000);
  });

  it('рубли прибавляются и вычитаются', () => {
    expect(repricedTo(price, { mode: 'amount', value: 5000 })).toBe(35000);
    expect(repricedTo(price, { mode: 'amount', value: -5000 })).toBe(25000);
  });

  it('ниже нуля цена не опускается', () => {
    expect(repricedTo(price, { mode: 'amount', value: -50000 })).toBe(0);
    expect(repricedTo(price, { mode: 'percent', value: -20000 })).toBe(0);
  });
});
