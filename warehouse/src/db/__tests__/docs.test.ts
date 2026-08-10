import type { SqlDriver } from '../driver';
import { createTestDriver } from '../testDriver';
import { createProduct } from '../products';
import { ensureLocation, stockByLocation } from '../locations';
import { createMoneyDoc } from '../money';
import { listJournal, listMoney, moneyTitle } from '../journal';
import { documentTotals } from '../reports';
import {
  cancelDoc,
  getDoc,
  getStock,
  listDocs,
  postAdjustment,
  postDoc,
  postInventory,
  postTransfer,
} from '../stock';
import { docKind, type DocLine } from '../../domain/types';

const ALL_TIME = { from: '1970-01-01T00:00:00.000Z', to: '2999-01-01T00:00:00.000Z' };

let db: SqlDriver;

beforeEach(() => {
  db = createTestDriver();
});

function product(name = 'Шу пуэр') {
  return createProduct(db, {
    name,
    sku: null,
    barcode: null,
    category_id: null,
    unit: 'кг',
    cost_price: 200000,
    sale_price: 500000,
    min_qty: 0,
    photo_uri: null,
  });
}

function line(productId: number, qty: number, price = 200000): DocLine {
  return { product_id: productId, name: 'Шу пуэр', unit: 'кг', qty, price };
}

describe('виды складских документов', () => {
  it('оприходование приходует товар, но не трогает закупочную цену', () => {
    const id = product();
    postDoc(db, { type: 'stock_in', lines: [line(id, 3000, 999999)] });

    expect(getStock(db, id)).toBe(3000);
    // Цена в оприходовании взята из головы, а не из счёта поставщика.
    expect(db.get<{ cost_price: number }>('SELECT cost_price FROM products WHERE id = ?', [id])!
      .cost_price).toBe(200000);
  });

  it('закупка по новой цене переписывает закупочную цену', () => {
    const id = product();
    postDoc(db, { type: 'purchase', lines: [line(id, 3000, 250000)] });

    expect(db.get<{ cost_price: number }>('SELECT cost_price FROM products WHERE id = ?', [id])!
      .cost_price).toBe(250000);
  });

  it('возврат закупки списывает товар', () => {
    const id = product();
    postDoc(db, { type: 'purchase', lines: [line(id, 5000)] });
    postDoc(db, { type: 'purchase_return', counterparty: 'Чайный путь', lines: [line(id, 2000)] });

    expect(getStock(db, id)).toBe(3000);
    expect(listDocs(db).map((doc) => docKind(doc))).toEqual(['purchase_return', 'purchase']);
  });

  it('перемещение оставляет общий остаток на месте, а по магазинам двигает', () => {
    const id = product();
    const shopA = ensureLocation(db, 'Ереван');
    const shopB = ensureLocation(db, 'Гюмри');

    postDoc(db, { type: 'purchase', locationId: shopA, lines: [line(id, 10000)] });
    postTransfer(db, { from: shopA, to: shopB, lines: [line(id, 4000)] });

    expect(getStock(db, id)).toBe(10000);

    const byShop = stockByLocation(db).get(id)!;
    expect(byShop.get(shopA)).toBe(6000);
    expect(byShop.get(shopB)).toBe(4000);
  });

  it('перемещение не удваивается в журнале и сводке', () => {
    const id = product();
    const shopA = ensureLocation(db, 'Ереван');
    const shopB = ensureLocation(db, 'Гюмри');
    postTransfer(db, { from: shopA, to: shopB, lines: [line(id, 4000)] });

    const entry = listJournal(db).find((row) => row.kind === 'transfer')!;
    // Движений два — расход и приход, — но позиция в документе одна.
    expect(entry.positions).toBe(1);
    expect(entry.amount).toBe(800000);
    expect(entry.sender).toBe('Ереван');
    expect(entry.receiver).toBe('Гюмри');

    const totals = documentTotals(db, ALL_TIME);
    expect(totals.find((row) => row.name === 'Перемещение')).toMatchObject({
      count: 1,
      quantity: 4000,
      amount: 800000,
    });
  });

  it('не перемещает магазин сам в себя', () => {
    const id = product();
    const shop = ensureLocation(db, 'Ереван');
    expect(() => postTransfer(db, { from: shop, to: shop, lines: [line(id, 1000)] })).toThrow();
  });

  it('сводка на главной раскладывает документы по видам', () => {
    const id = product();
    postDoc(db, { type: 'purchase', lines: [line(id, 5000)] });
    postDoc(db, { type: 'stock_in', lines: [line(id, 1000)] });
    postDoc(db, { type: 'writeoff', lines: [line(id, 2000)] });

    const totals = documentTotals(db, ALL_TIME);
    const count = (name: string) => totals.find((row) => row.name === name)!.count;

    expect(count('Закупка')).toBe(1);
    expect(count('Оприходование')).toBe(1);
    expect(count('Списание')).toBe(1);
    expect(count('Возврат закупки')).toBe(0);
  });
});

describe('денежные документы', () => {
  it('расход попадает в движение денег со своей стороной', () => {
    createMoneyDoc(db, {
      type: 'expense',
      amount: 1500000,
      account: 'Касса магазина',
      category: 'Аренда',
    });

    const [entry] = listMoney(db);
    expect(entry.expense).toBe(1500000);
    expect(entry.income).toBe(0);
    expect(moneyTitle(entry)).toBe('Расход #1');
  });

  it('перевод показывается одной строкой «откуда → куда»', () => {
    createMoneyDoc(db, {
      type: 'transfer',
      amount: 500000,
      account: 'Касса магазина',
      accountTo: 'Счет в банке',
    });

    const [entry] = listMoney(db);
    expect(entry.account).toBe('Касса магазина → Счет в банке');
    expect(moneyTitle(entry)).toBe('Перевод #1');
  });

  it('не принимает перевод на тот же счёт и сумму меньше нуля', () => {
    expect(() =>
      createMoneyDoc(db, {
        type: 'transfer',
        amount: 100,
        account: 'Касса магазина',
        accountTo: 'Касса магазина',
      }),
    ).toThrow();

    expect(() =>
      createMoneyDoc(db, { type: 'income', amount: 0, account: 'Касса магазина' }),
    ).toThrow();
  });
});

describe('просмотр документа', () => {
  it('отдаёт позиции, суммы и магазины', () => {
    const tea = product('Шу пуэр');
    const docId = postDoc(db, {
      type: 'purchase',
      counterparty: 'Чайный дом',
      note: 'Августовская закупка',
      lines: [
        { product_id: tea, name: 'Шу пуэр', unit: 'кг', qty: 8000, price: 200000 },
      ],
    });

    const doc = getDoc(db, docId)!;
    expect(doc.subtype).toBe('purchase');
    expect(doc.counterparty).toBe('Чайный дом');
    expect(doc.positions_list).toHaveLength(1);
    expect(doc.positions_list[0].name).toBe('Шу пуэр');
    expect(doc.positions_list[0].qty).toBe(8000);
    // 8 кг по 2000,00 — 16 000,00.
    expect(doc.positions_list[0].sum).toBe(1600000);
    expect(doc.amount).toBe(1600000);
  });

  it('у перемещения показывает одну сторону, а не обе', () => {
    const tea = product('Шу пуэр');
    const shopA = ensureLocation(db, 'Магазин А');
    const shopB = ensureLocation(db, 'Магазин Б');
    postDoc(db, {
      type: 'purchase',
      locationId: shopA,
      lines: [{ product_id: tea, name: 'Шу пуэр', unit: 'кг', qty: 8000, price: 200000 }],
    });

    const docId = postTransfer(db, {
      from: shopA,
      to: shopB,
      lines: [{ product_id: tea, name: 'Шу пуэр', unit: 'кг', qty: 3000, price: 200000 }],
    });

    const doc = getDoc(db, docId)!;
    expect(doc.positions_list).toHaveLength(1);
    expect(doc.positions_list[0].qty).toBe(3000);
    expect(doc.location_name).toBe('Магазин А');
    expect(doc.location_to_name).toBe('Магазин Б');
  });

  it('отмена возвращает остаток к тому, что было до документа', () => {
    const tea = product('Шу пуэр');
    postDoc(db, {
      type: 'purchase',
      lines: [{ product_id: tea, name: 'Шу пуэр', unit: 'кг', qty: 8000, price: 200000 }],
    });
    const writeoff = postDoc(db, {
      type: 'writeoff',
      lines: [{ product_id: tea, name: 'Шу пуэр', unit: 'кг', qty: 3000, price: 200000 }],
    });

    expect(getStock(db, tea)).toBe(5000);

    cancelDoc(db, writeoff);

    expect(getStock(db, tea)).toBe(8000);
    expect(getDoc(db, writeoff)).toBeNull();
  });
});

describe('инвентаризация и корректировка', () => {
  it('инвентаризация выравнивает остаток по факту и оставляет ведомость', () => {
    const tea = product('Шу пуэр');
    postDoc(db, { type: 'purchase', lines: [line(tea, 8000)] });

    const docId = postInventory(db, {
      note: 'Ревизия за август',
      lines: [{ product_id: tea, name: 'Шу пуэр', unit: 'кг', actual: 7500, price: 200000 }],
    });

    expect(getStock(db, tea)).toBe(7500);

    const doc = getDoc(db, docId)!;
    expect(docKind(doc)).toBe('inventory');
    expect(doc.note).toBe('Ревизия за август');
    // Недостача полкило: в ведомости она видна как позиция.
    expect(doc.positions_list).toHaveLength(1);
    expect(doc.positions_list[0].qty).toBe(500);
  });

  it('позиции без расхождения тоже попадают в ведомость', () => {
    const tea = product('Шу пуэр');
    postDoc(db, { type: 'purchase', lines: [line(tea, 8000)] });

    const docId = postInventory(db, {
      lines: [{ product_id: tea, name: 'Шу пуэр', unit: 'кг', actual: 8000 }],
    });

    expect(getStock(db, tea)).toBe(8000);
    expect(getDoc(db, docId)!.positions_list).toHaveLength(1);
  });

  it('считает факт по магазину пересчёта, а не по всем сразу', () => {
    const tea = product('Шу пуэр');
    const shopA = ensureLocation(db, 'Ереван');
    const shopB = ensureLocation(db, 'Гюмри');
    postDoc(db, { type: 'purchase', locationId: shopA, lines: [line(tea, 5000)] });
    postDoc(db, { type: 'purchase', locationId: shopB, lines: [line(tea, 3000)] });

    // В Ереване насчитали 4 кг вместо пяти. Гюмри трогать нельзя.
    postInventory(db, {
      locationId: shopA,
      lines: [{ product_id: tea, name: 'Шу пуэр', unit: 'кг', actual: 4000 }],
    });

    const byShop = stockByLocation(db).get(tea)!;
    expect(byShop.get(shopA)).toBe(4000);
    expect(byShop.get(shopB)).toBe(3000);
    expect(getStock(db, tea)).toBe(7000);
  });

  it('отрицательный факт не принимается', () => {
    const tea = product('Шу пуэр');
    expect(() =>
      postInventory(db, {
        lines: [{ product_id: tea, name: 'Шу пуэр', unit: 'кг', actual: -1000 }],
      }),
    ).toThrow(/отрицательным/);
  });

  it('корректировка двигает остаток на указанную величину', () => {
    const tea = product('Шу пуэр');
    postDoc(db, { type: 'purchase', lines: [line(tea, 8000)] });

    const docId = postAdjustment(db, {
      note: 'Пересорт',
      lines: [{ product_id: tea, name: 'Шу пуэр', unit: 'кг', delta: -500, price: 200000 }],
    });

    expect(getStock(db, tea)).toBe(7500);
    expect(docKind(getDoc(db, docId)!)).toBe('adjustment');
  });

  it('оба вида проводятся своими функциями, а не общей', () => {
    const tea = product('Шу пуэр');
    expect(() => postDoc(db, { type: 'inventory', lines: [line(tea, 1000)] })).toThrow(
      /postInventory/,
    );
    expect(() => postDoc(db, { type: 'adjustment', lines: [line(tea, 1000)] })).toThrow(
      /postAdjustment/,
    );
  });
});
