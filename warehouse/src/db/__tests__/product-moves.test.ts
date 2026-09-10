import { createTestDriver } from '../testDriver';
import type { SqlDriver } from '../driver';
import { ensureLocation } from '../locations';
import { createProduct } from '../products';
import { createSale } from '../sales';
import { postDoc, productMoveOptions, productMoves, productMovesCount, getStock, stockByLocation} from '../stock';

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

/**
 * Остаток по магазинам — как в карточке товара CloudShop.
 *
 * Вазген прислал снимок: под ценами идёт «Склад», в нём строка на каждый
 * магазин с остатком, а внизу «Всего». Магазинов, где товара нет, там не
 * видно.
 */
describe('остаток по магазинам', () => {
  let db: SqlDriver;

  const товарС = (name: string) =>
    createProduct(db, {
      name,
      sku: null,
      barcode: null,
      category_id: null,
      unit: 'шт',
      cost_price: 3_750,
      sale_price: 130_000,
      min_qty: 0,
      photo_uri: null,
    });

  beforeEach(() => {
    db = createTestDriver();
  });

  it('складывает движения каждого магазина и не показывает пустые', () => {
    const товар = товарС('Сяо Чжун плитка');
    const черёмушки = ensureLocation(db, 'Черёмушки');
    const рынок = ensureLocation(db, 'WAYSTEA / Рынок на Студеной');
    const бар = ensureLocation(db, 'Чайный бар');

    const приход = (место: number, сколько: number) =>
      postDoc(db, {
        type: 'receipt',
        locationId: место,
        lines: [{ product_id: товар, name: 'Сяо Чжун плитка', unit: 'шт', qty: сколько, price: 30000 }],
      });

    приход(черёмушки, 3000);
    приход(рынок, 5000);
    // В баре приняли и тут же вернули — остаток ноль, в списке его быть не должно.
    приход(бар, 2000);
    postDoc(db, {
      type: 'writeoff',
      locationId: бар,
      lines: [{ product_id: товар, name: 'Сяо Чжун плитка', unit: 'шт', qty: 2000, price: 30000 }],
    });

    const по = stockByLocation(db, товар);
    expect(по.map((one) => [one.name, one.qty])).toEqual([
      ['WAYSTEA / Рынок на Студеной', 5000],
      ['Черёмушки', 3000],
    ]);

    // Всего сходится с общим остатком: иначе строка «Всего» противоречила бы
    // тому, что под ней.
    expect(по.reduce((sum, one) => sum + one.qty, 0)).toBe(getStock(db, товар));
  });

  it('у товара без движений список пуст', () => {
    const товар = товарС('Ничего не было');
    expect(stockByLocation(db, товар)).toEqual([]);
  });
});
