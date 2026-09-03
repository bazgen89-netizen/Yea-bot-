import { ApiError, badRequest } from './errors.ts';

/**
 * Помощник: вопрос словами → запрос к своему складу.
 *
 * Устроено намеренно так, что **данные магазина никуда не уходят**. Наружу, к
 * модели, уезжает только вопрос и описание таблиц — «есть таблица products с
 * колонками name, sale_price…». Ни телефонов, ни чеков, ни выручки. Модель
 * возвращает запрос, а считает по нему само устройство, у себя. Поэтому на
 * вопрос «кто из клиентов давно не заходил» ответ будет, а список имён при
 * этом не покажут никому постороннему.
 *
 * Это не только про закон о персональных данных. Это то, что честно сказать
 * магазину, который спросит: «а вы мою базу никому не отдаёте?»
 *
 * Ключ от модели живёт здесь, на сервере, и это второе, ради чего помощник
 * серверный: ключ — это деньги владельца, и в файле, который скачивает
 * каждый, ему не место.
 */

/** Кто отвечает. Разные конторы — разный разговор, но дело одно. */
export type ModelKind = 'claude' | 'openai';

export interface ModelSettings {
  kind: ModelKind;
  url: string;
  key: string;
  model: string;
}

/**
 * Настройки берутся из окружения — не из кода и не из базы.
 *
 * `ASSISTANT_KIND` переключает между Клодом и всеми, кто говорит как OpenAI
 * (ДипСик в их числе). Больше ничего менять не надо: код один, отличаются
 * адрес, ключ и название модели.
 */
export function modelFromEnv(env: NodeJS.ProcessEnv = process.env): ModelSettings | null {
  const key = (env.ASSISTANT_KEY ?? '').trim();
  if (!key) return null;

  const kind: ModelKind = env.ASSISTANT_KIND === 'openai' ? 'openai' : 'claude';

  const url =
    (env.ASSISTANT_URL ?? '').trim() ||
    (kind === 'claude'
      ? 'https://api.anthropic.com/v1/messages'
      : 'https://api.deepseek.com/chat/completions');

  const model =
    (env.ASSISTANT_MODEL ?? '').trim() || (kind === 'claude' ? 'claude-opus-5' : 'deepseek-chat');

  return { kind, url, key, model };
}

/** Чем отвечает модель. Отдельным типом — чтобы в проверках её подменять. */
export type Ask = (system: string, question: string) => Promise<string>;

/**
 * Правила, по которым пишется запрос.
 *
 * Половина этого текста — про то, чего в чужой базе не угадать: деньги здесь
 * целые копейки, количества — тысячные доли, а остатка нет отдельным числом,
 * он всегда сумма движений. Не сказать об этом — и помощник насчитает
 * выручку в сто раз больше настоящей, причём уверенно.
 */
export const RULES = `Ты помощник владельца небольшого магазина. Тебе задают вопрос
про его склад обычными словами, а ты отвечаешь ОДНИМ запросом SQLite, который на этот
вопрос отвечает.

Как устроены числа в этой базе — это важнее всего остального:

* Деньги хранятся целыми копейками. 10000 — это сто рублей. Чтобы показать рубли,
  дели на 100.0 и округляй: ROUND(SUM(total) / 100.0, 2).
* Количества хранятся целыми тысячными долями. Дели на 1000.0.
* У КАЖДОГО ТОВАРА СВОЯ ЕДИНИЦА — она лежит в products.unit ('шт', 'гр', 'кг' и
  другие). Количество в тысячных — это доли ИМЕННО ЭТОЙ единицы: 2000 у товара с
  unit 'гр' — это два грамма, а у товара с unit 'шт' — две штуки.
  НИКОГДА не пиши единицу в названии колонки наугад и не пиши «кг» или «шт/кг».
  Вместо этого добавляй отдельную колонку с единицей: p.unit AS "Ед.", а колонку
  с числом называй просто "Продано" или "Остаток".
  Складывать количества разных товаров в одну сумму нельзя — граммы и штуки не
  складываются. Если группируешь по единице, приводи её к общему виду:
  lower(trim(p.unit)) — в базе встречается и 'гр', и 'гр.', и 'Шт'.
* Остатка товара НЕТ отдельной колонкой. Остаток — это всегда
  SUM(stock_moves.qty_delta) по товару. Приход плюсом, продажа минусом.
* Даты хранятся строками вида '2026-09-03T08:00:00.000Z'. Сравнивай их как строки:
  created_at >= '2026-08-01'. Для месяца бери substr(created_at, 1, 7).
  «За август» без года — это август текущего года, а не все августы подряд.
* ПОИСК ПО НАЗВАНИЮ ТОВАРА — ТОЛЬКО через products.search_text.
  SQLite не умеет приводить русские буквы к строчным: lower('Москва') так и
  останется 'Москва', и LIKE '%москва%' её НЕ найдёт. Товары названы вразнобой,
  одно и то же слово встречается и с заглавной, и со строчной, поэтому
  lower(p.name) LIKE '%слово%' находит малую часть и молча врёт: таблица выйдет
  куцая, а человек решит, что столько и есть.
  В search_text уже лежит название строчными (плюс артикул, код и штрихкод), и
  сравнивать надо с ним, а слово в запросе писать строчными:
  p.search_text LIKE '%слово%'. Для контрагентов так же — counterparties.search_text.
  Никогда не пиши lower() и upper() над русским текстом: они ничего не делают.

Как отвечать:

* Только один запрос, только SELECT (можно WITH ... SELECT). Ничего, что меняет базу.
* Всегда давай колонкам понятные русские названия через AS: "Товар", "Продано",
  "Ед.", "Выручка, ₽". Знак рубля в названии колонки с деньгами ставить можно —
  валюта одна. Единицу товара — нельзя, она у каждого своя.
* Не обрезай ответ без нужды. LIMIT ставь только там, где спрашивают лучшее или
  худшее — «топ-10», «что продавалось лучше всего»; там 10-20 строк. Если спросили
  «сколько» или «какие» без слова «топ», отдавай ВСЁ, что нашлось: программа сама
  покажет первые двести строк и напишет, сколько всего. Короткий список там, где
  человек ждал полный, читается как «столько и есть» — и это враньё.
* ВСЕГДА ставь ORDER BY по главному числу и ПО УБЫВАНИЮ — сперва самое большое.
  Спрашивают «сколько продано» — сверху должно быть то, чего продано больше всего,
  а не то, что попалось первым. Если чисел несколько, упорядочивай по деньгам.
* Когда спрашивают «сколько продано», кроме разбивки по товарам давай и общий итог
  — отдельной строкой или колонкой с суммой.
* Не выдумывай колонок, которых нет в описании. Если вопрос не получается свести к
  запросу, ответь одной строкой: НЕЛЬЗЯ: и коротким объяснением, чего не хватает.

Формат ответа. Сначала одна строка обычными словами — что ты считаешь. Потом запрос
в блоке \`\`\`sql. Больше ничего.`;

export interface Answer {
  /** Запрос, который посчитает ответ. Пустой, если помощник отказался. */
  sql: string;
  /** Что он собрался считать — одной строкой, обычными словами. */
  comment: string;
}

/**
 * Спросить у модели.
 *
 * `schema` присылает само устройство: это описание его таблиц, а не секрет.
 * Так оно и правильно — устройство может быть новее сервера, и кто, как не
 * оно, знает, какие у него колонки.
 */
export async function ask(
  ask: Ask,
  input: { question: string; schema: string },
): Promise<Answer> {
  const question = input.question.trim();
  if (!question) throw badRequest('Вопрос пустой.');
  if (question.length > 2_000) throw badRequest('Вопрос слишком длинный.');

  const system = `${RULES}\n\nВот таблицы этого магазина:\n\n${input.schema.trim()}`;
  const said = await ask(system, question);

  return parse(said);
}

/**
 * Достать запрос из ответа модели.
 *
 * Модель просят отвечать одним блоком \`\`\`sql, и обычно она так и делает. Но
 * «обычно» — не «всегда», поэтому запрос ищется и без блока: по первому
 * SELECT или WITH. Лучше разобрать неаккуратный ответ, чем сказать человеку
 * «что-то пошло не так» на ровном месте.
 */
export function parse(said: string): Answer {
  const text = said.trim();

  const отказ = text.match(/НЕЛЬЗЯ:\s*(.+)/i);
  if (отказ) return { sql: '', comment: отказ[1].trim() };

  const блок = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  const sql = (блок ? блок[1] : (text.match(/\b(?:WITH|SELECT)\b[\s\S]*/i)?.[0] ?? '')).trim();

  if (!sql) {
    return { sql: '', comment: text.slice(0, 500) || 'Помощник не ответил.' };
  }

  // Пояснение — то, что стояло до запроса. Если модель его не написала,
  // выдумывать за неё нечего: экран покажет сам запрос.
  const before = text.slice(0, блок ? text.indexOf(блок[0]) : text.indexOf(sql)).trim();
  const comment = before.split('\n').filter(Boolean).pop()?.trim() ?? '';

  return { sql, comment };
}

/** Разговор с Клодом. */
export function claudeAsk(settings: ModelSettings): Ask {
  return async (system, question) => {
    const response = await fetch(settings.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 1_500,
        system,
        messages: [{ role: 'user', content: question }],
      }),
    });

    const body = (await read(response)) as { content?: { type: string; text?: string }[] };
    return (body.content ?? [])
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('\n');
  };
}

/** Разговор с теми, кто говорит как OpenAI, — ДипСик в том числе. */
export function openaiAsk(settings: ModelSettings): Ask {
  return async (system, question) => {
    const response = await fetch(settings.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${settings.key}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: question },
        ],
      }),
    });

    const body = (await read(response)) as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content ?? '';
  };
}

/**
 * Ответ модели, переведённый на человеческий.
 *
 * Про деньги отдельно: кончившийся счёт — не поломка программы, и владелец
 * должен узнать об этом словами, а не по коду 429.
 */
async function read(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(502, 'assistant_key', 'Помощник не принял ключ. Проверьте ключ модели.');
    }
    if (response.status === 429) {
      throw new ApiError(
        502,
        'assistant_busy',
        'Помощник сейчас занят или кончились оплаченные запросы. Попробуйте позже.',
      );
    }
    throw new ApiError(502, 'assistant_failed', 'Помощник не ответил. Попробуйте ещё раз.');
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(502, 'assistant_failed', 'Помощник ответил непонятным. Попробуйте ещё раз.');
  }
}

/** Собрать разговор по настройкам окружения. */
export function askFromEnv(env: NodeJS.ProcessEnv = process.env): Ask | null {
  const settings = modelFromEnv(env);
  if (!settings) return null;
  return settings.kind === 'claude' ? claudeAsk(settings) : openaiAsk(settings);
}
