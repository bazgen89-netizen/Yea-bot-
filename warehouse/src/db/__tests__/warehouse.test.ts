import type { SqlDriver } from '../driver';
import { createTestDriver } from '../testDriver';
import {
  archiveProduct,
  createProduct,
  ensureCategory,
  findByBarcode,
  getProduct,
  listProducts,
} from '../products';
import { adjustStock, getStock, listDocs, listMoves, postDoc } from '../stock';
import { OutOfStockError, createSale, getSale, listSales, refundSale } from '../sales';
import { dailySales, periodFor, salesSummary, stockValue, topProducts } from '../reports';
import type { CartLine, DocLine } from '../../domain/types';

const ALL_TIME = { from: '1970-01-01T00:00:00.000Z', to: '2999-01-01T00:00:00.000Z' };

let db: SqlDriver;

beforeEach(() => {
  db = createTestDriver();
});

function makeProduct(over: Partial<Parameters<typeof createProduct>[1]> = {}) {
  return createProduct(db, {
    name: 'Шу пуэр',
    sku: null,
    barcode: null,
    category_id: null,
    unit: 'кг',
    cost_price: 200000, // 2000,00 ₽/кг
    sale_price: 500000, // 5000,00 ₽/кг
    min_qty: 0,
    photo_uri: null,
    ...over,
  });
}

function docLine(productId: number, qty: number, price = 200000): DocLine {
  return { product_id: productId, name: 'Шу пуэр', unit: 'кг', qty, price };
}

function cartLine(productId: number, over: Partial<CartLine> = {}): CartLine {
  return {
    product_id: productId,
    name: 'Шу пуэр',
    unit: 'кг',
    qty: 1000,
    price: 500000,
    cost_price: 200000,
    stock: 0,
    ...over,
  };
}

describe('товары', () => {
  it('создаются и читаются с нулевым остатком', () => {
    const id = makeProduct();
    const product = getProduct(db, id);
    expect(product?.name).toBe('Шу пуэр');
    expect(product?.stock).toBe(0);
  });

  it('пустые строки сохраняются как NULL, а не как ""', () => {
    const id = makeProduct({ sku: '  ', barcode: '' });
    const product = getProduct(db, id);
    expect(product?.sku).toBeNull();
    expect(product?.barcode).toBeNull();
  });

  it('ищутся по названию, артикулу и штрихкоду', () => {
    makeProduct({ name: 'Шен пуэр', sku: 'SH-01', barcode: '4600000000001' });
    makeProduct({ name: 'Улун', sku: 'UL-01', barcode: '4600000000002' });

    expect(listProducts(db, { search: 'улун' })).toHaveLength(1);
    expect(listProducts(db, { search: 'SH-01' })).toHaveLength(1);
    expect(listProducts(db, { search: '4600000000002' })[0].name).toBe('Улун');
  });

  it('находятся по штрихкоду для сканера', () => {
    makeProduct({ barcode: '4600000000001' });
    expect(findByBarcode(db, '4600000000001')?.name).toBe('Шу пуэр');
    expect(findByBarcode(db, 'нет такого')).toBeNull();
  });

  it('штрихкод уникален', () => {
    makeProduct({ barcode: '4600000000001' });
    expect(() => makeProduct({ barcode: '4600000000001' })).toThrow();
  });

  it('архивные скрыты из списка, но доступны по id', () => {
    const id = makeProduct();
    archiveProduct(db, id);

    expect(listProducts(db)).toHaveLength(0);
    expect(listProducts(db, { includeArchived: true })).toHaveLength(1);
    expect(getProduct(db, id)).not.toBeNull();
  });

  it('фильтр «заканчивается» учитывает порог', () => {
    const low = makeProduct({ name: 'Заканчивается', min_qty: 2000 });
    const ok = makeProduct({ name: 'Хватает', min_qty: 1000 });
    const noThreshold = makeProduct({ name: 'Без порога', min_qty: 0 });

    postDoc(db, { type: 'receipt', lines: [docLine(low, 1000)] });
    postDoc(db, { type: 'receipt', lines: [docLine(ok, 5000)] });

    const result = listProducts(db, { lowStockOnly: true });
    expect(result.map((p) => p.id)).toEqual([low]);
    expect(result.map((p) => p.id)).not.toContain(noThreshold);
  });

  it('категория создаётся один раз', () => {
    const first = ensureCategory(db, 'Пуэр');
    const second = ensureCategory(db, 'Пуэр');
    expect(first).toBe(second);
  });
});

describe('приход и списание', () => {
  it('приход увеличивает остаток', () => {
    const id = makeProduct();
    postDoc(db, { type: 'receipt', counterparty: 'Поставщик', lines: [docLine(id, 5000)] });
    expect(getStock(db, id)).toBe(5000);
  });

  it('списание уменьшает остаток', () => {
    const id = makeProduct();
    postDoc(db, { type: 'receipt', lines: [docLine(id, 5000)] });
    postDoc(db, { type: 'writeoff', note: 'брак', lines: [docLine(id, 1500)] });
    expect(getStock(db, id)).toBe(3500);
  });

  it('приход по новой цене обновляет закупочную цену товара', () => {
    const id = makeProduct({ cost_price: 200000 });
    postDoc(db, { type: 'receipt', lines: [docLine(id, 1000, 250000)] });
    expect(getProduct(db, id)?.cost_price).toBe(250000);
  });

  it('документ без позиций не проводится', () => {
    expect(() => postDoc(db, { type: 'receipt', lines: [] })).toThrow(/без позиций/);
  });

  it('сбой на второй позиции откатывает весь документ', () => {
    const id = makeProduct();
    expect(() =>
      postDoc(db, { type: 'receipt', lines: [docLine(id, 1000), docLine(id, 0)] }),
    ).toThrow(/больше нуля/);

    expect(getStock(db, id)).toBe(0);
    expect(listDocs(db)).toHaveLength(0);
  });

  it('инвентаризация выставляет фактический остаток', () => {
    const id = makeProduct();
    postDoc(db, { type: 'receipt', lines: [docLine(id, 5000)] });

    const delta = adjustStock(db, id, 4700, 'пересчёт');
    expect(delta).toBe(-300);
    expect(getStock(db, id)).toBe(4700);
  });

  it('инвентаризация без расхождения не создаёт движений', () => {
    const id = makeProduct();
    postDoc(db, { type: 'receipt', lines: [docLine(id, 5000)] });

    expect(adjustStock(db, id, 5000)).toBe(0);
    expect(listMoves(db, id)).toHaveLength(1);
  });

  it('история движений сохраняет причину', () => {
    const id = makeProduct();
    postDoc(db, { type: 'receipt', counterparty: 'ООО Чай', lines: [docLine(id, 5000)] });
    postDoc(db, { type: 'writeoff', lines: [docLine(id, 1000)] });

    const moves = listMoves(db, id);
    expect(moves.map((m) => m.reason)).toEqual(['writeoff', 'receipt']);
    expect(moves[1].counterparty).toBe('ООО Чай');
  });
});

describe('продажи', () => {
  function stocked(qty = 10000) {
    const id = makeProduct();
    postDoc(db, { type: 'receipt', lines: [docLine(id, qty)] });
    return id;
  }

  it('продажа списывает остаток и пишет чек', () => {
    const id = stocked();
    const saleId = createSale(db, { lines: [cartLine(id, { qty: 500 })] });

    expect(getStock(db, id)).toBe(9500);

    const sale = getSale(db, saleId);
    expect(sale?.total).toBe(250000); // 0,5 кг × 5000,00
    expect(sale?.cost_total).toBe(100000);
    expect(sale?.items).toHaveLength(1);
  });

  it('скидка уменьшает итог чека', () => {
    const id = stocked();
    const saleId = createSale(db, { lines: [cartLine(id)], discount: 50000 });

    const sale = getSale(db, saleId);
    expect(sale?.discount).toBe(50000);
    expect(sale?.total).toBe(450000);
  });

  it('нельзя продать больше, чем есть', () => {
    const id = stocked(1000);
    expect(() => createSale(db, { lines: [cartLine(id, { qty: 2000 })] })).toThrow(OutOfStockError);
    expect(getStock(db, id)).toBe(1000);
  });

  it('остаток перепроверяется в момент оплаты, а не по данным корзины', () => {
    const id = stocked(1000);
    // Корзина «уверена», что на складе 9999, но в базе — 1000.
    expect(() => createSale(db, { lines: [cartLine(id, { qty: 2000, stock: 9999 })] })).toThrow(
      OutOfStockError,
    );
  });

  it('чек из нескольких позиций проводится целиком или никак', () => {
    const ok = stocked(10000);
    const short = stocked(100);

    expect(() =>
      createSale(db, { lines: [cartLine(ok, { qty: 1000 }), cartLine(short, { qty: 5000 })] }),
    ).toThrow(OutOfStockError);

    expect(getStock(db, ok)).toBe(10000);
    expect(listSales(db)).toHaveLength(0);
  });

  it('пустой чек не проводится', () => {
    expect(() => createSale(db, { lines: [] })).toThrow(/Пустой чек/);
  });

  it('возврат возвращает товар на склад', () => {
    const id = stocked();
    const saleId = createSale(db, { lines: [cartLine(id, { qty: 1000 })] });
    expect(getStock(db, id)).toBe(9000);

    refundSale(db, saleId);
    expect(getStock(db, id)).toBe(10000);
    expect(getSale(db, saleId)?.refunded).toBe(true);
  });

  it('повторный возврат по одному чеку запрещён', () => {
    const id = stocked();
    const saleId = createSale(db, { lines: [cartLine(id)] });

    refundSale(db, saleId);
    expect(() => refundSale(db, saleId)).toThrow(/уже оформлен/);
    expect(getStock(db, id)).toBe(10000);
  });
});

describe('отчёты', () => {
  function setup() {
    const puer = makeProduct({ name: 'Шу пуэр' });
    const oolong = makeProduct({ name: 'Улун', cost_price: 100000, sale_price: 300000 });

    postDoc(db, {
      type: 'receipt',
      lines: [docLine(puer, 10000), docLine(oolong, 10000, 100000)],
    });
    return { puer, oolong };
  }

  it('считает выручку, себестоимость и прибыль', () => {
    const { puer } = setup();
    createSale(db, { lines: [cartLine(puer, { qty: 1000 })] });

    const summary = salesSummary(db, ALL_TIME);
    expect(summary.revenue).toBe(500000);
    expect(summary.cost).toBe(200000);
    expect(summary.profit).toBe(300000);
    expect(summary.receipts).toBe(1);
    expect(summary.averageReceipt).toBe(500000);
  });

  it('средний чек считается по количеству чеков', () => {
    const { puer } = setup();
    createSale(db, { lines: [cartLine(puer, { qty: 1000 })] });
    createSale(db, { lines: [cartLine(puer, { qty: 2000 })] });

    expect(salesSummary(db, ALL_TIME).averageReceipt).toBe(750000);
  });

  it('возвращённые чеки исключаются из выручки и счётчика', () => {
    const { puer } = setup();
    const saleId = createSale(db, { lines: [cartLine(puer, { qty: 1000 })] });
    createSale(db, { lines: [cartLine(puer, { qty: 1000 })] });

    refundSale(db, saleId);

    const summary = salesSummary(db, ALL_TIME);
    expect(summary.receipts).toBe(1);
    expect(summary.revenue).toBe(500000);
  });

  it('период отсекает продажи за его границами', () => {
    const { puer } = setup();
    createSale(db, { lines: [cartLine(puer, { qty: 1000 })] });

    const past = { from: '2000-01-01T00:00:00.000Z', to: '2000-12-31T00:00:00.000Z' };
    expect(salesSummary(db, past).receipts).toBe(0);
    expect(salesSummary(db, periodFor('today')).receipts).toBe(1);
  });

  it('топ товаров сортируется по выручке', () => {
    const { puer, oolong } = setup();
    createSale(db, { lines: [cartLine(oolong, { qty: 1000, price: 300000, cost_price: 100000 })] });
    createSale(db, { lines: [cartLine(puer, { qty: 2000 })] });

    const top = topProducts(db, ALL_TIME);
    expect(top[0].name).toBe('Шу пуэр');
    expect(top[0].revenue).toBe(1000000);
    expect(top[0].profit).toBe(600000);
    expect(top[1].name).toBe('Улун');
  });

  it('стоимость склада считается по остаткам', () => {
    setup();
    const value = stockValue(db);
    // 10 кг × 2000,00 + 10 кг × 1000,00
    expect(value.costValue).toBe(3000000);
    expect(value.retailValue).toBe(8000000);
    expect(value.positions).toBe(2);
  });

  it('товары с нулевым остатком не попадают в стоимость склада', () => {
    makeProduct({ name: 'Нет на складе' });
    expect(stockValue(db).positions).toBe(0);
  });

  it('продажи по дням группируются по дате', () => {
    const { puer } = setup();
    createSale(db, { lines: [cartLine(puer, { qty: 1000 })] });
    createSale(db, { lines: [cartLine(puer, { qty: 1000 })] });

    const days = dailySales(db, ALL_TIME);
    expect(days).toHaveLength(1);
    expect(days[0].receipts).toBe(2);
    expect(days[0].revenue).toBe(1000000);
  });
});

describe('периоды', () => {
  it('«сегодня» начинается в полночь', () => {
    const now = new Date('2026-08-03T15:30:00');
    const period = periodFor('today', now);
    expect(new Date(period.from).getHours()).toBe(0);
    expect(new Date(period.to).getTime()).toBeGreaterThan(now.getTime());
  });

  it('«неделя» покрывает 7 дней вместе с сегодняшним', () => {
    const now = new Date('2026-08-03T12:00:00');
    const period = periodFor('week', now);
    expect(new Date(period.from).getDate()).toBe(28); // 3 августа минус 6 дней
  });
});
