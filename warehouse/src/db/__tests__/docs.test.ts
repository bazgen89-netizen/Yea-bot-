import type { SqlDriver } from '../driver';
import { createTestDriver } from '../testDriver';
import { blankDoc, docPaid, docTotal, loadDoc, nextNumber, saveDoc } from '../docs';
import { listJournal } from '../journal';
import { createLocation } from '../locations';
import { accountBalances } from '../money';
import { createProduct } from '../products';
import { createReturn, createSale } from '../sales';
import { getStock, stockAt } from '../stock';
import type { Id } from '../../domain/types';

let db: SqlDriver;

beforeEach(() => {
  db = createTestDriver();
});

function product(name = 'Шу пуэр'): Id {
  return createProduct(db, {
    name,
    sku: null,
    barcode: null,
    category_id: null,
    unit: 'кг',
    cost_price: 100000,
    sale_price: 200000,
    min_qty: 0,
    photo_uri: null,
  });
}

describe('документ как бумага', () => {
  it('проведённый двигает склад, отложенный — нет', () => {
    const shop = createLocation(db, 'Ереван');
    const tea = product();

    const draft = saveDoc(db, {
      ...blankDoc('purchase'),
      posted: false,
      locationId: null,
      locationToId: shop,
      lines: [{ product_id: tea, qty: 3000, price: 100000 }],
    });

    expect(getStock(db, tea)).toBe(0);

    // Тот же документ, но проведённый: движения появляются, вторых позиций
    // при этом не заводится.
    saveDoc(db, {
      ...blankDoc('purchase'),
      id: draft,
      posted: true,
      locationId: null,
      locationToId: shop,
      lines: [{ product_id: tea, qty: 3000, price: 100000 }],
    });

    expect(getStock(db, tea)).toBe(3000);
    expect(stockAt(db, tea, shop)).toBe(3000);
  });

  it('правка переписывает движения, а не добавляет вторые', () => {
    const shop = createLocation(db, 'Ереван');
    const tea = product();

    const id = saveDoc(db, {
      ...blankDoc('purchase'),
      locationToId: shop,
      lines: [{ product_id: tea, qty: 3000, price: 100000 }],
    });
    expect(getStock(db, tea)).toBe(3000);

    saveDoc(db, {
      ...blankDoc('purchase'),
      id,
      locationToId: shop,
      lines: [{ product_id: tea, qty: 5000, price: 100000 }],
    });
    expect(getStock(db, tea)).toBe(5000);
  });

  it('отложенный документ виден в журнале со своими позициями', () => {
    const shop = createLocation(db, 'Ереван');
    const tea = product();

    saveDoc(db, {
      ...blankDoc('purchase'),
      posted: false,
      locationToId: shop,
      lines: [{ product_id: tea, qty: 2000, price: 150000 }],
    });

    const [entry] = listJournal(db);
    expect(entry.kind).toBe('purchase');
    expect(entry.posted).toBe(0);
    expect(entry.positions).toBe(1);
    // 2 кг по 1500,00.
    expect(entry.amount).toBe(300000);

    expect(listJournal(db, 500, { status: 'draft' })).toHaveLength(1);
    expect(listJournal(db, 500, { status: 'posted' })).toHaveLength(0);
  });

  it('перемещение уносит товар из одного магазина в другой', () => {
    const from = createLocation(db, 'Ереван');
    const to = createLocation(db, 'Гюмри');
    const tea = product();

    saveDoc(db, {
      ...blankDoc('purchase'),
      locationToId: from,
      lines: [{ product_id: tea, qty: 4000, price: 100000 }],
    });

    saveDoc(db, {
      ...blankDoc('transfer'),
      locationId: from,
      locationToId: to,
      lines: [{ product_id: tea, qty: 1500, price: 100000 }],
    });

    expect(stockAt(db, tea, from)).toBe(2500);
    expect(stockAt(db, tea, to)).toBe(1500);
    // Общий остаток перемещение не меняет.
    expect(getStock(db, tea)).toBe(4000);
  });

  it('продажа документом списывает со склада', () => {
    const shop = createLocation(db, 'Ереван');
    const tea = product();

    saveDoc(db, {
      ...blankDoc('purchase'),
      locationToId: shop,
      lines: [{ product_id: tea, qty: 4000, price: 100000 }],
    });
    saveDoc(db, {
      ...blankDoc('sale'),
      locationId: shop,
      lines: [{ product_id: tea, qty: 1000, price: 200000 }],
    });

    expect(stockAt(db, tea, shop)).toBe(3000);
  });

  it('загружается обратно тем же, чем сохранён', () => {
    const shop = createLocation(db, 'Ереван');
    const tea = product();

    const id = saveDoc(db, {
      ...blankDoc('sale'),
      number: '17',
      note: 'Накладная №34',
      discount_bp: 500,
      state: 2,
      locationId: shop,
      lines: [{ product_id: tea, qty: 1000, price: 200000, discount_bp: 1000 }],
      payments: [
        { account: 'Касса магазина', amount: 100000, paid: true, date: '2026-08-12' },
        { account: 'Счет в банке', amount: 80000, paid: false, date: '2026-08-19' },
      ],
    });

    const back = loadDoc(db, id)!;
    expect(back.number).toBe('17');
    expect(back.note).toBe('Накладная №34');
    expect(back.discount_bp).toBe(500);
    expect(back.state).toBe(2);
    expect(back.posted).toBe(true);
    expect(back.lines).toHaveLength(1);
    expect(back.lines[0].name).toBe('Шу пуэр');
    expect(back.lines[0].discount_bp).toBe(1000);
    expect(back.payments).toHaveLength(2);
    expect(docPaid(back.payments)).toBe(100000);
  });

  it('нумерует документы каждого вида отдельно', () => {
    const shop = createLocation(db, 'Ереван');
    const tea = product();

    expect(nextNumber(db, 'purchase')).toBe('1');

    saveDoc(db, {
      ...blankDoc('purchase'),
      number: '1',
      locationToId: shop,
      lines: [{ product_id: tea, qty: 1000, price: 100000 }],
    });

    expect(nextNumber(db, 'purchase')).toBe('2');
    expect(nextNumber(db, 'sale')).toBe('1');
  });

  it('без позиций не сохраняется', () => {
    expect(() => saveDoc(db, { ...blankDoc('purchase'), locationToId: 1 })).toThrow();
  });

  it('перемещение в тот же магазин не сохраняется', () => {
    const shop = createLocation(db, 'Ереван');
    const tea = product();
    expect(() =>
      saveDoc(db, {
        ...blankDoc('transfer'),
        locationId: shop,
        locationToId: shop,
        lines: [{ product_id: tea, qty: 1000, price: 0 }],
      }),
    ).toThrow();
  });
});

describe('сумма документа', () => {
  it('считает скидку позиции, потом скидку документа', () => {
    // 2 кг × 1000,00 = 2000,00; минус 10 % позиции = 1800,00;
    // минус 5 % документа = 1710,00.
    const total = docTotal([{ product_id: 1, qty: 2000, price: 100000, discount_bp: 1000 }], 500);
    expect(total).toBe(171000);
  });

  it('без скидок равна произведению', () => {
    expect(docTotal([{ product_id: 1, qty: 1500, price: 200000 }])).toBe(300000);
  });
});

describe('возврат без чека', () => {
  it('возвращает товар на склад и выдаёт деньги из кассы', () => {
    const shop = createLocation(db, 'Ереван');
    const tea = product();

    saveDoc(db, {
      ...blankDoc('purchase'),
      locationToId: shop,
      lines: [{ product_id: tea, qty: 4000, price: 100000 }],
    });
    createSale(db, {
      lines: [
        {
          product_id: tea,
          name: 'Шу пуэр',
          unit: 'кг',
          qty: 2000,
          price: 200000,
          cost_price: 100000,
          stock: 4000,
        },
      ],
      payment: 'cash',
      locationId: shop,
    });

    expect(stockAt(db, tea, shop)).toBe(2000);
    const afterSale = new Map(accountBalances(db).map((row) => [row.name, row.balance]));
    // 2 кг по 2000,00.
    expect(afterSale.get('Касса магазина')).toBe(400000);

    createReturn(db, {
      lines: [
        {
          product_id: tea,
          name: 'Шу пуэр',
          unit: 'кг',
          qty: 1000,
          price: 200000,
          cost_price: 100000,
          stock: 2000,
        },
      ],
      payment: 'cash',
      locationId: shop,
    });

    expect(stockAt(db, tea, shop)).toBe(3000);
    const after = new Map(accountBalances(db).map((row) => [row.name, row.balance]));
    // 4000,00 пришло, 2000,00 выдано обратно.
    expect(after.get('Касса магазина')).toBe(200000);
  });

  it('в журнале выглядит возвратом, а не продажей', () => {
    const shop = createLocation(db, 'Ереван');
    const tea = product();

    createReturn(db, {
      lines: [
        {
          product_id: tea,
          name: 'Шу пуэр',
          unit: 'кг',
          qty: 1000,
          price: 200000,
          cost_price: 100000,
          stock: 0,
        },
      ],
      payment: 'cash',
      locationId: shop,
    });

    const entry = listJournal(db).find((row) => row.kind === 'refund');
    expect(entry).toBeDefined();
  });

  it('пустой возврат не проводится', () => {
    expect(() => createReturn(db, { lines: [] })).toThrow();
  });
});
