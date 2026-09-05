import type { SqlDriver } from '../driver';
import { createTestDriver } from '../testDriver';
import { createCounterparty } from '../counterparties';
import { customerDebt, debtSales, listDebtors, payDebt, totalDebt } from '../debts';
import { createLocation } from '../locations';
import { accountBalances } from '../money';
import { blankDoc, saveDoc } from '../docs';
import { createProduct } from '../products';
import { createSale } from '../sales';
import { openShift, shiftReport } from '../shifts';
import { allocateDebt, debtAfter, debtTotal } from '../../domain/debt';
import type { CartLine, Id } from '../../domain/types';

let db: SqlDriver;

beforeEach(() => {
  db = createTestDriver();
});

/**
 * Товар с остатком: чек перечитывает остаток из базы, и продать то, чего
 * на складе нет, нельзя — даже в тесте про долги.
 */
function tea(): Id {
  const id = createProduct(db, {
    name: 'Шу пуэр',
    sku: null,
    barcode: null,
    category_id: null,
    unit: 'кг',
    cost_price: 100000,
    sale_price: 200000,
    min_qty: 0,
    photo_uri: null,
  });

  saveDoc(db, {
    ...blankDoc('purchase'),
    locationToId: createLocation(db, 'Склад'),
    lines: [{ product_id: id, qty: 100000, price: 100000 }],
  });

  return id;
}

function line(productId: Id, qty = 1000): CartLine {
  return {
    product_id: productId,
    name: 'Шу пуэр',
    unit: 'кг',
    qty,
    price: 200000,
    cost_price: 100000,
    stock: 100000,
  };
}

function customer(name = 'Пётр'): Id {
  return createCounterparty(db, { kind: 'customer', name, phone: '+79990000001' });
}

describe('разнесение долга', () => {
  it('гасит со старого чека', () => {
    const paid = allocateDebt(
      [
        { id: 1, left: 30000 },
        { id: 2, left: 50000 },
      ],
      40000,
    );
    expect(paid).toEqual([
      { id: 1, amount: 30000 },
      { id: 2, amount: 10000 },
    ]);
  });

  it('лишнего не разносит', () => {
    const paid = allocateDebt([{ id: 1, left: 10000 }], 90000);
    expect(paid).toEqual([{ id: 1, amount: 10000 }]);
  });

  it('считает остаток долга и не уходит в минус', () => {
    expect(debtTotal([{ id: 1, left: 30000 }, { id: 2, left: 20000 }])).toBe(50000);
    expect(debtAfter(50000, 20000)).toBe(30000);
    expect(debtAfter(50000, 90000)).toBe(0);
  });
});

describe('долг покупателя', () => {
  it('отсрочка не кладёт денег в кассу, но чек проводится', () => {
    const shop = createLocation(db, 'Ереван');
    const product = tea();
    const petr = customer();

    // Чек на 2000,00; 500,00 приняли наличными, 1500,00 — в отсрочку.
    createSale(db, {
      lines: [line(product)],
      payment: 'cash',
      customerId: petr,
      debt: 150000,
      locationId: shop,
    });

    const cash = new Map(accountBalances(db).map((row) => [row.name, row.balance]));
    expect(cash.get('Касса магазина')).toBe(50000);
    expect(customerDebt(db, petr)).toBe(150000);
    expect(totalDebt(db)).toBe(150000);
  });

  it('розничному отсрочку не дают: долг некому записать', () => {
    const shop = createLocation(db, 'Ереван');
    const product = tea();

    createSale(db, { lines: [line(product)], payment: 'cash', debt: 150000, locationId: shop });

    expect(totalDebt(db)).toBe(0);
    const cash = new Map(accountBalances(db).map((row) => [row.name, row.balance]));
    expect(cash.get('Касса магазина')).toBe(200000);
  });

  it('больше суммы чека в долг не уходит', () => {
    const product = tea();
    const petr = customer();
    createSale(db, { lines: [line(product)], customerId: petr, debt: 900000 });
    expect(customerDebt(db, petr)).toBe(200000);
  });

  it('погашение кладёт деньги в кассу и убирает должника из списка', () => {
    const shop = createLocation(db, 'Ереван');
    const product = tea();
    const petr = customer();

    createSale(db, {
      lines: [line(product)],
      payment: 'cash',
      customerId: petr,
      debt: 200000,
      locationId: shop,
    });

    expect(listDebtors(db)).toHaveLength(1);
    expect(listDebtors(db)[0].debt).toBe(200000);

    // Заносит половину — остаётся половина.
    payDebt(db, { customerId: petr, amount: 80000, payment: 'cash', locationId: shop });
    expect(customerDebt(db, petr)).toBe(120000);

    const half = new Map(accountBalances(db).map((row) => [row.name, row.balance]));
    expect(half.get('Касса магазина')).toBe(80000);

    payDebt(db, { customerId: petr, amount: 120000, payment: 'cash', locationId: shop });
    expect(customerDebt(db, petr)).toBe(0);
    expect(listDebtors(db)).toHaveLength(0);

    const all = new Map(accountBalances(db).map((row) => [row.name, row.balance]));
    expect(all.get('Касса магазина')).toBe(200000);
  });

  it('гасит долг по чекам от старого к новому', () => {
    const product = tea();
    const petr = customer();

    const first = createSale(db, { lines: [line(product)], customerId: petr, debt: 100000 });
    createSale(db, { lines: [line(product)], customerId: petr, debt: 200000 });

    payDebt(db, { customerId: petr, amount: 150000 });

    const left = debtSales(db, petr);
    // Старый чек закрыт целиком, на новом осталось 1500,00.
    expect(left).toHaveLength(1);
    expect(left[0].id).not.toBe(first);
    expect(left[0].left).toBe(150000);
  });

  it('ищет должника по имени и телефону', () => {
    const product = tea();
    const petr = customer('Пётр Иванов');
    createSale(db, { lines: [line(product)], customerId: petr, debt: 100000 });

    expect(listDebtors(db, 'иван')).toHaveLength(1);
    expect(listDebtors(db, '0000001')).toHaveLength(1);
    expect(listDebtors(db, 'сидор')).toHaveLength(0);
  });

  it('без долга погашать нечего', () => {
    const petr = customer();
    expect(() => payDebt(db, { customerId: petr, amount: 10000 })).toThrow();
  });

  it('в смене отсрочка не попадает в наличные, но остаётся в выручке', () => {
    const shop = createLocation(db, 'Ереван');
    db.run(
      "INSERT INTO registers (name, location_id, created_at) VALUES ('Касса', ?, datetime('now'))",
      [shop],
    );
    const registerId = db.lastInsertId();
    const shiftId = openShift(db, { registerId, openingCash: 0, cashier: 'waystea' });

    const product = tea();
    const petr = customer();
    createSale(db, {
      lines: [line(product)],
      payment: 'cash',
      customerId: petr,
      debt: 150000,
      locationId: shop,
    });

    const report = shiftReport(db, shiftId);
    expect(report.revenue).toBe(200000);
    expect(report.cash).toBe(50000);
    // В ящике только принятое, а не вся сумма чека.
    expect(report.expectedCash).toBe(50000);
  });
});
