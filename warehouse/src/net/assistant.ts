import type { SqlDriver } from '../db/driver';
import { getServer } from '../db/server';
import { describeSchema } from '../db/askSchema';
import { askTarget, getAskSettings, type AskSettings } from '../db/askSettings';
import { runSql, UnsafeSql, type AskResult } from '../db/ask';
import { askSystem, разобрать } from '../domain/askPrompt';
import { ServerError } from './server';

/**
 * Спросить у своего склада.
 *
 * Считает всегда само устройство, по местной базе. Наружу уезжает вопрос и
 * описание таблиц — «есть products с колонками name, sale_price…», — и ни
 * одной строки данных: ни выручки, ни телефонов клиентов. Обратно приезжает
 * запрос, и вот он-то и выполняется здесь.
 *
 * Спросить можно двумя способами, и они не взаимозаменяемы:
 *
 *   • **своим ключом** — вопрос идёт к модели прямо отсюда. Ничего поднимать
 *     не надо, работает сразу; ключ лежит в базе устройства, не в файле
 *     программы, и его можно переслать кому угодно, не выдав ключ;
 *   • **через сервер магазина** — ключ на сервере. Так это и должно работать
 *     для чужих магазинов по подписке: своего ключа они не покупают.
 *
 * Если задан свой ключ, идём им: он ближе, быстрее и не зависит от того,
 * поднят ли сервер.
 */

export interface Ответ {
  /** Что помощник собрался считать, обычными словами. */
  comment: string;
  /** Запрос, которым он это посчитал. Показывается человеку целиком. */
  sql: string;
  /** Посчитанное. Пусто, если помощник отказался отвечать. */
  result: AskResult | null;
  /** Кем считали — это видно на экране, чтобы не гадать, куда ушёл вопрос. */
  через: 'ключ' | 'сервер';
}

/** Готов ли помощник отвечать и каким способом. */
export function askWay(db: SqlDriver): 'ключ' | 'сервер' | null {
  if (getAskSettings(db).key.trim()) return 'ключ';
  const link = getServer(db);
  return link?.url && link.token ? 'сервер' : null;
}

export async function askWarehouse(db: SqlDriver, question: string): Promise<Ответ> {
  const way = askWay(db);

  if (way === null) {
    throw new ServerError(
      'Помощник ещё не настроен. Впишите свой ключ модели ниже — или войдите ' +
        'в учётную запись магазина, если помощник настроен на сервере.',
    );
  }

  const schema = describeSchema(db);
  const спросить = (вопрос: string) =>
    way === 'ключ'
      ? спроситьСвоимКлючом(getAskSettings(db), schema, вопрос)
      : спроситьСервер(db, schema, вопрос);

  let { sql, comment } = await спросить(question);

  // Помощник отказался — так и скажем. Это честнее пустой таблицы.
  if (!sql) {
    return {
      comment: comment || 'Помощник не смог ответить на этот вопрос.',
      sql: '',
      result: null,
      через: way,
    };
  }

  try {
    return { comment, sql, result: runSql(db, sql), через: way };
  } catch (error) {
    // Запрос, который меняет базу, не переспрашиваем: это не описка, а то,
    // чего делать нельзя вовсе.
    if (error instanceof UnsafeSql) throw new ServerError(error.message);

    /**
     * База отказала — переспросим один раз, показав, на чём.
     *
     * Так и вышло на первом же живом вопросе: модель написала
     * `s.refunded_at`, а такой колонки у чеков нет. Человеку в этот момент
     * показывалась ошибка базы — то есть его просили самому разобраться в
     * чужом запросе. А достаточно сказать модели, что не так: ошибку она
     * исправляет сама почти всегда.
     *
     * Переспрашиваем ровно один раз. Второй промах — уже не описка, и
     * крутить это по кругу значит молча жечь деньги на счёте.
     */
    const сказала = error instanceof Error ? error.message : String(error);
    const второй = await спросить(
      `${question}\n\nПредыдущая попытка не сработала. Вот запрос:\n${sql}\n\n` +
        `База ответила: ${сказала}\n\n` +
        'Исправь запрос. Колонок, которых нет в описании таблиц, не используй — ' +
        'сверься с ним заново. Ответь только исправленным запросом.',
    );

    if (!второй.sql) {
      throw new ServerError(`Запрос не выполнился: ${сказала}\n\n${sql}`);
    }

    try {
      return {
        comment: второй.comment || comment,
        sql: второй.sql,
        result: runSql(db, второй.sql),
        через: way,
      };
    } catch (снова) {
      if (снова instanceof UnsafeSql) throw new ServerError(снова.message);
      const опять = снова instanceof Error ? снова.message : String(снова);
      throw new ServerError(
        `Помощник дважды ошибся в запросе, и я его не выполнил.\n\n` +
          `Сперва: ${сказала}\nПотом: ${опять}\n\n${второй.sql}\n\n` +
          'Попробуйте спросить другими словами — или другой моделью.',
      );
    }
  }
}

/**
 * Свой ключ: вопрос идёт к модели напрямую из программы.
 *
 * Клод для такого просит отдельный заголовок — `anthropic-dangerous-direct-
 * browser-access`. Название пугающее, и не зря: он подтверждает, что ключ
 * лежит у того, кто спрашивает, а не роздан посетителям сайта. У нас именно
 * так — программа стоит у хозяина, ключ его.
 */
async function спроситьСвоимКлючом(
  settings: AskSettings,
  schema: string,
  question: string,
): Promise<{ sql: string; comment: string }> {
  const { url, model } = askTarget(settings);
  const system = askSystem(schema);
  const key = settings.key.trim();

  // Ключ уезжает заголовком, а в заголовок пролезают только латинские буквы.
  // Русская буква в ключе валит запрос до того, как он уйдёт, — и программа
  // до этой проверки честно, но неверно жаловалась на интернет. Такое бывает
  // не от глупости: набрал в русской раскладке или скопировал с переносом.
  const чужаяБуква = [...key].find((буква) => буква.charCodeAt(0) > 255);
  if (чужаяБуква) {
    throw new ServerError(
      `В ключе есть буква «${чужаяБуква}» — в ключах бывают только латинские буквы и цифры. ` +
        'Похоже, он набран в русской раскладке или скопирован не целиком. Впишите заново.',
    );
  }

  const тело =
    settings.kind === 'claude'
      ? {
          model,
          max_tokens: 1_500,
          system,
          messages: [{ role: 'user', content: question }],
        }
      : {
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: question },
          ],
        };

  const headers: Record<string, string> =
    settings.kind === 'claude'
      ? {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        }
      : { 'content-type': 'application/json', authorization: `Bearer ${key}` };

  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(тело) });
  } catch {
    // Из программы, открытой файлом, до чужого сервера бывает не дозвониться:
    // либо нет интернета, либо контора модели не разрешает такие запросы из
    // браузера. Второе лечится сервером магазина, и об этом надо сказать.
    throw new ServerError(
      'Не получилось дозвониться до модели. Проверьте интернет. Если интернет есть, ' +
        'значит эта модель не отвечает на запросы прямо из программы — тогда помощнику ' +
        'нужен сервер магазина.',
    );
  }

  const text = await response.text();
  let answer: Record<string, unknown> = {};
  try {
    answer = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    answer = {};
  }

  if (!response.ok) throw new ServerError(словамиОбОшибке(response.status, answer));

  const said =
    settings.kind === 'claude'
      ? ((answer.content as { type: string; text?: string }[] | undefined) ?? [])
          .filter((part) => part.type === 'text')
          .map((part) => part.text ?? '')
          .join('\n')
      : ((answer.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message
          ?.content ?? '');

  if (!said.trim()) throw new ServerError('Модель ответила пусто. Попробуйте ещё раз.');
  return разобрать(said);
}

/**
 * Ошибка модели — человеческими словами.
 *
 * Кончившиеся деньги на счёте — не поломка программы, и хозяин должен узнать
 * об этом словами, а не по коду 429.
 */
function словамиОбОшибке(status: number, answer: Record<string, unknown>): string {
  const error = answer.error as { message?: string; type?: string } | string | undefined;
  const сказала = (typeof error === 'string' ? error : error?.message ?? '').trim();

  if (status === 401 || status === 403) {
    return `Модель не приняла ключ. Проверьте, что вписан он целиком.${сказала ? ` Ответ: ${сказала}` : ''}`;
  }
  if (status === 429) {
    return 'Модель отвечает «слишком часто» или на счёте кончились деньги. Проверьте счёт в личном кабинете модели.';
  }
  if (status === 404) {
    return `Такой модели нет. Проверьте название модели в настройках помощника.${сказала ? ` Ответ: ${сказала}` : ''}`;
  }
  return сказала || `Модель ответила ошибкой ${status}.`;
}

/** Через сервер магазина: ключ там, наружу от нас уходит только вопрос. */
async function спроситьСервер(
  db: SqlDriver,
  schema: string,
  question: string,
): Promise<{ sql: string; comment: string }> {
  const link = getServer(db)!;

  let response: Response;
  try {
    response = await fetch(`${link.url.replace(/\/+$/, '')}/api/v1/assistant/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${link.token}` },
      body: JSON.stringify({ question, schema }),
    });
  } catch {
    throw new ServerError('Нет связи с сервером. Помощнику нужен интернет, складу — нет.');
  }

  const text = await response.text();
  let answer: {
    sql?: string;
    comment?: string;
    // Настоящий сервер говорит объектом, чужой или старый — строкой.
    error?: string | { message?: string };
  } = {};
  try {
    answer = text ? JSON.parse(text) : {};
  } catch {
    answer = {};
  }

  if (!response.ok) {
    const one = answer.error;
    const said = (typeof one === 'string' ? one : one?.message ?? '').trim();
    throw new ServerError(said || `Помощник не ответил (ошибка ${response.status}).`);
  }

  return { sql: (answer.sql ?? '').trim(), comment: (answer.comment ?? '').trim() };
}
