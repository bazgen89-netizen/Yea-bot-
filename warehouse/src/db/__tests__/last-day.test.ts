import { createTestDriver } from '../testDriver';
import type { SqlDriver } from '../driver';
import { ensureLocation } from '../locations';
import { createProduct } from '../products';
import { createSale } from '../sales';
import { createMoneyDoc } from '../money';
import { lastJournalDay, lastMoneyDay } from '../journal';

/**
 * Последний день с документами.
 *
 * По нему журналы выбирают, какую неделю показать при открытии. Пока это
 * считалось от сегодняшнего числа, оба журнала на перенесённой истории
 * открывались пустыми.
 */
describe('последний день с документами', () => {
  let db: SqlDriver;
  let store: number;
  let productId: number;

  beforeEach(() => {
    db = createTestDriver();
    store = ensureLocation(db, 'Чайный бар');
    productId = createProduct(db, {
      name: 'Габа Алишань',
      sku: null,
      barcode: null,
      category_id: null,
      unit: 'гр',
      cost_price: 3_000,
      sale_price: 10_000,
      min_qty: 0,
      photo_uri: null,
    });
  });

  const saleOn = (iso: string) => {
    const id = createSale(db, {
      lines: [
        {
          product_id: productId,
          name: 'Габа Алишань',
          qty: 1_000,
          price: 10_000,
          cost_price: 3_000,
          unit: 'гр',
          stock: 0,
        },
      ],
      locationId: store,
      allowNegative: true,
    });
    db.run('UPDATE sales SET created_at = ? WHERE id = ?', [iso, id]);
    return id;
  };

  it('пустая база — дня нет', () => {
    expect(lastJournalDay(db)).toBeNull();
    expect(lastMoneyDay(db)).toBeNull();
  });

  it('берёт самый поздний чек, а не последний заведённый', () => {
    saleOn('2026-08-20T10:00:00.000Z');
    // Чек задним числом заведён позже, но день у него раньше.
    saleOn('2026-08-11T10:00:00.000Z');

    expect(lastJournalDay(db)).toBe('2026-08-20');
  });

  it('у денег свой последний день: расход бывает позже последнего чека', () => {
    saleOn('2026-08-20T10:00:00.000Z');

    const rent = createMoneyDoc(db, {
      type: 'expense',
      amount: 50_000,
      account: 'Касса магазина',
      category: 'Аренда',
      locationId: store,
    });
    db.run('UPDATE money_docs SET created_at = ? WHERE id = ?', ['2026-08-31T10:00:00.000Z', rent]);

    // Товар в этот день не двигался — аренда склада не касается.
    expect(lastJournalDay(db)).toBe('2026-08-20');
    expect(lastMoneyDay(db)).toBe('2026-08-31');
  });
});
