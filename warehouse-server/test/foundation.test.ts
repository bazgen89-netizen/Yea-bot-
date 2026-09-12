import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import type { SqlDb } from '../src/db/driver.ts';
import { MIGRATIONS, migrate } from '../src/db/schema.ts';
import { hashPassword, validatePassword, verifyPassword } from '../src/auth/passwords.ts';
import {
  API_KEY_PREFIX,
  generateApiKey,
  generateToken,
  hashToken,
  issueSessionToken,
  principalFromApiKey,
  principalFromSession,
} from '../src/auth/tokens.ts';
import { createTestDb } from './helpers.ts';

describe('пароли', () => {
  it('проверяются по своему хешу', async () => {
    const hash = await hashPassword('очень секретно');
    assert.equal(await verifyPassword('очень секретно', hash), true);
    assert.equal(await verifyPassword('очень секретнО', hash), false);
  });

  it('дают разные хеши при одинаковом пароле', async () => {
    // Соль случайна: одинаковые пароли двух сотрудников не должны выглядеть
    // одинаково в дампе базы.
    const first = await hashPassword('одинаковый');
    const second = await hashPassword('одинаковый');
    assert.notEqual(first, second);
  });

  it('не ломаются на испорченном хеше', async () => {
    assert.equal(await verifyPassword('пароль', 'мусор'), false);
    assert.equal(await verifyPassword('пароль', ''), false);
  });

  it('отклоняют короткий пароль', () => {
    assert.equal(validatePassword('1234567'), 'Пароль должен быть не короче 8 символов');
    assert.equal(validatePassword('12345678'), null);
  });
});

describe('токены', () => {
  it('хешируются одинаково и различаются между собой', () => {
    const token = generateToken();
    assert.equal(hashToken(token), hashToken(token));
    assert.notEqual(hashToken(token), hashToken(generateToken()));
  });

  it('ключи интеграции узнаваемы по префиксу', () => {
    const { key, prefix } = generateApiKey();
    assert.ok(key.startsWith(API_KEY_PREFIX));
    assert.ok(key.startsWith(prefix));
  });
});

describe('база и сессии', () => {
  let db: SqlDb;
  let orgId: string;
  let userId: string;

  before(async () => {
    db = await createTestDb();

    orgId = randomUUID();
    userId = randomUUID();
    await db.query('INSERT INTO orgs (id, name) VALUES ($1, $2)', [orgId, 'Чайная']);
    await db.query(
      `INSERT INTO users (id, org_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, orgId, 'owner@example.com', await hashPassword('пароль123'), 'Владелец', 'owner'],
    );
  });

  after(async () => {
    await db.close();
  });

  it('миграции применяются повторно без ошибок', async () => {
    await migrate(db);
    const row = await db.one<{ version: number }>('SELECT version FROM schema_version');
    // Привязка к длине списка, а не к числу: иначе тест падает от каждой
    // новой миграции, ничего при этом не проверяя.
    assert.equal(row?.version, MIGRATIONS.length);
  });

  it('выданный токен опознаёт пользователя', async () => {
    const { token } = await issueSessionToken(db, userId, 'iPhone продавца');

    const principal = await principalFromSession(db, token);
    assert.equal(principal?.userId, userId);
    assert.equal(principal?.orgId, orgId);
    assert.equal(principal?.role, 'owner');
    assert.equal(principal?.kind, 'user');
  });

  it('чужой токен не подходит', async () => {
    assert.equal(await principalFromSession(db, generateToken()), null);
  });

  it('истёкший токен не подходит', async () => {
    const { token } = await issueSessionToken(db, userId, null);
    await db.query(`UPDATE tokens SET expires_at = now() - interval '1 day' WHERE token_hash = $1`, [
      hashToken(token),
    ]);

    assert.equal(await principalFromSession(db, token), null);
  });

  it('отключённый сотрудник не проходит по своему токену', async () => {
    const sellerId = randomUUID();
    await db.query(
      `INSERT INTO users (id, org_id, email, password_hash, name, role, disabled)
       VALUES ($1, $2, $3, $4, $5, 'seller', true)`,
      [sellerId, orgId, 'seller@example.com', await hashPassword('пароль123'), 'Продавец'],
    );
    const { token } = await issueSessionToken(db, sellerId, null);

    assert.equal(await principalFromSession(db, token), null);
  });

  it('ключ интеграции даёт доступ в пределах своих scopes', async () => {
    const { key, prefix } = generateApiKey();
    await db.query(
      `INSERT INTO api_keys (id, org_id, name, key_hash, key_prefix, scopes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), orgId, 'Сайт', hashToken(key), prefix, ['read']],
    );

    const principal = await principalFromApiKey(db, key);
    assert.equal(principal?.orgId, orgId);
    assert.equal(principal?.kind, 'api_key');
    assert.deepEqual(principal?.scopes, ['read']);
    assert.equal(principal?.userId, null);
  });

  it('отозванный ключ перестаёт работать', async () => {
    const { key, prefix } = generateApiKey();
    await db.query(
      `INSERT INTO api_keys (id, org_id, name, key_hash, key_prefix, scopes, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [randomUUID(), orgId, 'Старый', hashToken(key), prefix, ['read', 'write']],
    );

    assert.equal(await principalFromApiKey(db, key), null);
  });
});

describe('схема', () => {
  let db: SqlDb;
  let orgId: string;
  let locationId: string;

  before(async () => {
    db = await createTestDb();
    orgId = randomUUID();
    locationId = randomUUID();
    await db.query('INSERT INTO orgs (id, name) VALUES ($1, $2)', [orgId, 'Чайная']);
    await db.query('INSERT INTO locations (id, org_id, name, seq) VALUES ($1, $2, $3, 1)', [
      locationId,
      orgId,
      'Основной склад',
    ]);
  });

  after(async () => {
    await db.close();
  });

  async function addProduct(barcode: string | null, archived = false): Promise<string> {
    const id = randomUUID();
    await db.query(
      `INSERT INTO products (id, org_id, name, barcode, archived, seq)
       VALUES ($1, $2, $3, $4, $5, 1)`,
      [id, orgId, 'Шу пуэр', barcode, archived],
    );
    return id;
  }

  it('штрихкод уникален внутри организации', async () => {
    await addProduct('4600000000001');
    await assert.rejects(() => addProduct('4600000000001'));
  });

  it('архивный товар не мешает завести новый с тем же штрихкодом', async () => {
    await addProduct('4600000000002', true);
    await addProduct('4600000000002', false);
  });

  it('товары без штрихкода не конфликтуют', async () => {
    await addProduct(null);
    await addProduct(null);
  });

  it('перемещение обязано указывать вторую точку', async () => {
    await assert.rejects(() =>
      db.query(
        `INSERT INTO docs (id, org_id, location_id, type, seq) VALUES ($1, $2, $3, 'transfer', 1)`,
        [randomUUID(), orgId, locationId],
      ),
    );
  });

  it('обычный документ не должен иметь вторую точку', async () => {
    const second = randomUUID();
    await db.query('INSERT INTO locations (id, org_id, name, seq) VALUES ($1, $2, $3, 1)', [
      second,
      orgId,
      'Вторая точка',
    ]);

    await assert.rejects(() =>
      db.query(
        `INSERT INTO docs (id, org_id, location_id, type, to_location_id, seq)
         VALUES ($1, $2, $3, 'receipt', $4, 1)`,
        [randomUUID(), orgId, locationId, second],
      ),
    );
  });
});
