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

describe('документация API', () => {
  it('openapi.json отдаётся без токена', async () => {
    const response = await call('GET', '/api/v1/openapi.json');

    assert.equal(response.status, 200);
    assert.equal(response.body.openapi, '3.1.0');
    assert.ok(Object.keys(response.body.paths).length > 20);
  });

  it('не описывает эндпоинтов, которых нет', async () => {
    const spec = (await call('GET', '/api/v1/openapi.json')).body;

    const missing: string[] = [];
    for (const [path, methods] of Object.entries(spec.paths as Record<string, object>)) {
      // В OpenAPI параметры пути в фигурных скобках, у Fastify — с двоеточием.
      const url = path.replace(/\{(\w+)\}/g, ':$1');

      for (const method of Object.keys(methods)) {
        if (!app.hasRoute({ method: method.toUpperCase() as 'GET', url })) {
          missing.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }

    assert.deepEqual(missing, [], `описаны, но не реализованы: ${missing.join(', ')}`);
  });

  it('страница документации открывается и перечисляет разделы', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs' });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] as string, /text\/html/);
    assert.match(response.body, /API склада/);
    assert.match(response.body, /Синхронизация/);
    assert.match(response.body, /\/api\/v1\/sales/);
  });

  it('не ломается на символах, которые нужно экранировать', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs' });
    // Описание содержит `<токен>` — он должен превратиться в текст, а не в тег.
    assert.ok(!response.body.includes('<токен>'));
    assert.match(response.body, /&lt;токен&gt;/);
  });
});

describe('клиенты и поставщики', () => {
  it('заводит клиента и считает долг по продаже в кредит', async () => {
    const client = await call('POST', '/api/v1/counterparties', {
      token: ownerToken,
      body: { kind: 'customer', name: 'Иван', phone: '+79990000000' },
    });
    assert.equal(client.status, 201);

    const id = await makeProduct();
    await receive(id, 5000);

    await call('POST', '/api/v1/sales', {
      token: ownerToken,
      body: {
        location_id: locationId,
        customer_id: client.body.id,
        payment: 'credit',
        lines: [{ product_id: id, qty: 1000, price: 500_000 }],
      },
    });

    const withDebt = await call('GET', `/api/v1/counterparties/${client.body.id}`, {
      token: ownerToken,
    });
    assert.equal(Number(withDebt.body.balance), 500_000);
  });

  it('платёж уменьшает долг', async () => {
    const client = await call('POST', '/api/v1/counterparties', {
      token: ownerToken,
      body: { kind: 'customer', name: 'Пётр' },
    });

    const id = await makeProduct();
    await receive(id, 5000);
    await call('POST', '/api/v1/sales', {
      token: ownerToken,
      body: {
        location_id: locationId,
        customer_id: client.body.id,
        payment: 'credit',
        lines: [{ product_id: id, qty: 1000, price: 500_000 }],
      },
    });

    await call('POST', `/api/v1/counterparties/${client.body.id}/payments`, {
      token: ownerToken,
      body: { amount: 200_000, note: 'частично наличными' },
    });

    const after = await call('GET', `/api/v1/counterparties/${client.body.id}`, {
      token: ownerToken,
    });
    assert.equal(Number(after.body.balance), 300_000);
  });

  it('продажа в долг без покупателя не проводится', async () => {
    const id = await makeProduct();
    await receive(id, 5000);

    const response = await call('POST', '/api/v1/sales', {
      token: ownerToken,
      body: {
        location_id: locationId,
        payment: 'credit',
        lines: [{ product_id: id, qty: 1000, price: 500_000 }],
      },
    });

    assert.equal(response.status, 400);
    assert.match(String(response.body.error.message), /покупател/i);
  });

  it('поставка в долг даёт отрицательный баланс — должны мы', async () => {
    const supplier = await call('POST', '/api/v1/counterparties', {
      token: ownerToken,
      body: { kind: 'supplier', name: 'ООО Чайный путь' },
    });

    const id = await makeProduct();
    await call('POST', '/api/v1/docs', {
      token: ownerToken,
      body: {
        type: 'receipt',
        location_id: locationId,
        supplier_id: supplier.body.id,
        lines: [{ product_id: id, qty: 10_000, price: 200_000 }],
      },
    });

    const debt = await call('GET', `/api/v1/counterparties/${supplier.body.id}`, {
      token: ownerToken,
    });
    // 10 кг × 2000,00 ₽ — столько мы должны поставщику.
    assert.equal(Number(debt.body.balance), -2_000_000);
  });

  it('запись «и клиент, и поставщик» попадает в оба списка', async () => {
    await call('POST', '/api/v1/counterparties', {
      token: ownerToken,
      body: { kind: 'both', name: 'Сосед по рынку' },
    });

    const asCustomer = await call('GET', '/api/v1/counterparties?kind=customer', { token: ownerToken });
    const asSupplier = await call('GET', '/api/v1/counterparties?kind=supplier', { token: ownerToken });

    const names = (rows: unknown) => (rows as { name: string }[]).map((r) => r.name);
    assert.ok(names(asCustomer.body).includes('Сосед по рынку'));
    assert.ok(names(asSupplier.body).includes('Сосед по рынку'));
  });

  it('история контрагента собирает продажи и платежи', async () => {
    const client = await call('POST', '/api/v1/counterparties', {
      token: ownerToken,
      body: { kind: 'customer', name: 'Мария' },
    });

    const id = await makeProduct();
    await receive(id, 5000);
    await call('POST', '/api/v1/sales', {
      token: ownerToken,
      body: {
        location_id: locationId,
        customer_id: client.body.id,
        payment: 'credit',
        lines: [{ product_id: id, qty: 1000, price: 500_000 }],
      },
    });
    await call('POST', `/api/v1/counterparties/${client.body.id}/payments`, {
      token: ownerToken,
      body: { amount: 100_000 },
    });

    const history = await call('GET', `/api/v1/counterparties/${client.body.id}/history`, {
      token: ownerToken,
    });
    const kinds = (history.body as unknown as { kind: string }[]).map((e) => e.kind);
    assert.ok(kinds.includes('sale'));
    assert.ok(kinds.includes('payment'));
  });

  it('продавец не правит справочник, но может завести клиента на кассе', async () => {
    const created = await call('POST', '/api/v1/counterparties', {
      token: sellerToken,
      body: { kind: 'customer', name: 'Новый покупатель' },
    });
    assert.equal(created.status, 201);

    const edited = await call('PATCH', `/api/v1/counterparties/${created.body.id}`, {
      token: sellerToken,
      body: { name: 'Переименован' },
    });
    assert.equal(edited.status, 403);
  });
});
