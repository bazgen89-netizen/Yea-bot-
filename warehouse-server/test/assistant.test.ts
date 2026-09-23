import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { FastifyInstance } from 'fastify';

import type { SqlDb } from '../src/db/driver.ts';
import { buildServer } from '../src/server.ts';
import { modelFromEnv, parse } from '../src/core/assistant.ts';
import { createTestDb } from './helpers.ts';

/**
 * Помощник.
 *
 * К настоящей модели здесь не ходят — за это платят деньги, и ответ у неё
 * каждый раз разный. Вместо неё подставляется своя: так проверяется то, что
 * от сервера и зависит — что уходит наружу, что приходит назад и что
 * говорится человеку, когда помощник не настроен.
 */

type JsonObject = Record<string, any>;

let db: SqlDb;
let app: FastifyInstance;
let token: string;

/** Что модель услышала в последний раз. Ради этого fake и нужен. */
let услышано: { system: string; question: string } | null = null;
let отвечать = '';

async function call(url: string, options: { token?: string; body?: unknown } = {}) {
  const response = await app.inject({
    method: 'POST',
    url,
    headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
    payload: options.body as object | undefined,
  });
  return { status: response.statusCode, body: response.json() as JsonObject };
}

before(async () => {
  db = await createTestDb();
  app = buildServer({
    db,
    model: async (system, question) => {
      услышано = { system, question };
      return отвечать;
    },
  });
  await app.ready();

  const registered = await call('/api/v1/auth/register', {
    body: { org_name: 'Waystea', name: 'Владелец', email: 'o@example.com', password: 'пароль12345' },
  });
  token = registered.body.token;
});

after(async () => {
  await app.close();
  await db.close();
});

const схема = 'products — Товары.\n  колонки: id, name, sale_price';

describe('помощник', () => {
  it('превращает вопрос в запрос', async () => {
    отвечать = 'Считаю выручку по каждому товару.\n```sql\nSELECT name FROM products\n```';

    const response = await call('/api/v1/assistant/ask', {
      token,
      body: { question: 'что лучше продавалось?', schema: схема },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.sql, 'SELECT name FROM products');
    assert.equal(response.body.comment, 'Считаю выручку по каждому товару.');
  });

  /**
   * Главное обещание помощника: наружу уходит вопрос и названия таблиц, а не
   * данные магазина. Если это когда-нибудь перестанет быть правдой, падать
   * должно здесь, а не в разговоре с магазином, который спросил, куда
   * уходит его клиентская база.
   */
  it('наружу отдаёт вопрос и описание таблиц, и ничего больше', async () => {
    отвечать = '```sql\nSELECT 1\n```';
    услышано = null;

    await call('/api/v1/assistant/ask', {
      token,
      body: { question: 'сколько выручки за август?', schema: схема },
    });

    const было = услышано as { system: string; question: string } | null;
    assert.ok(было);
    assert.equal(было.question, 'сколько выручки за август?');
    assert.ok(было.system.includes('products'));
    assert.ok(было.system.includes('sale_price'));
    // Правила про копейки и тысячные должны доехать: без них помощник
    // насчитает выручку в сто раз больше настоящей.
    assert.ok(было.system.includes('копейками'));
    assert.ok(было.system.includes('тысячными'));
  });

  it('отказ модели передаёт словами, а не пустой таблицей', async () => {
    отвечать = 'НЕЛЬЗЯ: в базе не хранится, откуда пришёл покупатель.';

    const response = await call('/api/v1/assistant/ask', {
      token,
      body: { question: 'откуда узнали о нас клиенты?', schema: схема },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.sql, '');
    assert.match(response.body.comment, /не хранится/);
  });

  it('без токена не отвечает', async () => {
    const response = await call('/api/v1/assistant/ask', {
      body: { question: 'сколько денег?', schema: схема },
    });

    assert.equal(response.status, 401);
  });

  it('пустой вопрос не отправляет модели', async () => {
    const response = await call('/api/v1/assistant/ask', {
      token,
      body: { question: '   ', schema: схема },
    });

    assert.equal(response.status, 400);
  });
});

describe('помощник, который не настроен', () => {
  let свой: FastifyInstance;
  let своя: SqlDb;
  let свойТокен: string;

  before(async () => {
    своя = await createTestDb();
    свой = buildServer({ db: своя, model: null });
    await свой.ready();

    const registered = await свой.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        org_name: 'Waystea',
        name: 'Владелец',
        email: 'o@example.com',
        password: 'пароль12345',
      },
    });
    свойТокен = (registered.json() as JsonObject).token;
  });

  after(async () => {
    await свой.close();
    await своя.close();
  });

  /**
   * Сервер без ключа — обычное дело: кто-то поднял его у себя и ключа не
   * покупал. Человек должен услышать, чего не хватает, а не «ошибка 500».
   */
  it('говорит, чего не хватает', async () => {
    const response = await свой.inject({
      method: 'POST',
      url: '/api/v1/assistant/ask',
      headers: { authorization: `Bearer ${свойТокен}` },
      payload: { question: 'сколько выручки?', schema: схема },
    });

    assert.equal(response.statusCode, 503);
    assert.match((response.json() as JsonObject).error.message, /ASSISTANT_KEY/);
  });
});

describe('разбор ответа модели', () => {
  it('берёт запрос из блока и пояснение перед ним', () => {
    const ответ = parse('Смотрю продажи за месяц.\n\n```sql\nSELECT 1\n```\n');
    assert.equal(ответ.sql, 'SELECT 1');
    assert.equal(ответ.comment, 'Смотрю продажи за месяц.');
  });

  /** Модель просят отвечать блоком, но «просят» — не «всегда». */
  it('находит запрос и без блока', () => {
    const ответ = parse('Вот запрос:\nSELECT name FROM products LIMIT 5');
    assert.equal(ответ.sql, 'SELECT name FROM products LIMIT 5');
  });

  it('WITH тоже находит', () => {
    const ответ = parse('WITH x AS (SELECT 1 AS a) SELECT a FROM x');
    assert.match(ответ.sql, /^WITH/);
  });

  it('на ответ без запроса вовсе не выдумывает запрос', () => {
    const ответ = parse('Здравствуйте! Чем могу помочь?');
    assert.equal(ответ.sql, '');
    assert.match(ответ.comment, /Здравствуйте/);
  });
});

describe('настройки модели из окружения', () => {
  it('без ключа помощника нет', () => {
    assert.equal(modelFromEnv({} as NodeJS.ProcessEnv), null);
  });

  it('по умолчанию Клод', () => {
    const settings = modelFromEnv({ ASSISTANT_KEY: 'к' } as NodeJS.ProcessEnv);
    assert.equal(settings?.kind, 'claude');
    assert.match(settings!.url, /anthropic/);
  });

  /** Переключение на ДипСик — это одна переменная, а не другой код. */
  it('переключается на ДипСик одной переменной', () => {
    const settings = modelFromEnv({
      ASSISTANT_KEY: 'к',
      ASSISTANT_KIND: 'openai',
    } as NodeJS.ProcessEnv);

    assert.equal(settings?.kind, 'openai');
    assert.match(settings!.url, /deepseek/);
    assert.equal(settings!.model, 'deepseek-chat');
  });

  it('адрес и модель можно задать свои', () => {
    const settings = modelFromEnv({
      ASSISTANT_KEY: 'к',
      ASSISTANT_KIND: 'openai',
      ASSISTANT_URL: 'https://свой.сервер/chat',
      ASSISTANT_MODEL: 'своя-модель',
    } as NodeJS.ProcessEnv);

    assert.equal(settings!.url, 'https://свой.сервер/chat');
    assert.equal(settings!.model, 'своя-модель');
  });
});
