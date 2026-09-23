import { createTestDriver } from '../testDriver';
import type { SqlDriver } from '../driver';
import { createProduct } from '../products';
import { chooseAskKind, getAskSettings, hasAskKey, saveAskSettings } from '../askSettings';
import { saveSignIn } from '../server';
import { askWarehouse, askWay } from '../../net/assistant';
import { ServerError } from '../../net/server';
import { разобрать } from '../../domain/askPrompt';

/**
 * Помощник со своим ключом — без всякого сервера.
 *
 * Это появилось не от полноты замысла, а после того, как хозяин открыл
 * программу, спросил «сколько продалось пуэра за август» и получил «войдите
 * в учётную запись магазина». Входить было некуда: сервер нигде не поднят.
 * Тупик, и виноват в нём я.
 *
 * Поэтому здесь проверяется главное: со своим ключом помощник работает, ничего
 * поднимать не надо, а ключ уходит только к модели.
 */
describe('помощник со своим ключом', () => {
  let db: SqlDriver;
  let calls: { url: string; headers: Record<string, string>; body: any }[];

  const ответМодели = (текст: string) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content: текст } }] }),
  });

  beforeEach(() => {
    db = createTestDriver();
    calls = [];

    createProduct(db, {
      name: 'Шу Пуэр Золотой Бутон',
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

  const модель = (ответ: unknown) => {
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      calls.push({
        url: String(url),
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      return ответ;
    }) as unknown as typeof fetch;
  };

  it('без ключа и без сервера спрашивать нечем — и это сказано словами', async () => {
    expect(askWay(db)).toBeNull();

    await expect(askWarehouse(db, 'сколько продалось пуэра')).rejects.toThrow(
      /Впишите свой ключ/,
    );
  });

  it('со своим ключом отвечает, не заходя ни на какой сервер', async () => {
    saveAskSettings(db, { kind: 'gemini', key: 'AIza-mine', model: '' });
    expect(askWay(db)).toBe('ключ');

    модель(
      ответМодели('Считаю проданное за август.\n```sql\nSELECT name AS "Товар" FROM products\n```'),
    );

    const ответ = await askWarehouse(db, 'сколько продалось пуэра за август');

    expect(ответ.через).toBe('ключ');
    expect(ответ.comment).toBe('Считаю проданное за август.');
    expect(ответ.result?.rows[0]).toEqual(['Шу Пуэр Золотой Бутон']);

    // Спрашивали именно у модели, а не у чьего-то сервера.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('generativelanguage.googleapis.com');
  });

  /**
   * Клода нет: Вазген убрал его как платного. Ни адреса Anthropic, ни его
   * заголовков в запросе быть не должно — даже если Клода выбрали когда-то.
   */
  it('выбранный раньше Клод открывается как Gemini, к Anthropic ничего не уходит', async () => {
    db.run("INSERT INTO app_state (key, value) VALUES ('assistant', ?)", [
      JSON.stringify({ kind: 'claude', key: 'AIza-mine', model: '' }),
    ]);
    модель(ответМодели('```sql\nSELECT 1 AS "Ответ"\n```'));

    await askWarehouse(db, 'вопрос');

    expect(calls[0].url).not.toContain('anthropic');
    expect(calls[0].headers['x-api-key']).toBeUndefined();
    expect(calls[0].headers.authorization).toBe('Bearer AIza-mine');
  });

  it('Gemini о неверном ключе говорит кодом 400 и списком — всё равно понятно', async () => {
    saveAskSettings(db, { kind: 'gemini', key: 'AIza-wrong', model: '' });
    модель({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify([
          { error: { code: 400, message: 'Please pass a valid API key', status: 'INVALID_ARGUMENT' } },
        ]),
    });

    await expect(askWarehouse(db, 'вопрос')).rejects.toThrow(/не приняла ключ/);
  });

  it('ДипСик — та же программа, другой адрес и другой заголовок', async () => {
    saveAskSettings(db, { kind: 'deepseek', key: 'sk-deepseek-mine', model: '' });
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      calls.push({
        url: String(url),
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ choices: [{ message: { content: '```sql\nSELECT 1 AS "Ответ"\n```' } }] }),
      };
    }) as unknown as typeof fetch;

    const ответ = await askWarehouse(db, 'вопрос');

    expect(ответ.result?.rows[0]).toEqual([1]);
    expect(calls[0].url).toContain('deepseek');
    expect(calls[0].headers.authorization).toBe('Bearer sk-deepseek-mine');
  });

  /**
   * GPT и Gemini — Вазген попросил их рядом с ДипСиком.
   *
   * Оба говорят на языке запросов OpenAI, поэтому идут той же дорогой, что и
   * ДипСик, и различаются только адресом. Здесь проверяется ровно это: куда
   * ушёл вопрос, с каким ключом и какой моделью.
   */
  it.each([
    ['gpt', 'api.openai.com', 'gpt-6-sol', 'sk-proj-mine'],
    ['gemini', 'generativelanguage.googleapis.com/v1beta/openai', 'gemini-3.8-flash', 'AIza-mine'],
  ] as const)('%s — свой адрес, ключ заголовком, своя модель', async (kind, адрес, модель, ключ) => {
    saveAskSettings(db, { kind, key: ключ, model: '' });
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      calls.push({
        url: String(url),
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ choices: [{ message: { content: '```sql\nSELECT 2 AS "Ответ"\n```' } }] }),
      };
    }) as unknown as typeof fetch;

    const ответ = await askWarehouse(db, 'вопрос');

    expect(ответ.result?.rows[0]).toEqual([2]);
    expect(calls[0].url).toContain(адрес);
    expect(calls[0].headers.authorization).toBe(`Bearer ${ключ}`);
    expect(calls[0].body.model).toBe(модель);
    expect(calls[0].headers['x-api-key']).toBeUndefined();
  });

  /**
   * Главное обещание помощника. Если оно когда-нибудь перестанет быть
   * правдой, падать должно здесь.
   */
  it('наружу отдаёт вопрос и названия таблиц, а не данные склада', async () => {
    saveAskSettings(db, { kind: 'gemini', key: 'AIza-mine', model: '' });
    db.run(
      "INSERT INTO counterparties (kind, name, phone, created_at) VALUES ('customer', ?, ?, '2026-01-01')",
      ['Пётр Иванович', '+79161234567'],
    );
    модель(ответМодели('```sql\nSELECT 1 AS "Ответ"\n```'));

    await askWarehouse(db, 'кто мои лучшие клиенты?');

    const отправлено = JSON.stringify(calls[0].body);
    expect(отправлено).toContain('кто мои лучшие клиенты?');
    expect(отправлено).toContain('counterparties');
    expect(отправлено).not.toContain('Пётр Иванович');
    expect(отправлено).not.toContain('+79161234567');
    expect(отправлено).not.toContain('Шу Пуэр');
  });

  it('свой ключ идёт вперёд сервера: он ближе и не зависит от чужой машины', async () => {
    saveSignIn(db, 'https://склад.рф', {
      token: 'т',
      org: 'о',
      userId: 'ю',
      userName: 'Вазген',
      role: 'owner',
    });
    saveAskSettings(db, { kind: 'gemini', key: 'AIza-mine', model: '' });
    модель(ответМодели('```sql\nSELECT 1 AS "Ответ"\n```'));

    const ответ = await askWarehouse(db, 'вопрос');

    expect(ответ.через).toBe('ключ');
    expect(calls[0].url).not.toContain('склад.рф');
  });

  it('без своего ключа, но со входом — идёт через сервер', () => {
    saveSignIn(db, 'https://склад.рф', {
      token: 'т',
      org: 'о',
      userId: 'ю',
      userName: 'Вазген',
      role: 'owner',
    });

    expect(askWay(db)).toBe('сервер');
  });

  /**
   * Промах в колонке.
   *
   * Первый же живой вопрос кончился так: модель написала `s.refunded_at`, а
   * такой колонки у чеков нет — я сам про неё соврал в описании. Человеку в
   * этот момент показывалась ошибка базы, то есть его просили разобраться в
   * чужом запросе. А достаточно сказать модели, на чём она села.
   */
  describe('когда запрос не выполнился', () => {
    /** Модель, которая отвечает по очереди — как в жизни, вторым разом. */
    const модельПоОчереди = (ответы: string[]) => {
      let раз = 0;
      globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
        calls.push({
          url: String(url),
          headers: (init.headers ?? {}) as Record<string, string>,
          body: init.body ? JSON.parse(String(init.body)) : undefined,
        });
        const текст = ответы[Math.min(раз, ответы.length - 1)];
        раз += 1;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { content: текст } }] }),
        };
      }) as unknown as typeof fetch;
    };

    beforeEach(() => {
      saveAskSettings(db, { kind: 'gemini', key: 'AIza-mine', model: '' });
    });

    it('переспрашивает один раз, показав ошибку, и отвечает со второй попытки', async () => {
      модельПоОчереди([
        'Считаю проданное.\n```sql\nSELECT name FROM sales WHERE refunded_at IS NULL\n```',
        'Возвраты помечены иначе.\n```sql\nSELECT name AS "Товар" FROM products\n```',
      ]);

      const ответ = await askWarehouse(db, 'сколько продалось пуэра за август');

      expect(ответ.result?.rows[0]).toEqual(['Шу Пуэр Золотой Бутон']);
      expect(ответ.comment).toBe('Возвраты помечены иначе.');

      // Спросили дважды, и во второй раз сказали, на чём сели.
      expect(calls).toHaveLength(2);
      const второй = JSON.stringify(calls[1].body);
      expect(второй).toContain('refunded_at');
      expect(второй).toContain('no such column');
      // Исходный вопрос тоже на месте — иначе исправлять нечего.
      expect(второй).toContain('сколько продалось пуэра за август');
    });

    /**
     * Второй промах — уже не описка. Крутить это по кругу значит молча жечь
     * деньги на счёте владельца.
     */
    it('на второй промах сдаётся и говорит об этом, а не спрашивает третий раз', async () => {
      модельПоОчереди(['```sql\nSELECT nope FROM sales\n```']);

      await expect(askWarehouse(db, 'вопрос')).rejects.toThrow(/дважды ошибся/);
      expect(calls).toHaveLength(2);
    });

    /** Правку базы не переспрашивают: это не описка, а то, чего нельзя. */
    it('за правку базы не переспрашивает вовсе', async () => {
      модельПоОчереди(['```sql\nDELETE FROM products\n```']);

      await expect(askWarehouse(db, 'удали товары')).rejects.toThrow(/только чтение/);
      expect(calls).toHaveLength(1);
    });
  });

  describe('ошибки модели — словами, а не кодами', () => {
    beforeEach(() => {
      saveAskSettings(db, { kind: 'gemini', key: 'AIza-wrong', model: '' });
    });

    const отказ = (status: number, body: unknown) => {
      globalThis.fetch = (async () => ({
        ok: false,
        status,
        text: async () => JSON.stringify(body),
      })) as unknown as typeof fetch;
    };

    it('неверный ключ', async () => {
      отказ(401, { error: { message: 'invalid x-api-key' } });
      await expect(askWarehouse(db, 'вопрос')).rejects.toThrow(/не приняла ключ/);
    });

    /** Кончившиеся деньги — не поломка программы, и сказать надо про счёт. */
    it('кончились деньги на счёте', async () => {
      отказ(429, {});
      await expect(askWarehouse(db, 'вопрос')).rejects.toThrow(/кончились деньги/);
    });

    it('такой модели нет', async () => {
      отказ(404, { error: { message: 'model not found' } });
      await expect(askWarehouse(db, 'вопрос')).rejects.toThrow(/Такой модели нет/);
    });

    /**
     * Ключ с русскими буквами.
     *
     * Нашлось на живой проверке, и жаль, что не раньше: заголовок запроса
     * держит только латиницу, и `fetch` валится ещё до того, как что-то
     * уйдёт. А программа на это отвечала «проверьте интернет» — то есть
     * посылала искать поломку там, где её нет. Набрать ключ в русской
     * раскладке — обычное дело, и сказать надо именно про это.
     */
    it('русская буква в ключе — про неё и говорит, а не про интернет', async () => {
      saveAskSettings(db, { kind: 'gemini', key: 'AIza-мой-ключ', model: '' });
      let ходилиВСеть = false;
      globalThis.fetch = (async () => {
        ходилиВСеть = true;
        return { ok: true, status: 200, text: async () => '{}' };
      }) as unknown as typeof fetch;

      await expect(askWarehouse(db, 'вопрос')).rejects.toThrow(/русской раскладке/);
      // И в сеть за этим не ходили: незачем.
      expect(ходилиВСеть).toBe(false);
    });

    /**
     * Из программы, открытой файлом, до модели бывает не дозвониться — и
     * человек должен услышать, что делать, а не «Failed to fetch».
     */
    it('не дозвонились вовсе', async () => {
      saveAskSettings(db, { kind: 'gemini', key: 'AIza-latin', model: '' });
      globalThis.fetch = (async () => {
        throw new Error('Failed to fetch');
      }) as unknown as typeof fetch;

      await expect(askWarehouse(db, 'вопрос')).rejects.toThrow(/Проверьте интернет/);
    });

    it('модель прислала правку базы — до базы она не дойдёт', async () => {
      saveAskSettings(db, { kind: 'gemini', key: 'AIza-mine', model: '' });
      модель(ответМодели('Сейчас удалю.\n```sql\nDELETE FROM products\n```'));

      await expect(askWarehouse(db, 'удали все товары')).rejects.toBeInstanceOf(ServerError);
      // Товар на месте.
      expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM products')?.n).toBe(1);
    });
  });

  /**
   * Чат: память разговора и ответы обычным текстом.
   */
  describe('чат', () => {
    const ловить = (ответ: string) => {
      globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
        calls.push({
          url: String(url),
          headers: (init.headers ?? {}) as Record<string, string>,
          body: init.body ? JSON.parse(String(init.body)) : undefined,
        });
        return ответМодели(ответ);
      }) as unknown as typeof fetch;
    };

    it('прежний разговор уезжает модели — «а в июле?» понимается', async () => {
      saveAskSettings(db, { kind: 'gemini', key: 'AIza-mine', model: '' });
      ловить('```sql\nSELECT 3 AS n\n```');

      await askWarehouse(db, 'а в июле?', {
        чат: true,
        история: [
          { роль: 'user', текст: 'сколько продали в августе' },
          { роль: 'assistant', текст: 'Считаю август.\n\n```sql\nSELECT 1\n```' },
        ],
      });

      const { messages } = calls[0].body;
      // Правила идут первой репликой «system», дальше — разговор.
      expect(messages.map((m: { role: string }) => m.role)).toEqual([
        'system',
        'user',
        'assistant',
        'user',
      ]);
      expect(messages[0].content).toContain('Это разговор');
      expect(messages[3].content).toBe('а в июле?');
    });

    it('совет приходит текстом, целиком, и в базу не лезет', async () => {
      saveAskSettings(db, { kind: 'gemini', key: 'AIza-mine', model: '' });
      const совет = 'Сделайте дегустацию по субботам. '.repeat(30).trim();
      ловить(совет);

      const ответ = await askWarehouse(db, 'как поднять продажи?', { чат: true });

      expect(ответ.sql).toBe('');
      expect(ответ.result).toBeNull();
      expect(ответ.comment).toBe(совет);
    });

    it('без чата всё по-старому: правила без разговорной добавки', async () => {
      saveAskSettings(db, { kind: 'gemini', key: 'AIza-mine', model: '' });
      ловить('```sql\nSELECT 1\n```');

      await askWarehouse(db, 'вопрос');

      expect(calls[0].body.messages[0].content).not.toContain('Это разговор');
      expect(calls[0].body.messages).toHaveLength(2);
    });

    it('память ограничена — вчерашняя переписка не оплачивается заново', async () => {
      saveAskSettings(db, { kind: 'gemini', key: 'AIza-mine', model: '' });
      ловить('```sql\nSELECT 1\n```');

      const длинная = Array.from({ length: 30 }, (_, i) => ({
        роль: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
        текст: `реплика ${i}`,
      }));
      await askWarehouse(db, 'вопрос', { чат: true, история: длинная });

      // Правила, десять прежних и новый вопрос.
      expect(calls[0].body.messages).toHaveLength(12);
    });
  });

  describe('настройки', () => {
    it('пустые по умолчанию — ничего никуда не уходит само', () => {
      // По умолчанию Gemini: из троих только у него есть бесплатный ключ.
      expect(getAskSettings(db)).toEqual({ kind: 'gemini', key: '', model: '' });
    });

    it('выбранный раньше ДипСик не слетает', () => {
      // До GPT и Gemini ДипСик хранился под именем `openai` — он говорит на
      // языке запросов OpenAI. У кого он был выбран, у того и остаётся.
      db.run("INSERT INTO app_state (key, value) VALUES ('assistant', ?)", [
        JSON.stringify({ kind: 'openai', key: 'sk-old', model: '' }),
      ]);
      expect(getAskSettings(db)).toEqual({ kind: 'deepseek', key: 'sk-old', model: '' });
    });

    it('непонятное сохранённое — это Gemini, а не поломка', () => {
      db.run("INSERT INTO app_state (key, value) VALUES ('assistant', ?)", [
        JSON.stringify({ kind: 'что-то-своё', key: 'k', model: '' }),
      ]);
      expect(getAskSettings(db).kind).toBe('gemini');
    });

    it('у каждой конторы свой ключ — переключение ключи не путает', () => {
      saveAskSettings(db, { kind: 'gemini', key: 'AIza-g', model: '' });
      saveAskSettings(db, { kind: 'deepseek', key: 'sk-d', model: 'deepseek-reasoner' });

      expect(getAskSettings(db)).toEqual({ kind: 'deepseek', key: 'sk-d', model: 'deepseek-reasoner' });

      chooseAskKind(db, 'gemini');
      // Ключ Gemini на месте, модель ДипСика к нему не приклеилась.
      expect(getAskSettings(db)).toEqual({ kind: 'gemini', key: 'AIza-g', model: '' });
      expect(hasAskKey(db, 'gpt')).toBe(false);
      expect(hasAskKey(db, 'deepseek')).toBe(true);
    });

    it('запоминаются и переписываются', () => {
      saveAskSettings(db, { kind: 'deepseek', key: 'sk-1', model: 'своя-модель' });
      expect(getAskSettings(db)).toEqual({ kind: 'deepseek', key: 'sk-1', model: 'своя-модель' });

      saveAskSettings(db, { kind: 'gemini', key: '', model: '' });
      expect(getAskSettings(db).key).toBe('');
    });
  });

  describe('разбор ответа модели', () => {
    it('берёт запрос из блока и пояснение перед ним', () => {
      const ответ = разобрать('Смотрю продажи за месяц.\n\n```sql\nSELECT 1\n```\n');
      expect(ответ.sql).toBe('SELECT 1');
      expect(ответ.comment).toBe('Смотрю продажи за месяц.');
    });

    it('находит запрос и без блока', () => {
      expect(разобрать('Вот запрос:\nSELECT name FROM products LIMIT 5').sql).toBe(
        'SELECT name FROM products LIMIT 5',
      );
    });

    it('отказ передаёт словами', () => {
      const ответ = разобрать('НЕЛЬЗЯ: в базе не хранится, откуда пришёл покупатель.');
      expect(ответ.sql).toBe('');
      expect(ответ.comment).toMatch(/не хранится/);
    });
  });
});
