import {
  addToCart,
  cartTotals,
  discountFromPercent,
  findStockIssues,
  lineDiscountOf,
  lineNet,
  percentFromDiscount,
  setCartQty,
} from '../cart';
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

describe('percentFromDiscount', () => {
  it('обратна discountFromPercent', () => {
    // Ровно случай со снимка кассы: чек 700,00, скидка 10 % — это 70,00.
    const subtotal = 70000;
    const discount = discountFromPercent(subtotal, 10);
    expect(discount).toBe(7000);
    expect(percentFromDiscount(subtotal, discount)).toBe(10);
  });

  it('считает процент от суммы, названной в рублях', () => {
    // Кассиру сказали «скинь семьдесят рублей» с чека в 630,00.
    expect(percentFromDiscount(63000, 7000)).toBeCloseTo(11.11, 2);
  });

  it('не делит на ноль и не уходит за границы', () => {
    expect(percentFromDiscount(0, 5000)).toBe(0);
    expect(percentFromDiscount(10000, -500)).toBe(0);
    // Скидка больше чека — это сто процентов, а не больше.
    expect(percentFromDiscount(10000, 50000)).toBe(100);
  });

  it('переключение % ↔ руб не теряет величину', () => {
    const subtotal = 133700;
    for (const percent of [3, 5, 7, 8, 10, 12.5]) {
      const money = discountFromPercent(subtotal, percent);
      expect(percentFromDiscount(subtotal, money)).toBeCloseTo(percent, 1);
    }
  });
});

describe('скидка на сам товар', () => {
  const line = (over: Partial<CartLine> = {}): CartLine => ({
    product_id: 1,
    name: 'Нож для колки пуэра',
    unit: 'шт',
    qty: 1000,
    price: 70000,
    cost_price: 30000,
    stock: 10000,
    ...over,
  });

  it('снимается до скидки чека', () => {
    // Тот же случай, что на кассе: нож 700,00 со скидкой 10 % — 630,00.
    const totals = cartTotals([line({ discount_bp: 1000 })]);
    expect(totals.gross).toBe(70000);
    expect(totals.lineDiscount).toBe(7000);
    expect(totals.subtotal).toBe(63000);
    expect(totals.total).toBe(63000);
  });

  it('скидка чека считается уже от сниженной суммы', () => {
    // 700,00 − 10 % товара = 630,00; ещё 10 % чека = 567,00.
    const totals = cartTotals([line({ discount_bp: 1000 })], 6300);
    expect(totals.subtotal).toBe(63000);
    expect(totals.discount).toBe(6300);
    expect(totals.total).toBe(56700);
  });

  it('без скидки товара ничего не меняется', () => {
    const totals = cartTotals([line()]);
    expect(totals.gross).toBe(70000);
    expect(totals.lineDiscount).toBe(0);
    expect(totals.subtotal).toBe(70000);
  });

  it('складывает скидки разных товаров', () => {
    const totals = cartTotals([
      line({ product_id: 1, discount_bp: 1000 }),
      line({ product_id: 2, price: 30000, discount_bp: 5000 }),
      line({ product_id: 3, price: 10000 }),
    ]);
    // 70000 + 30000 + 10000 = 110000; скидки 7000 + 15000 = 22000.
    expect(totals.gross).toBe(110000);
    expect(totals.lineDiscount).toBe(22000);
    expect(totals.subtotal).toBe(88000);
  });

  it('количество умножает и цену, и скидку', () => {
    const totals = cartTotals([line({ qty: 3000, discount_bp: 1000 })]);
    expect(totals.gross).toBe(210000);
    expect(totals.lineDiscount).toBe(21000);
    expect(totals.subtotal).toBe(189000);
  });

  it('lineNet — то, что печатается в строке чека', () => {
    expect(lineNet(line({ discount_bp: 1000 }))).toBe(63000);
    expect(lineNet(line())).toBe(70000);
  });
});
