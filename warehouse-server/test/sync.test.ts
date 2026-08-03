import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import type { SqlDb } from '../src/db/driver.ts';
import { buildServer } from '../src/server.ts';
import { createTestDb } from './helpers.ts';

/** Ответ API в тестах разбирается вручную — заранее описывать его формы незачем. */
type JsonObject = Record<string, any>;

let db: SqlDb;
let app: FastifyInstance;
let ownerToken: string;
let sellerToken: string;
let locationId: string;

async function call(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  options: { token?: string; body?: unknown } = {},
) {
  const response = await app.inject({
    method,
    url,
    headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
    payload: options.body as object | undefined,
  });
  return { status: response.statusCode, body: response.json() as JsonObject };
}

before(async () => {
  db = await createTestDb();
  app = buildServer({ db });
  await app.ready();

  const registered = await call('POST', '/api/v1/auth/register', {
    body: { org_name: 'Waystea', name: 'Владелец', email: 'o@example.com', password: 'пароль12345' },
  });
  ownerToken = registered.body.token;
  locationId = (registered.body.location as { id: string }).id;

  await call('POST', '/api/v1/users', {
    token: ownerToken,
    body: { name: 'Продавец', email: 's@example.com', password: 'пароль12345', role: 'seller' },
  });
  const login = await call('POST', '/api/v1/auth/login', {
    body: { email: 's@example.com', password: 'пароль12345' },
  });
  sellerToken = login.body.token;
});

after(async () => {
  await app.close();
  await db.close();
});

const now = () => new Date().toISOString();

/** Товар, созданный «на телефоне»: идентификатор придумывает клиент. */
function offlineProduct(over: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    name: 'Шу пуэр',
    unit: 'кг',
    cost_price: 200_000,
    sale_price: 500_000,
    updated_at: now(),
    ...over,
  };
}

describe('push', () => {
  it('принимает товар, созданный офлайн', async () => {
    const product = offlineProduct();

    const response = await call('POST', '/api/v1/sync/push', {
      token: ownerToken,
      body: { products: [product] },
    });

    assert.equal(response.status, 200);
    assert.equal(Number(response.body.applied.products), 1);

    const saved = await call('GET', `/api/v1/products/${product.id}`, { token: ownerToken });
    assert.equal(saved.body.name, 'Шу пуэр');
  });

  it('повторная отправка того же чека не задваивает продажу', async () => {
    const product = offlineProduct();
    const saleId = randomUUID();

    const payload = {
      products: [product],
      sales: [
        {
          id: saleId,
          location_id: locationId,
          discount: 0,
          total: 500_000,
          cost_total: 200_000,
          payment: 'cash',
          created_at: now(),
        },
      ],
      sale_items: [
        {
          id: randomUUID(),
          sale_id: saleId,
          product_id: product.id,
          qty: 1000,
          price: 500_000,
          cost_price: 200_000,
        },
      ],
      stock_moves: [
        {
          id: randomUUID(),
          location_id: locationId,
          product_id: product.id,
          qty_delta: -1000,
          reason: 'sale',
          sale_id: saleId,
          price: 500_000,
          created_at: now(),
        },
      ],
    };

    const first = await call('POST', '/api/v1/sync/push', { token: ownerToken, body: payload });
    const second = await call('POST', '/api/v1/sync/push', { token: ownerToken, body: payload });

    assert.equal(Number(first.body.applied.sales), 1);
    assert.equal(Number(second.body.applied.sales), 0);

    const sales = await call('GET', '/api/v1/sales', { token: ownerToken });
    const matching = (sales.body as unknown as { id: string }[]).filter((s) => s.id === saleId);
    assert.equal(matching.length, 1);

    const stock = await call('GET', `/api/v1/products/${product.id}`, { token: ownerToken });
    assert.equal(Number(stock.body.stock), -1000);
  });

  it('принимает продажу, уводящую остаток в минус', async () => {
    // Продажа уже случилась: товар отдан, деньги взяты. Отклонить её —
    // значит потерять выручку из учёта.
    const product = offlineProduct();
    const saleId = randomUUID();

    const response = await call('POST', '/api/v1/sync/push', {
      token: ownerToken,
      body: {
        products: [product],
        sales: [
          {
            id: saleId,
            location_id: locationId,
            total: 500_000,
            cost_total: 200_000,
            created_at: now(),
          },
        ],
        stock_moves: [
          {
            id: randomUUID(),
            location_id: locationId,
            product_id: product.id,
            qty_delta: -3000,
            reason: 'sale',
            sale_id: saleId,
            created_at: now(),
          },
        ],
      },
    });

    assert.equal(response.status, 200);
    const saved = await call('GET', `/api/v1/products/${product.id}`, { token: ownerToken });
    assert.equal(Number(saved.body.stock), -3000);
  });

  it('более поздняя правка карточки побеждает', async () => {
    const product = offlineProduct({ name: 'Старое имя', updated_at: '2026-01-01T10:00:00Z' });
    await call('POST', '/api/v1/sync/push', { token: ownerToken, body: { products: [product] } });

    await call('POST', '/api/v1/sync/push', {
      token: ownerToken,
      body: { products: [{ ...product, name: 'Новое имя', updated_at: '2026-01-02T10:00:00Z' }] },
    });

    const saved = await call('GET', `/api/v1/products/${product.id}`, { token: ownerToken });
    assert.equal(saved.body.name, 'Новое имя');
  });

  it('более старая правка не перетирает свежую', async () => {
    const product = offlineProduct({ name: 'Свежее', updated_at: '2026-02-10T10:00:00Z' });
    await call('POST', '/api/v1/sync/push', { token: ownerToken, body: { products: [product] } });

    // Телефон был офлайн и присылает свою старую версию карточки.
    await call('POST', '/api/v1/sync/push', {
      token: ownerToken,
      body: { products: [{ ...product, name: 'Устаревшее', updated_at: '2026-02-01T10:00:00Z' }] },
    });

    const saved = await call('GET', `/api/v1/products/${product.id}`, { token: ownerToken });
    assert.equal(saved.body.name, 'Свежее');
  });

  it('игнорирует поля, которых клиенту менять нельзя', async () => {
    const product = offlineProduct();
    await call('POST', '/api/v1/sync/push', {
      token: ownerToken,
      // seq назначает сервер; чужой org_id не должен переносить товар в другую организацию.
      body: { products: [{ ...product, seq: 999_999, org_id: randomUUID() }] },
    });

    const saved = await call('GET', `/api/v1/products/${product.id}`, { token: ownerToken });
    assert.equal(saved.status, 200);
    assert.notEqual(Number(saved.body.seq), 999_999);
  });

  it('продавцу нельзя присылать правки каталога', async () => {
    const response = await call('POST', '/api/v1/sync/push', {
      token: sellerToken,
      body: { products: [offlineProduct()] },
    });

    assert.equal(response.status, 403);
  });

  it('продавцу можно присылать свои продажи', async () => {
    const product = offlineProduct();
    await call('POST', '/api/v1/sync/push', { token: ownerToken, body: { products: [product] } });

    const saleId = randomUUID();
    const response = await call('POST', '/api/v1/sync/push', {
      token: sellerToken,
      body: {
        sales: [
          { id: saleId, location_id: locationId, total: 100, cost_total: 0, created_at: now() },
        ],
        stock_moves: [
          {
            id: randomUUID(),
            location_id: locationId,
            product_id: product.id,
            qty_delta: -1,
            reason: 'sale',
            sale_id: saleId,
            created_at: now(),
          },
        ],
      },
    });

    assert.equal(response.status, 200);
    assert.equal(Number(response.body.applied.sales), 1);
  });
});

describe('pull', () => {
  it('с нуля отдаёт всё и двигает курсор', async () => {
    const response = await call('GET', '/api/v1/sync/pull?since=0', { token: ownerToken });

    assert.equal(response.status, 200);
    const changes = response.body.changes as unknown as Record<string, unknown[]>;
    assert.ok(changes.products.length > 0);
    assert.ok(changes.locations.length > 0);
    assert.ok(Number(response.body.cursor) > 0);
  });

  it('повторный запрос с курсором ничего нового не приносит', async () => {
    const first = await call('GET', '/api/v1/sync/pull?since=0', { token: ownerToken });
    const cursor = Number(first.body.cursor);

    const second = await call('GET', `/api/v1/sync/pull?since=${cursor}`, { token: ownerToken });
    const changes = second.body.changes as unknown as Record<string, unknown[]>;

    const total = Object.values(changes).reduce((sum, rows) => sum + rows.length, 0);
    assert.equal(total, 0);
    assert.equal(second.body.has_more, false);
  });

  it('отдаёт только то, что появилось после курсора', async () => {
    const before = await call('GET', '/api/v1/sync/pull?since=0', { token: ownerToken });
    const cursor = Number(before.body.cursor);

    const product = offlineProduct({ name: 'Новинка' });
    await call('POST', '/api/v1/sync/push', { token: ownerToken, body: { products: [product] } });

    const after = await call('GET', `/api/v1/sync/pull?since=${cursor}`, { token: ownerToken });
    const changes = after.body.changes as unknown as Record<string, { name?: string }[]>;

    assert.equal(changes.products.length, 1);
    assert.equal(changes.products[0].name, 'Новинка');
  });

  it('при упоре в лимит курсор не перепрыгивает непереданные строки', async () => {
    const base = await call('GET', '/api/v1/sync/pull?since=0', { token: ownerToken });
    const start = Number(base.body.cursor);

    // Пять товаров подряд, забираем по два за раз.
    const products = Array.from({ length: 5 }, (_, i) => offlineProduct({ name: `Партия ${i}` }));
    await call('POST', '/api/v1/sync/push', { token: ownerToken, body: { products } });

    const seen = new Set<string>();
    let cursor = start;
    let guard = 0;

    while (guard++ < 20) {
      const page = await call('GET', `/api/v1/sync/pull?since=${cursor}&limit=2`, {
        token: ownerToken,
      });
      const changes = page.body.changes as unknown as Record<string, { id: string }[]>;
      for (const item of changes.products) seen.add(item.id);

      cursor = Number(page.body.cursor);
      if (!page.body.has_more) break;
    }

    // Ни одна строка не потерялась между страницами.
    assert.equal(seen.size, 5);
  });

  it('продавец не получает закупочные цены', async () => {
    await call('POST', '/api/v1/sync/push', {
      token: ownerToken,
      body: { products: [offlineProduct({ name: 'Секретная цена' })] },
    });

    const response = await call('GET', '/api/v1/sync/pull?since=0', { token: sellerToken });
    const changes = response.body.changes as unknown as Record<string, Record<string, unknown>[]>;

    for (const product of changes.products) {
      assert.ok(!('cost_price' in product), 'закупочная цена не должна уезжать продавцу');
    }
    for (const sale of changes.sales) {
      assert.ok(!('cost_total' in sale));
    }
  });

  it('данные другой организации не видны', async () => {
    const other = await call('POST', '/api/v1/auth/register', {
      body: { org_name: 'Другой', name: 'Он', email: 'other@example.com', password: 'пароль12345' },
    });

    const response = await call('GET', '/api/v1/sync/pull?since=0', {
      token: other.body.token,
    });
    const changes = response.body.changes as unknown as Record<string, unknown[]>;

    // Только своя точка, созданная при регистрации.
    assert.equal(changes.products.length, 0);
    assert.equal(changes.locations.length, 1);
  });
});

describe('изоляция организаций при синхронизации', () => {
  it('нельзя привязать движение к чужой точке', async () => {
    const other = await call('POST', '/api/v1/auth/register', {
      body: { org_name: 'Чужой', name: 'Он', email: 'alien@example.com', password: 'пароль12345' },
    });
    const alienLocation = (other.body.location as unknown as { id: string }).id;

    const product = offlineProduct();
    await call('POST', '/api/v1/sync/push', { token: ownerToken, body: { products: [product] } });

    const response = await call('POST', '/api/v1/sync/push', {
      token: ownerToken,
      body: {
        stock_moves: [
          {
            id: randomUUID(),
            location_id: alienLocation,
            product_id: product.id,
            qty_delta: 1000,
            reason: 'receipt',
            created_at: now(),
          },
        ],
      },
    });

    assert.equal(response.status, 400);
  });

  it('товары и точки из той же посылки проверку проходят', async () => {
    const location = { id: randomUUID(), name: 'Новая точка', updated_at: now() };
    const product = offlineProduct();

    const response = await call('POST', '/api/v1/sync/push', {
      token: ownerToken,
      body: {
        locations: [location],
        products: [product],
        stock_moves: [
          {
            id: randomUUID(),
            location_id: location.id,
            product_id: product.id,
            qty_delta: 5000,
            reason: 'receipt',
            created_at: now(),
          },
        ],
      },
    });

    assert.equal(response.status, 200);
    assert.equal(Number(response.body.applied.stock_moves), 1);
  });
});
