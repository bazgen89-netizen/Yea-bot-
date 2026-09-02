import { createTestDriver } from '../testDriver';
import type { SqlDriver } from '../driver';
import { ensureLocation } from '../locations';
import { createProduct } from '../products';
import { createSale } from '../sales';
import { postDoc, productMoveOptions, productMoves, productMovesCount } from '../stock';

/**
 * Движение товара по одному товару — вкладка «История движения».
 *
 * Она отвечает на единственный вопрос: откуда у товара нынешний остаток. А
 * значит, главное в ней — колонка «Остаток»: после каждой строки должно
 * стоять то число, которое было на складе сразу после этого движения. Если
 * оно врёт, вся вкладка бесполезна — по ней перестают проверять.
 */
describe('история движения товара', () => {
  let db: SqlDriver;
  let store: number;
  let other: number;
  let tea: number;

  beforeEach(() => {
    db = createTestDriver();
    store = ensureLocation(db, 'Чайный бар');
    other = ensureLocation(db, 'Черёмушки');

    tea = createProduct(db, {
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

  /** Закупка десяти, продажа двух, закупка ещё пяти. */
  const threeMoves = () => {
    postDoc(db, {
      type: 'purchase',
      counterparty: 'Чайная лавка',
      locationId: store,
      lines: [{ product_id: tea, name: 'Габа Алишань', unit: 'гр', qty: 10_000, price: 3_000 }],
    });

    createSale(db, {
      lines: [
        {
          product_id: tea,
          name: 'Габа Алишань',
          qty: 2_000,
          price: 10_000,
          cost_price: 3_000,
          unit: 'гр',
          stock: 0,
        },
      ],
      locationId: store,
      payment: 'cash',
      allowNegative: true,
    });

    postDoc(db, {
      type: 'purchase',
      counterparty: 'Чайная лавка',
      locationId: store,
      lines: [{ product_id: tea, name: 'Габа Алишань', unit: 'гр', qty: 5_000, price: 3_200 }],
    });
  };

  it('остаток после каждого движения — тот, что был на складе в тот момент', () => {
    threeMoves();

    // Строки идут от свежих к старым, как у него.
    const moves = productMoves(db, tea);
    expect(moves.map((move) => move.qty_after)).toEqual([13_000, 8_000, 10_000]);
    expect(moves.map((move) => move.qty_delta)).toEqual([5_000, -2_000, 10_000]);
  });

  it('подписывает строку видом документа и его номером', () => {
    threeMoves();
    const moves = productMoves(db, tea);

    expect(moves[0].kind).toBe('purchase');
    expect(moves[1].kind).toBe('sale');
    // У чека свой номер — по нему его ищут, а не по внутреннему.
    expect(moves[1].number).not.toBeNull();
    expect(moves[1].sale_id).not.toBeNull();
    expect(moves[0].doc_id).not.toBeNull();
  });

  it('себестоимость берётся из строки чека, у складского документа её нет', () => {
    threeMoves();
    const moves = productMoves(db, tea);

    expect(moves[1].cost).toBe(3_000);
    // Подставлять сюда нынешнюю себестоимость из карточки нельзя: к тому дню
    // она отношения не имеет.
    expect(moves[0].cost).toBeNull();
  });

  it('листается по двадцать строк, и всего их столько, сколько есть', () => {
    threeMoves();

    expect(productMovesCount(db, tea)).toBe(3);
    expect(productMoves(db, tea, {}, 2)).toHaveLength(2);
    expect(productMoves(db, tea, {}, 2, 2)).toHaveLength(1);
  });

  it('отбирает по виду документа и по магазину', () => {
    threeMoves();
    postDoc(db, {
      type: 'purchase',
      counterparty: 'Чайная лавка',
      locationId: other,
      lines: [{ product_id: tea, name: 'Габа Алишань', unit: 'гр', qty: 1_000, price: 3_000 }],
    });

    expect(productMoves(db, tea, { kind: 'sale' })).toHaveLength(1);
    expect(productMovesCount(db, tea, { kind: 'purchase' })).toBe(3);
    expect(productMoves(db, tea, { location: 'Черёмушки' })).toHaveLength(1);
  });

  it('остаток по магазину считается по этому магазину, а не по всем', () => {
    threeMoves();
    postDoc(db, {
      type: 'purchase',
      counterparty: 'Чайная лавка',
      locationId: other,
      lines: [{ product_id: tea, name: 'Габа Алишань', unit: 'гр', qty: 1_000, price: 3_000 }],
    });

    // По всем магазинам после последней закупки лежит 14 000…
    expect(productMoves(db, tea)[0].qty_after).toBe(14_000);
    // …а в Черёмушках — только тысяча, и подписывать её четырнадцатью нельзя.
    expect(productMoves(db, tea, { location: 'Черёмушки' })[0].qty_after).toBe(1_000);
  });

  it('в отборе предлагает те магазины, где товар двигался', () => {
    threeMoves();
    const options = productMoveOptions(db, tea);

    expect(options.locations).toEqual(['Чайный бар']);
  });
});
