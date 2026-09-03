import { createTestDriver } from '../testDriver';
import type { SqlDriver } from '../driver';
import { ensureLocation } from '../locations';
import { createProduct } from '../products';
import { getServer, isSignedIn, saveSignIn, setServerUrl, signOut } from '../server';
import { ServerError, register, signIn, syncNow } from '../../net/server';

/**
 * Вход в учётную запись магазина и обмен с сервером.
 *
 * Сеть здесь подменена: проверяется не то, что сервер работает (у него свои
 * 141 проверка), а то, что программа правильно с ним разговаривает — что
 * запоминает вход, в каком порядке отдаёт и забирает и что говорит человеку,
 * когда связи нет.
 */
describe('связь с сервером магазина', () => {
  let db: SqlDriver;
  let calls: { path: string; method: string; token: string | null; body: unknown }[];

  const answer = (body: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });

  beforeEach(() => {
    db = createTestDriver();
    calls = [];
  });

  /** Сервер, который отвечает так, как отвечает настоящий. */
  const fakeServer = (replies: Record<string, unknown>) => {
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      const path = String(url).replace('https://склад.рф', '');
      const headers = (init.headers ?? {}) as Record<string, string>;

      calls.push({
        path,
        method: init.method ?? 'GET',
        token: headers.Authorization?.replace('Bearer ', '') ?? null,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });

      const found = Object.entries(replies).find(([key]) => path.startsWith(key));
      if (!found) return answer({ error: 'Не найдено' }, 404);
      // Ответ может зависеть от запроса — так сервер и отдаёт порциями.
      const body = typeof found[1] === 'function' ? (found[1] as (p: string) => unknown)(path) : found[1];
      return answer(body);
    }) as unknown as typeof fetch;
  };

  const вход = {
    token: 'токен-123',
    user: { id: 'ю-1', org_id: 'орг-1', name: 'Вазген', email: 'waystea@gmail.com', role: 'owner' },
  };

  it('запоминает вход и больше не спрашивает адрес', async () => {
    fakeServer({ '/api/v1/auth/login': вход });

    await signIn(db, 'https://склад.рф', { email: 'waystea@gmail.com', password: 'секрет' });

    expect(isSignedIn(db)).toBe(true);
    const link = getServer(db);
    expect(link?.url).toBe('https://склад.рф');
    expect(link?.org).toBe('орг-1');
    expect(link?.role).toBe('owner');
    expect(link?.user_name).toBe('Вазген');
  });

  it('регистрация заводит магазин и сразу считается входом', async () => {
    fakeServer({ '/api/v1/auth/register': вход });

    await register(db, 'https://склад.рф', {
      orgName: 'WAYSTEA',
      name: 'Вазген',
      email: 'waystea@gmail.com',
      password: 'секрет-подлиннее',
    });

    expect(isSignedIn(db)).toBe(true);
    expect(getServer(db)?.org_name).toBe('WAYSTEA');
    expect(calls[0].body).toMatchObject({ org_name: 'WAYSTEA', email: 'waystea@gmail.com' });
  });

  const габа = () =>
    createProduct(db, {
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

  it('сперва отдаёт своё, потом забирает чужое', async () => {
    fakeServer({
      '/api/v1/auth/login': вход,
      '/api/v1/sync/push': { cursor: 7, applied: {} },
      '/api/v1/sync/pull': { cursor: 12, changes: {} },
    });

    await signIn(db, 'https://склад.рф', { email: 'waystea@gmail.com', password: 'секрет' });

    // Первый обмен — знакомство, он идёт наоборот; порядок «отдать первым»
    // проверяется на втором, обычном.
    await syncNow(db);
    calls = [];
    габа();
    const report = await syncNow(db);

    const paths = calls.map((one) => one.path);
    // Порядок именно такой: чек, пробитый минуту назад, должен уехать до
    // того, как мы скажем «всё сошлось».
    expect(paths.indexOf('/api/v1/sync/push')).toBeLessThan(
      paths.findIndex((path) => path.startsWith('/api/v1/sync/pull')),
    );
    expect(report.sent).toBeGreaterThan(0);
    // Счётчик прочитанного сохранён — со следующего раза продолжим с него.
    expect(getServer(db)?.pulled).toBe(12);
    expect(getServer(db)?.synced_at).not.toBeNull();
  });

  /**
   * Первый обмен идёт наоборот, и это не придирка к порядку вызовов.
   *
   * Устройство входит в магазин, который уже заведён: те же точки, те же
   * товары — только под своими именами. Отдай мы первыми, на сервере
   * завелась бы вторая «Чайная лавка». Поэтому сперва слушаем.
   */
  it('в первый раз сперва слушает сервер, а потом отдаёт своё', async () => {
    fakeServer({
      '/api/v1/auth/login': вход,
      '/api/v1/sync/push': { cursor: 3, applied: {} },
      '/api/v1/sync/pull': {
        cursor: 3,
        changes: {
          locations: [{ id: 'точка-с-сервера', name: 'Чайный бар', created_at: '2026-01-01' }],
        },
      },
    });

    await signIn(db, 'https://склад.рф', { email: 'waystea@gmail.com', password: 'секрет' });
    ensureLocation(db, 'Чайный бар');

    await syncNow(db);

    const paths = calls.map((one) => one.path);
    expect(paths.findIndex((path) => path.startsWith('/api/v1/sync/pull'))).toBeLessThan(
      paths.indexOf('/api/v1/sync/push'),
    );

    // Точка одна, и уехала она уже под именем сервера — второй «Чайный бар»
    // там не заведётся.
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM locations')?.n).toBe(1);
    const push = calls.find((one) => one.path === '/api/v1/sync/push');
    const отданные = (push?.body as { locations?: { id: string }[] }).locations ?? [];
    expect(отданные.map((one) => one.id)).toEqual(['точка-с-сервера']);
  });

  it('присланное с сервера заводится в базе', async () => {
    fakeServer({
      '/api/v1/auth/login': вход,
      '/api/v1/sync/push': { cursor: 1, applied: {} },
      '/api/v1/sync/pull': {
        cursor: 3,
        changes: {
          products: [
            {
              id: 'товар-с-другого-телефона',
              name: 'Пуэр Шу',
              unit: 'гр',
              sale_price: 5_000,
              cost_price: 2_000,
            },
          ],
        },
      },
    });

    await signIn(db, 'https://склад.рф', { email: 'waystea@gmail.com', password: 'секрет' });
    const report = await syncNow(db);

    expect(report.added).toBe(1);
    expect(db.get<{ name: string }>('SELECT name FROM products')?.name).toBe('Пуэр Шу');
  });

  /**
   * Обмен, которому нечего сказать, должен молчать.
   *
   * Раньше уезжал весь склад целиком — каждый раз. С телефона по мобильному
   * интернету это мегабайт туда и столько же обратно каждые пять минут, и
   * половина возвращалась назад же: сервер честно пересказывал нам наши
   * собственные правки.
   */
  it('второй раз подряд не отправляет ничего и не получает своё же назад', async () => {
    fakeServer({
      '/api/v1/auth/login': вход,
      '/api/v1/sync/push': { cursor: 1, applied: {} },
      '/api/v1/sync/pull': { cursor: 1, changes: {} },
    });

    await signIn(db, 'https://склад.рф', { email: 'waystea@gmail.com', password: 'секрет' });
    габа();

    expect((await syncNow(db)).sent).toBeGreaterThan(0);

    calls = [];
    const тишина = await syncNow(db);

    expect(тишина.sent).toBe(0);
    expect(тишина.added).toBe(0);
    expect(тишина.updated).toBe(0);
    // Отправлять нечего — и в сеть за этим никто не ходил.
    expect(calls.some((one) => one.path === '/api/v1/sync/push')).toBe(false);
  });

  /**
   * Принятое с сервера обратно не отправляется.
   *
   * Иначе получается круг: приняли товар, отправили его назад, сервер отдал
   * его снова — и так до разряженной батареи.
   */
  it('присланное с сервера не уезжает обратно', async () => {
    fakeServer({
      '/api/v1/auth/login': вход,
      '/api/v1/sync/push': { cursor: 5, applied: {} },
      '/api/v1/sync/pull': (path: string) => {
        const since = Number(new URL(`https://x${path}`).searchParams.get('since'));
        if (since === 0) {
          return {
            cursor: 5,
            changes: {
              products: [
                { id: 'чужой-товар', name: 'Пуэр Шу', unit: 'гр', sale_price: 5_000, cost_price: 2_000 },
              ],
            },
          };
        }
        return { cursor: 5, changes: {} };
      },
    });

    await signIn(db, 'https://склад.рф', { email: 'waystea@gmail.com', password: 'секрет' });
    await syncNow(db);

    calls = [];
    const второй = await syncNow(db);

    expect(второй.sent).toBe(0);
    expect(calls.some((one) => one.path === '/api/v1/sync/push')).toBe(false);
  });

  /**
   * Сервер отдаёт порциями — программа обязана дочитать до конца.
   *
   * Иначе после первого входа приезжает пятьсот записей из пяти тысяч, а
   * человек видит «готово» и думает, что каталог такой и есть.
   */
  it('дочитывает сервер до конца, а не первую порцию', async () => {
    const товар = (n: number) => ({
      id: `товар-${n}`,
      name: `Чай №${n}`,
      unit: 'гр',
      sale_price: 1_000,
      cost_price: 500,
    });

    fakeServer({
      '/api/v1/auth/login': вход,
      '/api/v1/sync/push': { cursor: 0, applied: {} },
      '/api/v1/sync/pull': (path: string) => {
        const since = Number(new URL(`https://x${path}`).searchParams.get('since'));
        if (since === 0) return { cursor: 2, changes: { products: [товар(1), товар(2)] } };
        if (since === 2) return { cursor: 4, changes: { products: [товар(3), товар(4)] } };
        return { cursor: 4, changes: {} };
      },
    });

    await signIn(db, 'https://склад.рф', { email: 'waystea@gmail.com', password: 'секрет' });
    const report = await syncNow(db);

    expect(report.added).toBe(4);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM products')?.n).toBe(4);
    expect(getServer(db)?.pulled).toBe(4);
  });

  it('без связи говорит, что делать, а не «ошибка»', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;

    setServerUrl(db, 'https://склад.рф');
    await expect(
      signIn(db, 'https://склад.рф', { email: 'a@b.ru', password: '123' }),
    ).rejects.toThrow(/Нет связи/);
  });

  it('передаёт слова сервера, а не свои', async () => {
    globalThis.fetch = (async () => answer({ error: 'Неверная почта или пароль' }, 401)) as unknown as typeof fetch;

    await expect(
      signIn(db, 'https://склад.рф', { email: 'a@b.ru', password: 'не тот' }),
    ).rejects.toThrow('Неверная почта или пароль');
  });

  it('без входа обмен не притворяется удачным', async () => {
    await expect(syncNow(db)).rejects.toBeInstanceOf(ServerError);
  });

  it('выход стирает связь, но не склад', async () => {
    fakeServer({ '/api/v1/auth/login': вход });
    await signIn(db, 'https://склад.рф', { email: 'waystea@gmail.com', password: 'секрет' });

    createProduct(db, {
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

    signOut(db);

    expect(isSignedIn(db)).toBe(false);
    // Товары на месте: выход из учётной записи — не потеря склада.
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM products')?.n).toBe(1);
    // Адрес сервера остался: входить снова — не значит вспоминать адрес.
    expect(getServer(db)?.url).toBe('https://склад.рф');
  });
});
