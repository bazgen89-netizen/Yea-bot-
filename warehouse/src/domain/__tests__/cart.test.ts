import { addToCart, cartTotals, discountFromPercent, findStockIssues, setCartQty } from '../cart';
import type { CartLine } from '../types';

function line(over: Partial<CartLine> = {}): CartLine {
  return {
    product_id: 1,
    name: 'Шу пуэр',
    unit: 'кг',
    qty: 1000,
    price: 500000,
    cost_price: 200000,
    stock: 5000,
    ...over,
  };
}

describe('cartTotals', () => {
  it('пустая корзина даёт нули', () => {
    const totals = cartTotals([]);
    expect(totals).toMatchObject({ subtotal: 0, total: 0, profit: 0, lineCount: 0 });
  });

  it('суммирует позиции и считает прибыль', () => {
    const totals = cartTotals([line(), line({ product_id: 2, qty: 500 })]);
    expect(totals.subtotal).toBe(750000); // 5000,00 + 2500,00
    expect(totals.costTotal).toBe(300000); // 2000,00 + 1000,00
    expect(totals.profit).toBe(450000);
  });

  it('вычитает скидку из итога, но не из себестоимости', () => {
    const totals = cartTotals([line()], 50000);
    expect(totals.total).toBe(450000);
    expect(totals.costTotal).toBe(200000);
    expect(totals.profit).toBe(250000);
  });

  it('не даёт скидке увести чек в минус', () => {
    const totals = cartTotals([line()], 999999999);
    expect(totals.discount).toBe(500000);
    expect(totals.total).toBe(0);
  });

  it('игнорирует отрицательную скидку', () => {
    expect(cartTotals([line()], -1000).discount).toBe(0);
  });

  it('допускает отрицательную прибыль при большой скидке', () => {
    const totals = cartTotals([line()], 400000);
    expect(totals.total).toBe(100000);
    expect(totals.profit).toBe(-100000);
  });
});

describe('discountFromPercent', () => {
  it('считает процент от суммы', () => {
    expect(discountFromPercent(100000, 10)).toBe(10000);
  });

  it('обрезает процент в диапазон 0..100', () => {
    expect(discountFromPercent(100000, 150)).toBe(100000);
    expect(discountFromPercent(100000, -5)).toBe(0);
  });
});

describe('findStockIssues', () => {
  it('молчит, когда товара хватает', () => {
    expect(findStockIssues([line({ qty: 1000, stock: 1000 })])).toEqual([]);
  });

  it('находит нехватку', () => {
    const issues = findStockIssues([line({ qty: 6000, stock: 5000 })]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ requested: 6000, available: 5000 });
  });
});

describe('addToCart / setCartQty', () => {
  it('повторное добавление увеличивает количество, а не дублирует строку', () => {
    const cart = addToCart(addToCart([], line()), line());
    expect(cart).toHaveLength(1);
    expect(cart[0].qty).toBe(2000);
  });

  it('разные товары дают разные строки', () => {
    const cart = addToCart(addToCart([], line()), line({ product_id: 2 }));
    expect(cart).toHaveLength(2);
  });

  it('количество 0 удаляет позицию', () => {
    const cart = setCartQty([line()], 1, 0);
    expect(cart).toEqual([]);
  });

  it('не мутирует исходный массив', () => {
    const original = [line()];
    addToCart(original, line({ product_id: 2 }));
    setCartQty(original, 1, 5000);
    expect(original).toHaveLength(1);
    expect(original[0].qty).toBe(1000);
  });
});
