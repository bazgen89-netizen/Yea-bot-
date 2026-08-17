import { createCounterparty } from '../counterparties';
import type { SqlDriver } from '../driver';
import { createProduct } from '../products';
import { groupByDay, receiptJournal, receiptLines } from '../receipts';
import { createSale } from '../sales';
import { adjustStock } from '../stock';
import { createTestDriver } from '../testDriver';
import type { CartLine } from '../../domain/types';

let db: SqlDriver;

beforeEach(() => {
  db = createTestDriver();
});

function product(name: string): number {
  const id = createProduct(db, {
    name,
    sku: null,
    barcode: null,
    category_id: null,
    unit: 'шт',
    cost_price: 10000,
    sale_price: 20000,
    min_qty: 0,
    photo_uri: null,
  });
  adjustStock(db, id, 100000, 'Начальный остаток');
  return id;
}

function line(productId: number, name: string): CartLine {
  return {
    product_id: productId,
    name,
    unit: 'шт',
    qty: 1000,
    price: 20000,
    cost_price: 10000,
    stock: 100000,
  };
}

describe('журнал чеков', () => {
  it('показывает магазин, покупателя и число позиций', () => {
    const tea = product('Шу пуэр');
    const cup = product('Гайвань');
    const customer = createCounterparty(db, { name: 'Фирсов Алексей', kind: 'customer' });

    createSale(db, {
      lines: [line(tea, 'Шу пуэр'), line(cup, 'Гайвань')],
      customerId: customer,
      note: 'перевод',
    });

    const [receipt] = receiptJournal(db);
    expect(receipt.customer).toBe('Фирсов Алексей');
    expect(receipt.note).toBe('перевод');
    expect(receipt.positions).toBe(2);
  });

  it('ищет по номеру документа вхождением', () => {
    const tea = product('Шу пуэр');
    const first = createSale(db, { lines: [line(tea, 'Шу пуэр')] });

    expect(receiptJournal(db, { number: String(first) })).toHaveLength(1);
    expect(receiptJournal(db, { number: '999' })).toHaveLength(0);
  });

  it('оставляет чеки выбранного покупателя', () => {
    const tea = product('Шу пуэр');
    const one = createCounterparty(db, { name: 'Первый', kind: 'customer' });
    const two = createCounterparty(db, { name: 'Второй', kind: 'customer' });

    createSale(db, { lines: [line(tea, 'Шу пуэр')], customerId: one });
    createSale(db, { lines: [line(tea, 'Шу пуэр')], customerId: two });

    const found = receiptJournal(db, { customerId: one });
    expect(found).toHaveLength(1);
    expect(found[0].customer).toBe('Первый');
  });

  it('оставляет чеки, в которых есть выбранный товар', () => {
    const tea = product('Шу пуэр');
    const cup = product('Гайвань');

    createSale(db, { lines: [line(tea, 'Шу пуэр')] });
    createSale(db, { lines: [line(cup, 'Гайвань')] });

    expect(receiptJournal(db, { productId: cup })).toHaveLength(1);
  });

  it('условия складываются, а не заменяют друг друга', () => {
    const tea = product('Шу пуэр');
    const cup = product('Гайвань');
    const customer = createCounterparty(db, { name: 'Фирсов', kind: 'customer' });

    createSale(db, { lines: [line(tea, 'Шу пуэр')], customerId: customer });
    createSale(db, { lines: [line(cup, 'Гайвань')] });

    // Тот покупатель, но не тот товар — значит, ничего.
    expect(receiptJournal(db, { customerId: customer, productId: cup })).toHaveLength(0);
    expect(receiptJournal(db, { customerId: customer, productId: tea })).toHaveLength(1);
  });

  it('позиции чека возвращаются с названием и суммой строки', () => {
    const tea = product('Шу пуэр');
    const saleId = createSale(db, { lines: [line(tea, 'Шу пуэр')] });

    const [first] = receiptLines(db, saleId);
    expect(first.name).toBe('Шу пуэр');
    expect(first.qty).toBe(1000);
    // Одна штука по 200,00 — двести рублей, а не двести тысяч копеек за тысячу.
    expect(first.total).toBe(20000);
  });

  it('чеки одного дня собираются в одну группу', () => {
    const tea = product('Шу пуэр');
    createSale(db, { lines: [line(tea, 'Шу пуэр')] });
    createSale(db, { lines: [line(tea, 'Шу пуэр')] });

    const days = groupByDay(receiptJournal(db));
    expect(days).toHaveLength(1);
    expect(days[0].receipts).toHaveLength(2);
  });
});
