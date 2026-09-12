import { createTestDriver } from '../testDriver';
import type { SqlDriver } from '../driver';
import { ensureLocation } from '../locations';
import { createProduct, getProduct } from '../products';
import { createSale, getSale, updateSale } from '../sales';
import type { CartLine } from '../../domain/types';

/**
 * Правка проведённого чека.
 *
 * Кнопка «Редактировать» у него стоит на каждом документе, и это не
 * украшение: кассир пробил три пачки вместо двух, покупатель ушёл — чек
 * надо исправить. У нас эта кнопка была приглушена, и он спросил, почему
 * нельзя редактировать. Потому что не было сделано.
 *
 * Главное здесь — склад: после правки остаток обязан сойтись с новым
 * количеством, а не остаться от прежнего.
 */
describe('правка чека', () => {
  let db: SqlDriver;
  let productId: number;
  let store: number;

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

    // Приход, чтобы было что продавать: остаток — сумма движений.
    db.run(
      `INSERT INTO stock_moves (product_id, qty_delta, reason, price, created_at, location_id)
       VALUES (?, ?, 'adjust', 0, '2026-08-01T00:00:00.000Z', ?)`,
      [productId, 100_000, store],
    );
  });

  const line = (qty: number): CartLine => ({
    product_id: productId,
    name: 'Габа Алишань',
    qty,
    price: 10_000,
    cost_price: 3_000,
    unit: 'гр',
    stock: 100_000,
  });

  const stock = () => getProduct(db, productId)?.stock ?? 0;

  it('меняет количество — и остаток сходится с новым', () => {
    const saleId = createSale(db, { lines: [line(3_000)], locationId: store });
    expect(stock()).toBe(97_000);

    updateSale(db, saleId, { lines: [line(2_000)] });

    expect(getSale(db, saleId)?.items[0].qty).toBe(2_000);
    // Продали две вместо трёх — одна вернулась на полку.
    expect(stock()).toBe(98_000);
  });

  it('пересчитывает сумму и себестоимость', () => {
    const saleId = createSale(db, { lines: [line(3_000)], locationId: store });
    updateSale(db, saleId, { lines: [line(2_000)] });

    const sale = getSale(db, saleId);
    expect(sale?.total).toBe(20_000);
    expect(sale?.cost_total).toBe(6_000);
  });

  it('убирает строку из чека', () => {
    const other = createProduct(db, {
      name: 'Пуэр',
      sku: null,
      barcode: null,
      category_id: null,
      unit: 'шт',
      cost_price: 1_000,
      sale_price: 5_000,
      min_qty: 0,
      photo_uri: null,
    });

    const saleId = createSale(db, {
      lines: [
        line(1_000),
        { product_id: other, name: 'Пуэр', qty: 1_000, price: 5_000, cost_price: 1_000, unit: 'шт', stock: 0 },
      ],
      locationId: store,
      allowNegative: true,
    });

    updateSale(db, saleId, { lines: [line(1_000)] });

    const sale = getSale(db, saleId);
    expect(sale?.items).toHaveLength(1);
    expect(sale?.total).toBe(10_000);
    // Второй товар вернулся: его движение по этому чеку убрано.
    expect(getProduct(db, other)?.stock).toBe(0);
  });

  it('не трогает номер чека, время и бонусы', () => {
    const saleId = createSale(db, { lines: [line(3_000)], locationId: store });
    const before = getSale(db, saleId);

    updateSale(db, saleId, { lines: [line(1_000)] });
    const after = getSale(db, saleId);

    expect(after?.number).toBe(before?.number);
    expect(after?.created_at).toBe(before?.created_at);
    expect(after?.bonus_earned).toBe(before?.bonus_earned);
  });

  it('пустой чек сохранить нельзя', () => {
    const saleId = createSale(db, { lines: [line(1_000)], locationId: store });
    expect(() => updateSale(db, saleId, { lines: [] })).toThrow();
  });

  it('скидка на чек пересчитывается', () => {
    const saleId = createSale(db, { lines: [line(3_000)], locationId: store });
    updateSale(db, saleId, { lines: [line(3_000)], discount: 5_000 });

    const sale = getSale(db, saleId);
    expect(sale?.discount).toBe(5_000);
    expect(sale?.total).toBe(25_000);
  });
});
