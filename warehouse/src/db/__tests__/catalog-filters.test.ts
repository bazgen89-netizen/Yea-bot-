import type { SqlDriver } from '../driver';
import { createTestDriver } from '../testDriver';
import {
  createProduct,
  deleteFilter,
  getProduct,
  listProducts,
  listSavedFilters,
  presetCounts,
  saveFilter,
  updateProduct,
} from '../products';
import { createSale } from '../sales';
import { postDoc } from '../stock';

/**
 * Готовые фильтры каталога.
 *
 * «Сегодня» передаётся числом, а не берётся из календаря: иначе тест про
 * истёкший срок годности начал бы падать сам по себе в один прекрасный день.
 */
const TODAY = '2026-08-10';

let db: SqlDriver;

beforeEach(() => {
  db = createTestDriver();
});

function make(over: Partial<Parameters<typeof createProduct>[1]> = {}) {
  return createProduct(db, {
    name: 'Шу пуэр',
    sku: null,
    barcode: null,
    category_id: null,
    unit: 'кг',
    cost_price: 200000,
    sale_price: 500000,
    min_qty: 0,
    photo_uri: null,
    ...over,
  });
}

function receive(productId: number, qty: number) {
  postDoc(db, {
    type: 'receipt',
    lines: [{ product_id: productId, name: 'Шу пуэр', unit: 'кг', qty, price: 200000 }],
  });
}

/** Списание больше остатка — так на складе и заводится минус. */
function writeOff(productId: number, qty: number) {
  postDoc(db, {
    type: 'writeoff',
    lines: [{ product_id: productId, name: 'Шу пуэр', unit: 'кг', qty, price: 200000 }],
  });
}

describe('фильтры по остатку', () => {
  it('«нет в наличии» ловит и ноль, и минус', () => {
    make({ name: 'Без остатка' });
    const negative = make({ name: 'В минусе', barcode: '2' });
    const stocked = make({ name: 'На складе', barcode: '3' });

    // Минус на складе получается пересортицей: списали больше, чем приняли.
    writeOff(negative, 1000);
    receive(stocked, 5000);

    const names = listProducts(db, { presets: ['out_of_stock'], today: TODAY }).map((p) => p.name);
    expect(names).toEqual(['Без остатка', 'В минусе']);

    expect(
      listProducts(db, { presets: ['negative'], today: TODAY }).map((p) => p.name),
    ).toEqual(['В минусе']);

    expect(names).not.toContain('На складе');
  });

  it('«остаток меньше минимального» считает строго меньше', () => {
    const below = make({ name: 'Мало', min_qty: 5000 });
    const exactly = make({ name: 'Ровно', barcode: '2', min_qty: 5000 });
    receive(below, 4000);
    receive(exactly, 5000);


    expect(
      listProducts(db, { presets: ['below_min'], today: TODAY }).map((p) => p.name),
    ).toEqual(['Мало']);
  });
});

describe('фильтры по полям товара', () => {
  it('нулевая себестоимость и скидка', () => {
    make({ name: 'Даром достался', cost_price: 0 });
    make({ name: 'Со скидкой', barcode: '2', discount_bp: 1000 });
    make({ name: 'Обычный', barcode: '3' });

    expect(
      listProducts(db, { presets: ['zero_cost'], today: TODAY }).map((p) => p.name),
    ).toEqual(['Даром достался']);
    expect(
      listProducts(db, { presets: ['discounted'], today: TODAY }).map((p) => p.name),
    ).toEqual(['Со скидкой']);
  });

  it('срок годности: истёкший и истекающий за неделю — разные списки', () => {
    make({ name: 'Просрочен', expires_at: '2026-08-09' });
    make({ name: 'Истекает', barcode: '2', expires_at: '2026-08-15' });
    make({ name: 'Ещё долго', barcode: '3', expires_at: '2026-12-31' });
    make({ name: 'Без срока', barcode: '4' });

    expect(
      listProducts(db, { presets: ['expired'], today: TODAY }).map((p) => p.name),
    ).toEqual(['Просрочен']);
    expect(
      listProducts(db, { presets: ['expiring_7d'], today: TODAY }).map((p) => p.name),
    ).toEqual(['Истекает']);
  });

  it('«не продаются 3 месяца» пропускает то, что продавалось недавно', () => {
    const sold = make({ name: 'Продаётся' });
    make({ name: 'Лежит', barcode: '2' });
    receive(sold, 5000);
    createSale(db, {
      lines: [
        { product_id: sold, name: 'Продаётся', unit: 'кг', qty: 1000, price: 500000, cost_price: 200000, stock: 5000 },
      ],
      payment: 'cash',
    });

    // Сегодня считаем днём продажи: чек попал в окно трёх месяцев.
    const names = listProducts(db, {
      presets: ['not_sold_3m'],
      today: new Date().toISOString().slice(0, 10),
    }).map((p) => p.name);

    expect(names).toEqual(['Лежит']);
  });
});

describe('несколько фильтров сразу', () => {
  it('складываются по «и», а не по «или»', () => {
    const both = make({ name: 'И то и то', cost_price: 0 });
    make({ name: 'Только нулевая цена', barcode: '2', cost_price: 0 });
    writeOff(both, 1000);

    expect(
      listProducts(db, { presets: ['zero_cost', 'negative'], today: TODAY }).map((p) => p.name),
    ).toEqual(['И то и то']);
  });

  it('считает, сколько позиций под каждым фильтром', () => {
    make({ name: 'Пустой' });
    make({ name: 'Без себестоимости', barcode: '2', cost_price: 0 });

    const counts = presetCounts(db);
    expect(counts.out_of_stock).toBe(2);
    expect(counts.zero_cost).toBe(1);
    expect(counts.discounted).toBe(0);
  });
});

describe('свои наборы фильтров', () => {
  it('сохраняются, заменяются по имени и удаляются', () => {
    saveFilter(db, { name: 'Разобрать', presets: ['zero_cost'] });
    expect(listSavedFilters(db)).toEqual([{ name: 'Разобрать', presets: ['zero_cost'] }]);

    saveFilter(db, { name: 'Разобрать', presets: ['zero_cost', 'negative'] });
    expect(listSavedFilters(db)).toHaveLength(1);
    expect(listSavedFilters(db)[0].presets).toEqual(['zero_cost', 'negative']);

    deleteFilter(db, 'Разобрать');
    expect(listSavedFilters(db)).toEqual([]);
  });
});

describe('новые поля карточки', () => {
  it('сохраняются и читаются обратно', () => {
    const id = make({
      kind: 'service',
      code: '0001',
      vat_bp: 2000,
      expires_at: '2026-12-31',
      discount_bp: 500,
    });

    const product = getProduct(db, id)!;
    expect(product.kind).toBe('service');
    expect(product.code).toBe('0001');
    expect(product.vat_bp).toBe(2000);
    expect(product.expires_at).toBe('2026-12-31');
    expect(product.discount_bp).toBe(500);
  });

  it('без них товар заводится как обычный товар без НДС', () => {
    const product = getProduct(db, make())!;
    expect(product.kind).toBe('product');
    expect(product.vat_bp).toBeNull();
    expect(product.discount_bp).toBe(0);
  });

  it('правка не теряет поля, которых не касались', () => {
    const id = make({ code: '0001', vat_bp: 2000 });
    const before = getProduct(db, id)!;

    updateProduct(db, id, { ...before, name: 'Шу пуэр 2019' });

    const after = getProduct(db, id)!;
    expect(after.name).toBe('Шу пуэр 2019');
    expect(after.code).toBe('0001');
    expect(after.vat_bp).toBe(2000);
  });

  it('код товара ищется наравне с артикулом', () => {
    make({ code: '01444' });
    expect(listProducts(db, { search: '01444' })).toHaveLength(1);
  });

  it('вид отбирается отдельно', () => {
    make({ name: 'Товар' });
    make({ name: 'Услуга', barcode: '2', kind: 'service' });

    expect(listProducts(db, { kind: 'service' }).map((p) => p.name)).toEqual(['Услуга']);
  });
});
