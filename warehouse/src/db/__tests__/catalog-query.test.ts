import { createTestDriver } from '../testDriver';
import type { SqlDriver } from '../driver';
import { ensureLocation } from '../locations';
import { createProduct, listProducts } from '../products';
import { createSale } from '../sales';

/**
 * Окно «Фильтр» в каталоге.
 *
 * Он собирает в нём своё условие: «базовая цена больше пятисот и остаток
 * общий меньше десяти». Восемь готовых наборов, которые стояли у нас
 * раньше, отвечали на восемь вопросов — а вопрос у него каждый раз свой,
 * и это ровно то, что он показывал на снимке.
 */
describe('отбор каталога из окна «Фильтр»', () => {
  let db: SqlDriver;
  let store: number;

  const make = (over: Partial<Parameters<typeof createProduct>[1]> = {}) =>
    createProduct(db, {
      name: 'Чай',
      sku: null,
      barcode: null,
      category_id: null,
      unit: 'гр',
      cost_price: 0,
      sale_price: 10_000,
      min_qty: 0,
      photo_uri: null,
      ...over,
    });

  const names = (query: Parameters<typeof listProducts>[1]) =>
    listProducts(db, query).map((product) => product.name).sort();

  beforeEach(() => {
    db = createTestDriver();
    store = ensureLocation(db, 'Чайный бар');
  });

  it('цена: больше, меньше, равно', () => {
    make({ name: 'Дешёвый', sale_price: 10_000 });
    make({ name: 'Средний', sale_price: 50_000 });
    make({ name: 'Дорогой', sale_price: 90_000 });

    expect(names({ query: { price: { field: 'sale', op: 'gt', value: 50_000 } } })).toEqual(['Дорогой']);
    expect(names({ query: { price: { field: 'sale', op: 'lt', value: 50_000 } } })).toEqual(['Дешёвый']);
    expect(names({ query: { price: { field: 'sale', op: 'eq', value: 50_000 } } })).toEqual(['Средний']);
  });

  it('цена закупки — отдельная от базовой', () => {
    make({ name: 'Свой', sale_price: 90_000, purchase_price: 10_000 });
    make({ name: 'Чужой', sale_price: 10_000, purchase_price: 90_000 });

    expect(names({ query: { price: { field: 'purchase', op: 'gt', value: 50_000 } } })).toEqual(['Чужой']);
  });

  it('остаток общий и остаток по магазину — разные числа', () => {
    const other = ensureLocation(db, 'Черёмушки');
    const id = make({ name: 'Габа' });

    db.run(
      `INSERT INTO stock_moves (product_id, qty_delta, reason, price, created_at, location_id)
       VALUES (?, ?, 'adjust', 0, '2026-08-01T00:00:00.000Z', ?)`,
      [id, 3_000, store],
    );
    db.run(
      `INSERT INTO stock_moves (product_id, qty_delta, reason, price, created_at, location_id)
       VALUES (?, ?, 'adjust', 0, '2026-08-01T00:00:00.000Z', ?)`,
      [id, 8_000, other],
    );

    // Общий — одиннадцать, в «Чайном баре» — три.
    expect(names({ query: { stock: { op: 'gt', value: 10_000 } } })).toEqual(['Габа']);
    expect(names({ query: { stock: { locationId: store, op: 'gt', value: 10_000 } } })).toEqual([]);
    expect(names({ query: { stock: { locationId: store, op: 'lt', value: 5_000 } } })).toEqual(['Габа']);
  });

  it('срок годности: истекает в течение N дней', () => {
    make({ name: 'Скоро', expires_at: '2026-08-25' });
    make({ name: 'Нескоро', expires_at: '2026-12-31' });
    make({ name: 'Без срока' });

    expect(names({ query: { expiresInDays: 7 }, today: '2026-08-23' })).toEqual(['Скоро']);
  });

  it('продаваемость: продавался и не продавался за N дней', () => {
    const sold = make({ name: 'Ходовой' });
    make({ name: 'Лежалый' });

    createSale(db, {
      lines: [
        {
          product_id: sold,
          name: 'Ходовой',
          unit: 'гр',
          qty: 1_000,
          price: 10_000,
          cost_price: 0,
          stock: 0,
        },
      ],
      allowNegative: true,
    });

    expect(names({ query: { sold: { within: true, days: 30 } } })).toEqual(['Ходовой']);
    expect(names({ query: { sold: { within: false, days: 30 } } })).toEqual(['Лежалый']);
  });

  it('услуги и товары различаются', () => {
    make({ name: 'Товар' });
    make({ name: 'Услуга', kind: 'service' });

    expect(names({ query: { kinds: ['service'] } })).toEqual(['Услуга']);
    expect(names({ query: { kinds: ['product'] } })).toEqual(['Товар']);
    expect(names({ query: { kinds: ['product', 'service'] } })).toEqual(['Товар', 'Услуга']);
  });

  it('части условия складываются по «и», а не по «или»', () => {
    make({ name: 'Оба', sale_price: 90_000, kind: 'product' });
    make({ name: 'Только цена', sale_price: 90_000, kind: 'service' });
    make({ name: 'Только вид', sale_price: 10_000, kind: 'product' });

    expect(
      names({ query: { kinds: ['product'], price: { field: 'sale', op: 'gt', value: 50_000 } } }),
    ).toEqual(['Оба']);
  });

  it('пустой отбор ничего не отсеивает', () => {
    make({ name: 'Первый' });
    make({ name: 'Второй' });

    expect(names({ query: {} })).toHaveLength(2);
  });

  it('изменённые за N дней', () => {
    const id = make({ name: 'Правленый' });
    make({ name: 'Нетронутый' });

    // Правка ставит `updated_at`; у нетронутого товара его нет вовсе.
    db.run('UPDATE products SET updated_at = ? WHERE id = ?', ['2026-08-23T10:00:00.000Z', id]);

    expect(names({ query: { changedInDays: 1 }, today: '2026-08-23' })).toEqual(['Правленый']);
  });
});
