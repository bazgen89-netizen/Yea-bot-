import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';

import type { SqlDb } from '../src/db/driver.ts';
import { lineTotal, saleTotals } from '../src/core/amounts.ts';
import {
  createLocation,
  createProduct,
  ensureCategory,
  findByBarcode,
  getProduct,
  listProducts,
  updateProduct,
} from '../src/core/catalog.ts';
import { ApiError } from '../src/core/errors.ts';
import { adjustStock, getStock, listDocs, listMoves, postDoc, stockByLocation } from '../src/core/stock.ts';
import { OutOfStockError, createSale, getSale, listSales, refundSale } from '../src/core/sales.ts';
import {
  dailySales,
  salesByLocation,
  salesSummary,
  stockValue,
  topProducts,
} from '../src/core/reports.ts';
import { createTestDb } from './helpers.ts';

const ALL_TIME = { from: '1970-01-01T00:00:00Z', to: '2999-01-01T00:00:00Z' };

let db: SqlDb;
let orgId: string;
let shopId: string;
let storageId: string;

beforeEach(async () => {
  db = await createTestDb();
  orgId = randomUUID();
  await db.query('INSERT INTO orgs (id, name) VALUES ($1, $2)', [orgId, 'Waystea']);

  shopId = (await createLocation(db, orgId, { name: 'Магазин' })).id;
  storageId = (await createLocation(db, orgId, { name: 'Склад' })).id;
});

async function addProduct(over: Record<string, unknown> = {}) {
  const product = await createProduct(db, orgId, {
    name: 'Шу пуэр',
    unit: 'кг',
    cost_price: 200_000,
    sale_price: 500_000,
    ...over,
  });
  return product.id;
}

async function receive(productId: string, qty: number, locationId = shopId, price = 200_000) {
  return postDoc(db, orgId, null, {
    type: 'receipt',
    location_id: locationId,
    lines: [{ product_id: productId, qty, price }],
  });
}

describe('арифметика', () => {
  it('считает вес по цене за килограмм', () => {
    assert.equal(lineTotal(100_000, 500), 50_000);
    assert.equal(lineTotal(10_000, 333), 3_330);
  });

  it('обрезает скидку по сумме чека', () => {
    const totals = saleTotals([{ product_id: 'x', qty: 1000, price: 50_000, cost_price: 20_000 }], 999_999);
    assert.equal(totals.discount, 50_000);
    assert.equal(totals.total, 0);
  });

  it('не вычитает скидку из себестоимости', () => {
    const totals = saleTotals([{ product_id: 'x', qty: 1000, price: 50_000, cost_price: 20_000 }], 10_000);
    assert.equal(totals.total, 40_000);
    assert.equal(totals.costTotal, 20_000);
    assert.equal(totals.profit, 20_000);
  });
});

describe('каталог', () => {
  it('создаёт товар с нулевым остатком', async () => {
    const id = await addProduct();
    const product = await getProduct(db, orgId, id);
    assert.equal(product.name, 'Шу пуэр');
    assert.equal(Number(product.stock), 0);
  });

  it('ищет по названию в любом регистре', async () => {
    await addProduct({ name: 'Улун Те Гуань Инь' });
    const found = await listProducts(db, orgId, { search: 'улун' });
    assert.equal(found.length, 1);
  });

  it('ищет по штрихкоду', async () => {
    await addProduct({ barcode: '4600000000001' });
    const product = await findByBarcode(db, orgId, '4600000000001');
    assert.equal(product?.name, 'Шу пуэр');
  });

  it('не даёт двум товарам один штрихкод', async () => {
    await addProduct({ barcode: '4600000000001' });
    await assert.rejects(
      () => addProduct({ barcode: '4600000000001' }),
      (error: unknown) => error instanceof ApiError && error.status === 409,
    );
  });

  it('очищает поле, когда передан null', async () => {
    const id = await addProduct({ sku: 'SH-01' });
    const updated = await updateProduct(db, orgId, id, { sku: null });
    assert.equal(updated.sku, null);
  });

  it('не трогает поля, которых нет в запросе', async () => {
    const id = await addProduct({ sku: 'SH-01' });
    const updated = await updateProduct(db, orgId, id, { name: 'Шу пуэр 2019' });
    assert.equal(updated.sku, 'SH-01');
    assert.equal(updated.name, 'Шу пуэр 2019');
  });

  it('прячет архивные товары из списка', async () => {
    const id = await addProduct();
    await updateProduct(db, orgId, id, { archived: true });

    assert.equal((await listProducts(db, orgId)).length, 0);
    assert.equal((await listProducts(db, orgId, { includeArchived: true })).length, 1);
  });

  it('создаёт категорию один раз', async () => {
    const first = await ensureCategory(db, orgId, 'Пуэр');
    const second = await ensureCategory(db, orgId, 'Пуэр');
    assert.equal(first.id, second.id);
  });

  it('фильтр «заканчивается» учитывает порог', async () => {
    const low = await addProduct({ name: 'Мало', min_qty: 2000 });
    const enough = await addProduct({ name: 'Хватает', min_qty: 1000 });
    await addProduct({ name: 'Без порога', min_qty: 0 });

    await receive(low, 1000);
    await receive(enough, 5000);

    const result = await listProducts(db, orgId, { lowStockOnly: true });
    assert.deepEqual(result.map((p) => p.id), [low]);
  });
});

describe('склад', () => {
  it('приход увеличивает остаток на своей точке', async () => {
    const id = await addProduct();
    await receive(id, 5000, shopId);

    assert.equal(await getStock(db, orgId, id, shopId), 5000);
    assert.equal(await getStock(db, orgId, id, storageId), 0);
    assert.equal(await getStock(db, orgId, id), 5000);
  });

  it('списание уменьшает остаток', async () => {
    const id = await addProduct();
    await receive(id, 5000);
    await postDoc(db, orgId, null, {
      type: 'writeoff',
      location_id: shopId,
      note: 'брак',
      lines: [{ product_id: id, qty: 1500 }],
    });

    assert.equal(await getStock(db, orgId, id, shopId), 3500);
  });

  it('приход по новой цене обновляет закупочную цену', async () => {
    const id = await addProduct({ cost_price: 200_000 });
    await receive(id, 1000, shopId, 250_000);

    const product = await getProduct(db, orgId, id);
    assert.equal(Number(product.cost_price), 250_000);
  });

  it('перемещение переносит остаток и не меняет общий', async () => {
    const id = await addProduct();
    await receive(id, 5000, storageId);

    await postDoc(db, orgId, null, {
      type: 'transfer',
      location_id: storageId,
      to_location_id: shopId,
      lines: [{ product_id: id, qty: 2000 }],
    });

    assert.equal(await getStock(db, orgId, id, storageId), 3000);
    assert.equal(await getStock(db, orgId, id, shopId), 2000);
    assert.equal(await getStock(db, orgId, id), 5000);
  });

  it('перемещение на ту же точку не проводится', async () => {
    const id = await addProduct();
    await assert.rejects(
      () =>
        postDoc(db, orgId, null, {
          type: 'transfer',
          location_id: shopId,
          to_location_id: shopId,
          lines: [{ product_id: id, qty: 1000 }],
        }),
      (error: unknown) => error instanceof ApiError && error.status === 400,
    );
  });

  it('документ без позиций не проводится', async () => {
    await assert.rejects(
      () => postDoc(db, orgId, null, { type: 'receipt', location_id: shopId, lines: [] }),
      (error: unknown) => error instanceof ApiError && error.status === 400,
    );
  });

  it('ошибка в позиции откатывает весь документ', async () => {
    const id = await addProduct();
    await assert.rejects(() =>
      postDoc(db, orgId, null, {
        type: 'receipt',
        location_id: shopId,
        lines: [
          { product_id: id, qty: 1000 },
          { product_id: id, qty: 0 },
        ],
      }),
    );

    assert.equal(await getStock(db, orgId, id, shopId), 0);
    assert.equal((await listDocs(db, orgId)).length, 0);
  });

  it('инвентаризация выставляет фактический остаток', async () => {
    const id = await addProduct();
    await receive(id, 5000);

    const { delta } = await adjustStock(db, orgId, null, {
      product_id: id,
      location_id: shopId,
      actual_qty: 4700,
    });

    assert.equal(delta, -300);
    assert.equal(await getStock(db, orgId, id, shopId), 4700);
  });

  it('инвентаризация без расхождения не пишет движений', async () => {
    const id = await addProduct();
    await receive(id, 5000);

    const { delta, doc } = await adjustStock(db, orgId, null, {
      product_id: id,
      location_id: shopId,
      actual_qty: 5000,
    });

    assert.equal(delta, 0);
    assert.equal(doc, null);
    assert.equal((await listMoves(db, orgId, { productId: id })).length, 1);
  });

  it('показывает остатки по точкам', async () => {
    const id = await addProduct();
    await receive(id, 3000, shopId);
    await receive(id, 7000, storageId);

    const rows = await stockByLocation(db, orgId, id);
    const byName = Object.fromEntries(rows.map((r) => [r.location_name, Number(r.stock)]));
    assert.deepEqual(byName, { 'Магазин': 3000, 'Склад': 7000 });
  });

  it('сумма документа не удваивается на перемещении', async () => {
    const id = await addProduct();
    await receive(id, 5000, storageId);

    await postDoc(db, orgId, null, {
      type: 'transfer',
      location_id: storageId,
      to_location_id: shopId,
      lines: [{ product_id: id, qty: 1000, price: 200_000 }],
    });

    const transfer = (await listDocs(db, orgId)).find((d) => d.type === 'transfer');
    assert.equal(Number(transfer?.amount), 200_000);
    assert.equal(Number(transfer?.positions), 1);
  });
});

describe('продажи', () => {
  async function stocked(qty = 10_000, locationId = shopId) {
    const id = await addProduct();
    await receive(id, qty, locationId);
    return id;
  }

  function line(productId: string, qty = 1000) {
    return { product_id: productId, qty, price: 500_000, cost_price: 200_000 };
  }

  it('списывает остаток и пишет чек', async () => {
    const id = await stocked();
    const sale = await createSale(db, orgId, null, {
      location_id: shopId,
      lines: [line(id, 500)],
    });

    assert.equal(await getStock(db, orgId, id, shopId), 9500);
    assert.equal(Number(sale.total), 250_000);
    assert.equal(Number(sale.cost_total), 100_000);
  });

  it('по умолчанию продаёт даже когда товара не хватает', async () => {
    const id = await stocked(1000, storageId);

    await createSale(db, orgId, null, { location_id: shopId, lines: [line(id)] });

    // Товар отдан и деньги взяты — чек проведён, а остаток ушёл в минус.
    assert.equal(await getStock(db, orgId, id, shopId), -1000);
    assert.equal((await listSales(db, orgId)).length, 1);
  });

  it('строгий режим не даёт продать больше, чем есть', async () => {
    await db.query('UPDATE orgs SET allow_negative_stock = false WHERE id = $1', [orgId]);
    const id = await stocked(1000, storageId);

    await assert.rejects(
      () => createSale(db, orgId, null, { location_id: shopId, lines: [line(id)] }),
      OutOfStockError,
    );
    assert.equal(await getStock(db, orgId, id, shopId), 0);
  });

  it('в строгом режиме складывает количество одного товара в двух строках', async () => {
    await db.query('UPDATE orgs SET allow_negative_stock = false WHERE id = $1', [orgId]);
    const id = await stocked(1500);

    // По отдельности каждая строка проходит, вместе — нет.
    await assert.rejects(
      () =>
        createSale(db, orgId, null, {
          location_id: shopId,
          lines: [line(id, 1000), line(id, 1000)],
        }),
      OutOfStockError,
    );
    assert.equal(await getStock(db, orgId, id, shopId), 1500);
  });

  it('повторная отправка того же чека не списывает дважды', async () => {
    const id = await stocked();
    const saleId = randomUUID();

    const first = await createSale(db, orgId, null, { id: saleId, location_id: shopId, lines: [line(id)] });
    const second = await createSale(db, orgId, null, { id: saleId, location_id: shopId, lines: [line(id)] });

    assert.equal(first.id, second.id);
    assert.equal(await getStock(db, orgId, id, shopId), 9000);
    assert.equal((await listSales(db, orgId)).length, 1);
  });

  it('в строгом режиме чек проводится целиком или никак', async () => {
    await db.query('UPDATE orgs SET allow_negative_stock = false WHERE id = $1', [orgId]);
    const enough = await stocked(10_000);
    const short = await stocked(100);

    await assert.rejects(
      () =>
        createSale(db, orgId, null, {
          location_id: shopId,
          lines: [line(enough), line(short, 5000)],
        }),
      OutOfStockError,
    );

    assert.equal(await getStock(db, orgId, enough, shopId), 10_000);
    assert.equal((await listSales(db, orgId)).length, 0);
  });

  it('возврат возвращает товар и обнуляет суммы', async () => {
    const id = await stocked();
    const sale = await createSale(db, orgId, null, { location_id: shopId, lines: [line(id)] });

    const refunded = await refundSale(db, orgId, null, sale.id);

    assert.equal(await getStock(db, orgId, id, shopId), 10_000);
    assert.equal(Number(refunded.total), 0);
    assert.ok(refunded.refunded_at);
  });

  it('повторный возврат запрещён', async () => {
    const id = await stocked();
    const sale = await createSale(db, orgId, null, { location_id: shopId, lines: [line(id)] });

    await refundSale(db, orgId, null, sale.id);
    await assert.rejects(
      () => refundSale(db, orgId, null, sale.id),
      (error: unknown) => error instanceof ApiError && error.status === 409,
    );
    assert.equal(await getStock(db, orgId, id, shopId), 10_000);
  });

  it('сохраняет позиции чека', async () => {
    const id = await stocked();
    const sale = await createSale(db, orgId, null, { location_id: shopId, lines: [line(id)] });

    const full = await getSale(db, orgId, sale.id);
    assert.equal(full.items.length, 1);
    assert.equal(full.items[0].name, 'Шу пуэр');
    assert.equal(full.location_name, 'Магазин');
  });
});

describe('отчёты', () => {
  async function sell(locationId: string, qty: number) {
    const id = await addProduct();
    await receive(id, qty * 2, locationId);
    await createSale(db, orgId, null, {
      location_id: locationId,
      lines: [{ product_id: id, qty, price: 500_000, cost_price: 200_000 }],
    });
    return id;
  }

  it('считает выручку, себестоимость и прибыль', async () => {
    await sell(shopId, 1000);

    const summary = await salesSummary(db, orgId, ALL_TIME);
    assert.equal(summary.revenue, 500_000);
    assert.equal(summary.cost, 200_000);
    assert.equal(summary.profit, 300_000);
    assert.equal(summary.receipts, 1);
    assert.equal(summary.averageReceipt, 500_000);
  });

  it('исключает возвращённые чеки', async () => {
    const id = await sell(shopId, 1000);
    const [sale] = await listSales(db, orgId);
    await refundSale(db, orgId, null, sale.id);
    assert.ok(id);

    const summary = await salesSummary(db, orgId, ALL_TIME);
    assert.equal(summary.receipts, 0);
    assert.equal(summary.revenue, 0);
  });

  it('фильтрует по точке', async () => {
    await sell(shopId, 1000);
    await sell(storageId, 2000);

    const shop = await salesSummary(db, orgId, ALL_TIME, shopId);
    assert.equal(shop.revenue, 500_000);

    const all = await salesSummary(db, orgId, ALL_TIME);
    assert.equal(all.revenue, 1_500_000);
  });

  it('разбивает выручку по точкам', async () => {
    await sell(shopId, 1000);
    await sell(storageId, 2000);

    const rows = await salesByLocation(db, orgId, ALL_TIME);
    const byName = Object.fromEntries(rows.map((r) => [r.location_name, Number(r.revenue)]));
    assert.deepEqual(byName, { 'Магазин': 500_000, 'Склад': 1_000_000 });
  });

  it('отсекает продажи вне периода', async () => {
    await sell(shopId, 1000);
    const past = { from: '2000-01-01T00:00:00Z', to: '2000-12-31T00:00:00Z' };
    assert.equal((await salesSummary(db, orgId, past)).receipts, 0);
  });

  it('сортирует топ товаров по выручке', async () => {
    const small = await addProduct({ name: 'Улун', cost_price: 100_000, sale_price: 300_000 });
    const big = await addProduct({ name: 'Шен пуэр' });
    await receive(small, 10_000);
    await receive(big, 10_000, shopId, 200_000);

    await createSale(db, orgId, null, {
      location_id: shopId,
      lines: [{ product_id: small, qty: 1000, price: 300_000, cost_price: 100_000 }],
    });
    await createSale(db, orgId, null, {
      location_id: shopId,
      lines: [{ product_id: big, qty: 2000, price: 500_000, cost_price: 200_000 }],
    });

    const top = await topProducts(db, orgId, ALL_TIME);
    assert.equal(top[0].name, 'Шен пуэр');
    assert.equal(Number(top[0].revenue), 1_000_000);
    assert.equal(Number(top[0].profit), 600_000);
  });

  it('считает стоимость склада', async () => {
    const id = await addProduct();
    await receive(id, 10_000, shopId, 200_000);

    const value = await stockValue(db, orgId);
    assert.equal(value.costValue, 2_000_000);
    assert.equal(value.retailValue, 5_000_000);
    assert.equal(value.positions, 1);
  });

  it('считает стоимость склада по одной точке', async () => {
    const id = await addProduct();
    await receive(id, 10_000, shopId, 200_000);

    assert.equal((await stockValue(db, orgId, storageId)).positions, 0);
    assert.equal((await stockValue(db, orgId, shopId)).positions, 1);
  });

  it('группирует продажи по дням', async () => {
    await sell(shopId, 1000);
    await sell(shopId, 1000);

    const days = await dailySales(db, orgId, ALL_TIME);
    assert.equal(days.length, 1);
    assert.equal(days[0].receipts, 2);
  });
});

describe('себестоимость и история', () => {
  it('себестоимость усредняется по приходам, а не прыгает за последней ценой', async () => {
    const id = await addProduct({ cost_price: 0 });

    // 100 кг по 200,00 ₽, затем 1 кг по 500,00 ₽.
    await receive(id, 100_000, shopId, 20_000);
    await receive(id, 1_000, shopId, 50_000);

    const product = await getProduct(db, orgId, id);
    // (100 × 200 + 1 × 500) / 101 ≈ 202,97 ₽ — а не 500 ₽.
    assert.equal(Number(product.cost_price), 20_297);
  });

  it('первый приход задаёт себестоимость целиком', async () => {
    const id = await addProduct({ cost_price: 0 });
    await receive(id, 5_000, shopId, 33_000);

    assert.equal(Number((await getProduct(db, orgId, id)).cost_price), 33_000);
  });

  it('цена закупки — всегда последняя, в отличие от себестоимости', async () => {
    const id = await addProduct({ cost_price: 0 });
    await receive(id, 100_000, shopId, 20_000);
    await receive(id, 1_000, shopId, 50_000);

    const row = await db.one<{ purchase_price: number; cost_price: number }>(
      'SELECT purchase_price, cost_price FROM products WHERE id = $1',
      [id],
    );
    assert.equal(Number(row?.purchase_price), 50_000);
    assert.notEqual(Number(row?.cost_price), 50_000);
  });

  it('в истории у каждой операции есть остаток после неё', async () => {
    const id = await addProduct();
    await receive(id, 10_000);
    await createSale(db, orgId, null, {
      location_id: shopId,
      lines: [{ product_id: id, qty: 3_000, price: 500_000 }],
    });
    await postDoc(db, orgId, null, {
      type: 'writeoff',
      location_id: shopId,
      lines: [{ product_id: id, qty: 1_000 }],
    });

    const moves = await listMoves(db, orgId, { productId: id });
    // Свежие сверху: списание 6 000, продажа 7 000, приход 10 000.
    assert.deepEqual(
      moves.map((m) => Number(m.balance_after)),
      [6_000, 7_000, 10_000],
    );
  });

  it('остаток после операции считается по своей точке', async () => {
    const id = await addProduct();
    await receive(id, 4_000, shopId);
    await receive(id, 9_000, storageId);

    const shopMoves = await listMoves(db, orgId, { productId: id, locationId: shopId });
    assert.equal(Number(shopMoves[0].balance_after), 4_000);

    const storageMoves = await listMoves(db, orgId, { productId: id, locationId: storageId });
    assert.equal(Number(storageMoves[0].balance_after), 9_000);
  });
});
