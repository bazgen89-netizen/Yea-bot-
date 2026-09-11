import { createTestDriver } from '../testDriver';
import type { SqlDriver } from '../driver';
import { createCounterparty } from '../counterparties';
import { ensureLocation } from '../locations';
import { createProduct } from '../products';
import { periodFor, suppliersReport } from '../reports';
import { postDoc } from '../stock';

/**
 * Отчёт по поставщикам.
 *
 * У Вазгена он стоит кнопкой под «Отчётом по движению» и под «Отчётом по
 * покупателям», а в программе его не было вовсе — обе кнопки упирались в
 * пустоту.
 */
describe('отчёт по поставщикам', () => {
  let db: SqlDriver;
  let бар: number;
  let чай: number;

  beforeEach(() => {
    db = createTestDriver();
    бар = ensureLocation(db, 'Чайный бар');
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

  const поставка = (кто: string, сколько: number, цена: number) =>
    postDoc(db, {
      type: 'purchase',
      counterparty: кто,
      locationId: бар,
      lines: [{ product_id: чай, name: 'Габа Алишань', unit: 'гр', qty: сколько, price: цена }],
    });

  it('считает поставки и их сумму по движениям', () => {
    поставка('Чайная лавка', 10_000, 3_000);
    поставка('Чайная лавка', 5_000, 3_200);

    const [строка] = suppliersReport(db, periodFor('month'));

    expect(строка.name).toBe('Чайная лавка');
    expect(строка.docs).toBe(2);
    // 10 000 тысячных по 3 000 копеек — 300 рублей, плюс 5 000 по 3 200 — 160.
    expect(строка.amount).toBe(30_000 + 16_000);
  });

  it('возврат поставщику считается отдельно от поставки', () => {
    поставка('Чайная лавка', 10_000, 3_000);
    postDoc(db, {
      type: 'purchase_return',
      counterparty: 'Чайная лавка',
      locationId: бар,
      lines: [{ product_id: чай, name: 'Габа Алишань', unit: 'гр', qty: 2_000, price: 3_000 }],
    });

    const [строка] = suppliersReport(db, periodFor('month'));

    expect(строка.docs).toBe(1);
    expect(строка.amount).toBe(30_000);
    expect(строка.returns).toBe(1);
    expect(строка.returnsSum).toBe(6_000);
  });

  it('тот, у кого за период ничего не было, в отчёт не попадает', () => {
    createCounterparty(db, { name: 'Молчаливый поставщик', kind: 'supplier' });
    поставка('Чайная лавка', 1_000, 3_000);

    expect(suppliersReport(db, periodFor('month')).map((о) => о.name)).toEqual(['Чайная лавка']);
  });

  it('отбирается по магазину', () => {
    const черёмушки = ensureLocation(db, 'Черёмушки');
    поставка('Чайная лавка', 10_000, 3_000);
    postDoc(db, {
      type: 'purchase',
      counterparty: 'Другая лавка',
      locationId: черёмушки,
      lines: [{ product_id: чай, name: 'Габа Алишань', unit: 'гр', qty: 1_000, price: 3_000 }],
    });

    expect(suppliersReport(db, periodFor('month'), { место: бар }).map((о) => о.name)).toEqual([
      'Чайная лавка',
    ]);
  });
});
