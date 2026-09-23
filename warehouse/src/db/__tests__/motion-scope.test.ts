import { createTestDriver } from '../testDriver';
import type { SqlDriver } from '../driver';
import { ensureLocation } from '../locations';
import { createProduct } from '../products';
import { motionByProduct, periodFor } from '../reports';
import { postDoc } from '../stock';

/**
 * Отбор по магазину в «Отчёте по движению».
 *
 * Здесь легче всего соврать незаметно: приход и расход отобрать по
 * магазину, а остаток на начало взять по всем трём. Тогда «Конечный
 * остаток» не сойдётся ни с чем, и заметить это можно только сложив
 * колонки вручную.
 */
describe('движение по магазину', () => {
  let db: SqlDriver;
  let бар: number;
  let черёмушки: number;
  let чай: number;

  const приход = (место: number, сколько: number, когда: string) => {
    postDoc(db, {
      type: 'receipt',
      locationId: место,
      lines: [{ product_id: чай, name: 'Габа Алишань', unit: 'гр', qty: сколько, price: 3_000 }],
    });
    db.run('UPDATE stock_moves SET created_at = ? WHERE id = (SELECT MAX(id) FROM stock_moves)', [
      когда,
    ]);
  };

  beforeEach(() => {
    db = createTestDriver();
    бар = ensureLocation(db, 'Чайный бар');
    черёмушки = ensureLocation(db, 'Черёмушки');
    чай = createProduct(db, {
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

  it('остаток на начало берётся по тому же магазину, что приход и расход', () => {
    const период = periodFor('month');
    const доПериода = new Date(new Date(период.from).getTime() - 86_400_000).toISOString();

    // До периода: десять в бар, тысяча в Черёмушки.
    приход(бар, 10_000, доПериода);
    приход(черёмушки, 1_000_000, доПериода);
    // Внутри периода — только в бар.
    приход(бар, 5_000, период.from);

    const [строка] = motionByProduct(db, период, { место: бар });

    // Начальный остаток — десять, а не тысяча десять.
    expect(строка.before).toBe(10_000);
    expect(строка.movsIn).toBe(5_000);
    expect(строка.after).toBe(15_000);
  });

  it('без отбора складывает все магазины', () => {
    const период = periodFor('month');
    приход(бар, 3_000, период.from);
    приход(черёмушки, 4_000, период.from);

    const [строка] = motionByProduct(db, период);
    expect(строка.movsIn).toBe(7_000);
  });

  it('чужой магазин — пусто, а не чужие числа', () => {
    const период = periodFor('month');
    приход(бар, 3_000, период.from);

    expect(motionByProduct(db, период, { место: черёмушки })).toEqual([]);
  });
});
