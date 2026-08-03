import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import type { SqlDb } from '../src/db/driver.ts';
import { buildServer } from '../src/server.ts';
import { createTestDb } from './helpers.ts';

/** Ответ API в тестах разбирается вручную — заранее описывать его формы незачем. */
type JsonObject = Record<string, any>;

let db: SqlDb;
let app: FastifyInstance;

/** Владелец, продавец и их точка — общий контекст для всех проверок ниже. */
let ownerToken: string;
let sellerToken: string;
let locationId: string;

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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
    body: {
      org_name: 'Waystea',
      name: 'Владелец',
      email: 'owner@example.com',
      password: 'пароль12345',
    },
  });
  assert.equal(registered.status, 201);
  ownerToken = registered.body.token;
  locationId = (registered.body.location as { id: string }).id;

  await call('POST', '/api/v1/users', {
    token: ownerToken,
    body: {
      name: 'Продавец',
      email: 'seller@example.com',
      password: 'пароль12345',
      role: 'seller',
    },
  });

  const login = await call('POST', '/api/v1/auth/login', {
    body: { email: 'seller@example.com', password: 'пароль12345' },
  });
  sellerToken = login.body.token;
});

after(async () => {
  await app.close();
  await db.close();
});

async function makeProduct(over: Record<string, unknown> = {}) {
  const response = await call('POST', '/api/v1/products', {
    token: ownerToken,
    body: {
      name: 'Шу пуэр',
      unit: 'кг',
      cost_price: 200_000,
      sale_price: 500_000,
      ...over,
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.id as unknown as string;
}

async function receive(productId: string, qty: number) {
  return call('POST', '/api/v1/docs', {
    token: ownerToken,
    body: {
      type: 'receipt',
      location_id: locationId,
      lines: [{ product_id: productId, qty, price: 200_000 }],
    },
  });
}

describe('доступ', () => {
  it('без токена не пускает', async () => {
    const response = await call('GET', '/api/v1/products');
    assert.equal(response.status, 401);
  });

  it('с чужим токеном не пускает', async () => {
    const response = await call('GET', '/api/v1/products', { token: 'что-угодно' });
    assert.equal(response.status, 401);
  });

  it('health отвечает без токена', async () => {
    const response = await call('GET', '/health');
    assert.equal(response.status, 200);
  });

  it('регистрация со слабым паролем отклоняется', async () => {
    const response = await call('POST', '/api/v1/auth/register', {
      body: { org_name: 'X', name: 'X', email: 'weak@example.com', password: '123' },
    });
    assert.equal(response.status, 400);
  });

  it('вход с неверным паролем не выдаёт токен', async () => {
    const response = await call('POST', '/api/v1/auth/login', {
      body: { email: 'owner@example.com', password: 'неверный пароль' },
    });
    assert.equal(response.status, 401);
  });

  it('выход отзывает токен', async () => {
    const login = await call('POST', '/api/v1/auth/login', {
      body: { email: 'seller@example.com', password: 'пароль12345' },
    });
    const token = login.body.token as unknown as string;

    assert.equal((await call('GET', '/api/v1/products', { token })).status, 200);
    await call('POST', '/api/v1/auth/logout', { token });
    assert.equal((await call('GET', '/api/v1/products', { token })).status, 401);
  });
});

describe('права продавца', () => {
  it('не может заводить товары', async () => {
    const response = await call('POST', '/api/v1/products', {
      token: sellerToken,
      body: { name: 'Свой товар' },
    });
    assert.equal(response.status, 403);
  });

  it('не может оформлять приход', async () => {
    const id = await makeProduct();
    const response = await call('POST', '/api/v1/docs', {
      token: sellerToken,
      body: {
        type: 'receipt',
        location_id: locationId,
        lines: [{ product_id: id, qty: 1000, price: 100 }],
      },
    });
    assert.equal(response.status, 403);
  });

  it('не видит отчётов', async () => {
    const response = await call(
      'GET',
      `/api/v1/reports/summary?from=1970-01-01T00:00:00Z&to=2999-01-01T00:00:00Z`,
      { token: sellerToken },
    );
    assert.equal(response.status, 403);
  });

  it('не видит закупочную цену в списке товаров', async () => {
    await makeProduct({ name: 'Улун' });

    const asOwner = await call('GET', '/api/v1/products', { token: ownerToken });
    const asSeller = await call('GET', '/api/v1/products', { token: sellerToken });

    const ownerRow = (asOwner.body as unknown as Record<string, unknown>[])[0];
    const sellerRow = (asSeller.body as unknown as Record<string, unknown>[])[0];

    assert.ok('cost_price' in ownerRow);
    assert.ok(!('cost_price' in sellerRow));
    // Цена продажи и остаток продавцу нужны — их прятать нельзя.
    assert.ok('sale_price' in sellerRow);
    assert.ok('stock' in sellerRow);
  });

  it('не видит закупочную цену в истории движений', async () => {
    const id = await makeProduct();
    await receive(id, 5000);

    const response = await call('GET', `/api/v1/products/${id}/moves`, { token: sellerToken });
    const move = (response.body as unknown as Record<string, unknown>[])[0];
    assert.ok(!('price' in move));
  });

  it('может продавать и не видит себестоимость в чеке', async () => {
    const id = await makeProduct();
    await receive(id, 5000);

    const sale = await call('POST', '/api/v1/sales', {
      token: sellerToken,
      body: {
        location_id: locationId,
        lines: [{ product_id: id, qty: 1000, price: 500_000, cost_price: 200_000 }],
      },
    });

    assert.equal(sale.status, 201);
    assert.equal(Number(sale.body.total), 500_000);
    assert.ok(!('cost_total' in sale.body));

    const asOwner = await call('GET', `/api/v1/sales/${sale.body.id}`, { token: ownerToken });
    assert.equal(Number(asOwner.body.cost_total), 200_000);
  });
});

describe('товары и склад', () => {
  it('заводит товар и находит по штрихкоду', async () => {
    await makeProduct({ name: 'Шен пуэр', barcode: '4600000000777' });

    const response = await call('GET', '/api/v1/products/by-barcode/4600000000777', {
      token: ownerToken,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.name, 'Шен пуэр');
  });

  it('отвечает 404 на неизвестный штрихкод', async () => {
    const response = await call('GET', '/api/v1/products/by-barcode/000', { token: ownerToken });
    assert.equal(response.status, 404);
  });

  it('отклоняет дубль штрихкода с понятной ошибкой', async () => {
    await makeProduct({ barcode: '4600000000888' });
    const response = await call('POST', '/api/v1/products', {
      token: ownerToken,
      body: { name: 'Дубль', barcode: '4600000000888' },
    });

    assert.equal(response.status, 409);
    assert.match(String((response.body.error as { message: string }).message), /штрихкод/i);
  });

  it('приход поднимает остаток', async () => {
    const id = await makeProduct();
    assert.equal((await receive(id, 5000)).status, 201);

    const product = await call('GET', `/api/v1/products/${id}`, { token: ownerToken });
    assert.equal(Number(product.body.stock), 5000);
  });

  it('перемещает товар между точками', async () => {
    const second = await call('POST', '/api/v1/locations', {
      token: ownerToken,
      body: { name: 'Вторая точка' },
    });
    const id = await makeProduct();
    await receive(id, 5000);

    const moved = await call('POST', '/api/v1/docs', {
      token: ownerToken,
      body: {
        type: 'transfer',
        location_id: locationId,
        to_location_id: second.body.id,
        lines: [{ product_id: id, qty: 2000 }],
      },
    });
    assert.equal(moved.status, 201);

    const byLocation = await call('GET', `/api/v1/products/${id}/stock`, { token: ownerToken });
    const rows = byLocation.body as unknown as { location_name: string; stock: number }[];
    const map = Object.fromEntries(rows.map((r) => [r.location_name, Number(r.stock)]));
    assert.equal(map['Вторая точка'], 2000);
    assert.equal(map['Основная точка'], 3000);
  });

  it('инвентаризация выравнивает остаток', async () => {
    const id = await makeProduct();
    await receive(id, 5000);

    const response = await call('POST', '/api/v1/docs/adjust', {
      token: ownerToken,
      body: { product_id: id, location_id: locationId, actual_qty: 4800 },
    });

    assert.equal(response.status, 201);
    assert.equal(Number(response.body.delta), -200);
  });

  it('не проводит документ с нулевым количеством', async () => {
    const id = await makeProduct();
    const response = await call('POST', '/api/v1/docs', {
      token: ownerToken,
      body: { type: 'receipt', location_id: locationId, lines: [{ product_id: id, qty: 0 }] },
    });
    assert.equal(response.status, 400);
  });
});

describe('продажи', () => {
  it('возвращает 409 и список нехватки', async () => {
    const id = await makeProduct();
    await receive(id, 1000);

    const response = await call('POST', '/api/v1/sales', {
      token: ownerToken,
      body: {
        location_id: locationId,
        lines: [{ product_id: id, qty: 5000, price: 500_000, cost_price: 200_000 }],
      },
    });

    assert.equal(response.status, 409);
    const error = response.body.error as unknown as { code: string; details: unknown[] };
    assert.equal(error.code, 'out_of_stock');
    assert.equal(error.details.length, 1);
  });

  it('оформляет возврат один раз', async () => {
    const id = await makeProduct();
    await receive(id, 5000);

    const sale = await call('POST', '/api/v1/sales', {
      token: ownerToken,
      body: {
        location_id: locationId,
        lines: [{ product_id: id, qty: 1000, price: 500_000, cost_price: 200_000 }],
      },
    });

    const first = await call('POST', `/api/v1/sales/${sale.body.id}/refund`, { token: ownerToken });
    assert.equal(first.status, 200);

    const second = await call('POST', `/api/v1/sales/${sale.body.id}/refund`, { token: ownerToken });
    assert.equal(second.status, 409);
  });
});

describe('ключи интеграций', () => {
  it('ключ на чтение работает, но не даёт писать', async () => {
    const created = await call('POST', '/api/v1/api-keys', {
      token: ownerToken,
      body: { name: 'Сайт', scopes: ['read'] },
    });
    assert.equal(created.status, 201);

    const key = created.body.key as unknown as string;
    assert.ok(key.startsWith('whk_'));

    assert.equal((await call('GET', '/api/v1/products', { token: key })).status, 200);

    const write = await call('POST', '/api/v1/products', {
      token: key,
      body: { name: 'Через ключ' },
    });
    assert.equal(write.status, 403);
  });

  it('ключ на запись может заводить товары', async () => {
    const created = await call('POST', '/api/v1/api-keys', {
      token: ownerToken,
      body: { name: '1С', scopes: ['read', 'write'] },
    });

    const response = await call('POST', '/api/v1/products', {
      token: created.body.key as unknown as string,
      body: { name: 'Из 1С' },
    });
    assert.equal(response.status, 201);
  });

  it('отозванный ключ перестаёт работать', async () => {
    const created = await call('POST', '/api/v1/api-keys', {
      token: ownerToken,
      body: { name: 'Временный', scopes: ['read'] },
    });
    const key = created.body.key as unknown as string;

    await call('DELETE', `/api/v1/api-keys/${created.body.id}`, { token: ownerToken });
    assert.equal((await call('GET', '/api/v1/products', { token: key })).status, 401);
  });

  it('продавец не может выпускать ключи', async () => {
    const response = await call('POST', '/api/v1/api-keys', {
      token: sellerToken,
      body: { name: 'Свой', scopes: ['read', 'write'] },
    });
    assert.equal(response.status, 403);
  });
});

describe('сотрудники', () => {
  it('владелец не может отключить сам себя', async () => {
    const me = await call('GET', '/api/v1/me', { token: ownerToken });
    const response = await call('PATCH', `/api/v1/users/${me.body.id}`, {
      token: ownerToken,
      body: { disabled: true },
    });
    assert.equal(response.status, 400);
  });

  it('смена пароля выкидывает открытые сессии', async () => {
    const created = await call('POST', '/api/v1/users', {
      token: ownerToken,
      body: {
        name: 'Второй продавец',
        email: 'seller2@example.com',
        password: 'пароль12345',
        role: 'seller',
      },
    });

    const login = await call('POST', '/api/v1/auth/login', {
      body: { email: 'seller2@example.com', password: 'пароль12345' },
    });
    const token = login.body.token as unknown as string;
    assert.equal((await call('GET', '/api/v1/me', { token })).status, 200);

    await call('PATCH', `/api/v1/users/${created.body.id}`, {
      token: ownerToken,
      body: { password: 'новыйпароль123' },
    });

    assert.equal((await call('GET', '/api/v1/me', { token })).status, 401);
  });
});

describe('проверка входных данных', () => {
  it('объясняет, какие поля неверны', async () => {
    const response = await call('POST', '/api/v1/products', {
      token: ownerToken,
      body: { name: '' },
    });

    assert.equal(response.status, 400);
    const error = response.body.error as unknown as { code: string; details: unknown[] };
    assert.equal(error.code, 'validation_error');
    assert.ok(error.details.length > 0);
  });

  it('не принимает дробные копейки', async () => {
    const response = await call('POST', '/api/v1/products', {
      token: ownerToken,
      body: { name: 'Дробь', sale_price: 100.5 },
    });
    assert.equal(response.status, 400);
  });
});
