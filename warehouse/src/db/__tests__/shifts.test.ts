import type { SqlDriver } from '../driver';
import { createTestDriver } from '../testDriver';
import { ensureLocation } from '../locations';
import { createMoneyDoc } from '../money';
import { createProduct } from '../products';
import { createSale, refundSale } from '../sales';
import { postDoc } from '../stock';
import {
  closeShift,
  currentShift,
  ensureRegister,
  listRegisters,
  openShift,
  shiftReport,
} from '../shifts';
import type { CartLine } from '../../domain/types';

let db: SqlDriver;
let registerId: number;
let productId: number;

beforeEach(() => {
  db = createTestDriver();
  registerId = ensureRegister(db, 'Касса — Рынок', ensureLocation(db, 'Рынок на Студёной'));

  productId = createProduct(db, {
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
  postDoc(db, {
    type: 'purchase',
    lines: [{ product_id: productId, name: 'Шу пуэр', unit: 'кг', qty: 10000, price: 100000 }],
  });
});

function cartLine(qty: number): CartLine {
  return {
    product_id: productId,
    name: 'Шу пуэр',
    unit: 'кг',
    qty,
    price: 200000,
    cost_price: 100000,
    stock: 10000,
  };
}

describe('смена', () => {
  it('не открывается дважды на одной кассе', () => {
    openShift(db, { registerId });
    expect(() => openShift(db, { registerId })).toThrow();
  });

  it('собирает чеки, пробитые после открытия', () => {
    // Чек до открытия смены в неё не попадает: смена отвечает за свой отрезок.
    createSale(db, { lines: [cartLine(1000)], payment: 'cash' });

    const shiftId = openShift(db, { registerId, openingCash: 500000 });
    createSale(db, { lines: [cartLine(1000)], payment: 'cash' });
    createSale(db, { lines: [cartLine(2000)], payment: 'card' });

    const report = shiftReport(db, shiftId);
    expect(report.receipts).toBe(2);
    expect(report.cash).toBe(200000);
    expect(report.card).toBe(400000);
    expect(report.revenue).toBe(600000);
    // Пока смена открыта, расхождения ещё нет — это X-отчёт.
    expect(report.difference).toBeNull();
  });

  it('ожидает в ящике открытие плюс наличные минус изъятия', () => {
    const shiftId = openShift(db, { registerId, openingCash: 500000 });
    createSale(db, { lines: [cartLine(1000)], payment: 'cash' });
    createSale(db, { lines: [cartLine(1000)], payment: 'card' });
    createMoneyDoc(db, {
      type: 'expense',
      amount: 100000,
      account: 'Касса магазина',
      category: 'Инкассация',
    });

    // 5000 открытие + 2000 наличными − 1000 инкассация. Картой в ящик не попало.
    expect(shiftReport(db, shiftId).expectedCash).toBe(600000);
  });

  it('закрытие считает расхождение и больше не даёт закрыть', () => {
    const shiftId = openShift(db, { registerId, openingCash: 500000 });
    createSale(db, { lines: [cartLine(1000)], payment: 'cash' });

    // Ожидается 7000,00, насчитали 6950,00 — полтинника не хватает.
    const report = closeShift(db, shiftId, 695000);
    expect(report.expectedCash).toBe(700000);
    expect(report.difference).toBe(-5000);

    expect(currentShift(db, registerId)).toBeNull();
    expect(() => closeShift(db, shiftId, 695000)).toThrow();
  });

  it('касса знает, открыта ли на ней смена', () => {
    expect(listRegisters(db)[0].open_shift_id).toBeNull();

    const shiftId = openShift(db, { registerId });
    expect(listRegisters(db)[0].open_shift_id).toBe(shiftId);

    closeShift(db, shiftId, 0);
    expect(listRegisters(db)[0].open_shift_id).toBeNull();
  });
});

describe('смена: колонки кабинета', () => {
  it('возвраты считаются отдельно от выручки', () => {
    const register = ensureRegister(db, 'Касса');
    const shiftId = openShift(db, { registerId: register, cashier: 'Аня' });

    const tea = createProduct(db, {
      name: 'Шу пуэр',
      sku: null,
      barcode: null,
      category_id: null,
      unit: 'шт',
      cost_price: 5000,
      sale_price: 10000,
      min_qty: 0,
      photo_uri: null,
    });
    postDoc(db, { type: 'purchase', lines: [{ product_id: tea, name: 'Шу пуэр', unit: 'шт', qty: 10000, price: 5000 }] });

    const first = createSale(db, {
      discount: 0,
      payment: 'cash',
      lines: [{ product_id: tea, name: 'Шу пуэр', unit: 'шт', qty: 2000, price: 10000, cost_price: 5000, stock: 10000 }],
    });
    createSale(db, {
      discount: 0,
      payment: 'card',
      lines: [{ product_id: tea, name: 'Шу пуэр', unit: 'шт', qty: 1000, price: 10000, cost_price: 5000, stock: 8000 }],
    });

    refundSale(db, first);

    const report = shiftReport(db, shiftId);

    // Возвращённый чек обнуляется, поэтому в сумме продаж остаётся только
    // второй — а возврат виден отдельной парой чисел.
    expect(report.returns).toBe(1);
    expect(report.returnsSum).toBe(20000);
    expect(report.revenue).toBe(10000);
    expect(report.shift.cashier).toBe('Аня');
  });
});
