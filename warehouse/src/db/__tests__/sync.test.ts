import { createTestDriver } from '../testDriver';
import type { SqlDriver } from '../driver';
import { ensureLocation } from '../locations';
import { createProduct } from '../products';
import { createSale } from '../sales';
import { getStock } from '../stock';
import { applyPull, fillUids, newUid, outbox } from '../sync';

/**
 * Обмен между устройствами.
 *
 * Проверяется не «функция вернула объект», а то, ради чего всё затевалось:
 * пробили чек на кассе — он появился на телефоне кладовщика, и остаток на
 * обоих сошёлся. Две базы здесь — это два настоящих устройства.
 */
describe('синхронизация с сервером', () => {
  let касса: SqlDriver;
  let телефон: SqlDriver;

  beforeEach(() => {
    касса = createTestDriver();
    телефон = createTestDriver();
  });

  const заводимТовар = (db: SqlDriver, name: string, price: number) =>
    createProduct(db, {
      name,
      sku: null,
      barcode: null,
      category_id: null,
      unit: 'гр',
      cost_price: 3_000,
      sale_price: price,
      min_qty: 0,
      photo_uri: null,
    });

  it('общее имя проставляется всему, что его не имеет, и больше не меняется', () => {
    ensureLocation(касса, 'Чайный бар');
    заводимТовар(касса, 'Габа Алишань', 10_000);

    expect(fillUids(касса)).toBeGreaterThan(0);
    const было = касса.all<{ uid: string }>('SELECT uid FROM products').map((row) => row.uid);
    expect(было.every(Boolean)).toBe(true);

    // Второй проход ничего не трогает: имя даётся один раз и навсегда.
    expect(fillUids(касса)).toBe(0);
    const стало = касса.all<{ uid: string }>('SELECT uid FROM products').map((row) => row.uid);
    expect(стало).toEqual(было);
  });

  it('каталог доезжает до второго устройства', () => {
    ensureLocation(касса, 'Чайный бар');
    заводимТовар(касса, 'Габа Алишань', 10_000);
    fillUids(касса);

    const итог = applyPull(телефон, outbox(касса).payload);

    expect(итог.added).toBeGreaterThan(0);
    const товар = телефон.get<{ name: string; sale_price: number }>(
      'SELECT name, sale_price FROM products',
    );
    expect(товар?.name).toBe('Габа Алишань');
    expect(товар?.sale_price).toBe(10_000);
  });

  it('второй обмен ничего не задваивает', () => {
    ensureLocation(касса, 'Чайный бар');
    заводимТовар(касса, 'Габа Алишань', 10_000);
    fillUids(касса);

    applyPull(телефон, outbox(касса).payload);
    applyPull(телефон, outbox(касса).payload);

    expect(телефон.get<{ n: number }>('SELECT COUNT(*) AS n FROM products')?.n).toBe(1);
  });

  it('чек с кассы приезжает на телефон вместе с остатком', () => {
    const бар = ensureLocation(касса, 'Чайный бар');
    const чай = заводимТовар(касса, 'Габа Алишань', 10_000);

    // Товар кладётся на склад и продаётся — как в жизни.
    касса.run(
      `INSERT INTO stock_moves (product_id, qty_delta, reason, price, location_id, created_at)
       VALUES (?, 10000, 'receipt', 3000, ?, '2026-09-03T08:00:00.000Z')`,
      [чай, бар],
    );
    createSale(касса, {
      lines: [
        {
          product_id: чай,
          name: 'Габа Алишань',
          qty: 2_000,
          price: 10_000,
          cost_price: 3_000,
          unit: 'гр',
          stock: 10_000,
        },
      ],
      locationId: бар,
      payment: 'cash',
    });
    fillUids(касса);

    applyPull(телефон, outbox(касса).payload);

    // Чек на месте…
    expect(телефон.get<{ n: number }>('SELECT COUNT(*) AS n FROM sales')?.n).toBe(1);
    // …и остаток сошёлся: восемь грамм там и там.
    const товар = телефон.get<{ id: number }>('SELECT id FROM products')!;
    expect(getStock(телефон, товар.id)).toBe(getStock(касса, чай));
    expect(getStock(телефон, товар.id)).toBe(8_000);
  });

  it('правка справочника доезжает, а чек второй раз не переписывается', () => {
    const бар = ensureLocation(касса, 'Чайный бар');
    const чай = заводимТовар(касса, 'Габа Алишань', 10_000);
    createSale(касса, {
      lines: [
        {
          product_id: чай,
          name: 'Габа Алишань',
          qty: 1_000,
          price: 10_000,
          cost_price: 3_000,
          unit: 'гр',
          stock: 0,
        },
      ],
      locationId: бар,
      payment: 'cash',
      allowNegative: true,
    });
    fillUids(касса);
    applyPull(телефон, outbox(касса).payload);

    // Справочник правится — правка должна доехать.
    касса.run('UPDATE products SET sale_price = 12000, name = ? WHERE id = ?', [
      'Габа Алишань 2026',
      чай,
    ]);
    // А чек «правится» задним числом — этого доехать не должно: событие
    // случилось один раз, и переписывать его нельзя.
    касса.run('UPDATE sales SET total = 999999 WHERE id = 1');

    applyPull(телефон, outbox(касса).payload);

    const товар = телефон.get<{ name: string; sale_price: number }>(
      'SELECT name, sale_price FROM products',
    );
    expect(товар?.name).toBe('Габа Алишань 2026');
    expect(товар?.sale_price).toBe(12_000);

    expect(телефон.get<{ total: number }>('SELECT total FROM sales')?.total).toBe(10_000);
  });

  it('строка чека без самого чека не заводится висячей', () => {
    const чай = заводимТовар(телефон, 'Габа Алишань', 10_000);
    телефон.run('UPDATE products SET uid = ? WHERE id = ?', ['товар-1', чай]);

    const итог = applyPull(телефон, {
      sale_items: [
        { id: 'строка-1', sale_id: 'чека-такого-нет', product_id: 'товар-1', qty: 1_000, price: 10_000 },
      ],
    });

    expect(итог.added).toBe(0);
    expect(итог.skipped).toBe(1);
    expect(телефон.get<{ n: number }>('SELECT COUNT(*) AS n FROM sale_items')?.n).toBe(0);
  });

/**
   * Первая встреча двух баз, заведённых порознь.
   *
   * Так и вышло на живой проверке: вошёл в магазин со второго устройства —
   * и обмен упал с «UNIQUE constraint failed: locations.name». Сервер
   * прислал свой «Чайный бар», а местный «Чайный бар» уже был, только с
   * другим общим именем. Это один и тот же магазин, и второй заводить
   * нельзя — местному проставляется имя с сервера.
   */
  it('узнаёт свою же точку, заведённую порознь, и не заводит вторую', () => {
    ensureLocation(телефон, 'Чайный бар');

    const итог = applyPull(телефон, {
      locations: [{ id: 'точка-с-сервера', name: 'Чайный бар', address: 'Гагарина 5' }],
    });

    expect(итог.added).toBe(0);
    expect(итог.updated).toBe(1);
    expect(телефон.get<{ n: number }>('SELECT COUNT(*) AS n FROM locations')?.n).toBe(1);

    const точка = телефон.get<{ uid: string; address: string }>(
      'SELECT uid, address FROM locations',
    );
    expect(точка?.uid).toBe('точка-с-сервера');
    expect(точка?.address).toBe('Гагарина 5');
  });

  /**
   * То же самое, но когда своё имя у точки уже есть.
   *
   * Так бывает, если оба устройства успели полежать в офлайне и завести
   * «Черёмушки» порознь. Своё имя менять нельзя — на него уже ссылаются наши
   * же чеки и сервер. Значит, чужое надо просто запомнить как второе.
   */
  it('чужое имя своей же точки запоминает, а вторую точку не заводит', () => {
    const точка = ensureLocation(телефон, 'Чайный бар');
    телефон.run('UPDATE locations SET uid = ? WHERE id = ?', ['наше-имя', точка]);
    const чай = заводимТовар(телефон, 'Габа Алишань', 10_000);
    телефон.run('UPDATE products SET uid = ? WHERE id = ?', ['товар-1', чай]);

    const итог = applyPull(телефон, {
      locations: [{ id: 'чужое-имя', name: 'Чайный бар' }],
      sales: [
        {
          id: 'чек-1',
          total: 10_000,
          payment: 'cash',
          created_at: '2026-09-03T10:00:00.000Z',
          location_id: 'чужое-имя',
        },
      ],
    });

    expect(итог.skipped).toBe(0);
    expect(телефон.get<{ n: number }>('SELECT COUNT(*) AS n FROM locations')?.n).toBe(1);
    // Своё имя осталось прежним…
    expect(телефон.get<{ uid: string }>('SELECT uid FROM locations')?.uid).toBe('наше-имя');
    // …а чек, пришедший под чужим, лёг на ту же точку, а не повис.
    expect(телефон.get<{ location_id: number }>('SELECT location_id FROM sales')?.location_id).toBe(
      точка,
    );
  });

  it('чужую точку с другим названием заводит как новую', () => {
    ensureLocation(телефон, 'Чайный бар');

    applyPull(телефон, { locations: [{ id: 'точка-2', name: 'Черёмушки' }] });

    expect(телефон.get<{ n: number }>('SELECT COUNT(*) AS n FROM locations')?.n).toBe(2);
  });

  it('имена не повторяются', () => {
    const имена = new Set(Array.from({ length: 500 }, () => newUid()));
    expect(имена.size).toBe(500);
  });
});
