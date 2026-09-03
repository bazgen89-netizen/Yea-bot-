import type { SqlDriver } from '../db/driver';
import { getServer } from '../db/server';
import { describeSchema } from '../db/askSchema';
import { runSql, UnsafeSql, type AskResult } from '../db/ask';
import { ServerError } from './server';

/**
 * Спросить у своего склада.
 *
 * Разговор идёт в два шага, и они намеренно разнесены:
 *
 *   1. вопрос и описание таблиц уезжают на сервер, тот спрашивает модель и
 *      возвращает запрос;
 *   2. запрос выполняется здесь, по местной базе.
 *
 * Из-за этого ни одна цифра магазина никуда не уходит — ни выручка, ни
 * телефоны клиентов. Считает устройство, у себя. И это же делает ответ
 * мгновенным: сеть нужна один раз, на короткий вопрос.
 */

export interface Ответ {
  /** Что помощник собрался считать, обычными словами. */
  comment: string;
  /** Запрос, которым он это посчитал. Показывается человеку целиком. */
  sql: string;
  /** Посчитанное. Пусто, если помощник отказался отвечать. */
  result: AskResult | null;
}

export async function askWarehouse(db: SqlDriver, question: string): Promise<Ответ> {
  const link = getServer(db);
  if (!link?.url || !link.token) {
    throw new ServerError(
      'Помощник живёт на сервере. Войдите в учётную запись магазина: ' +
        'Компания → Настройки → Синхронизация.',
    );
  }

  let response: Response;
  try {
    response = await fetch(`${link.url.replace(/\/+$/, '')}/api/v1/assistant/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${link.token}` },
      body: JSON.stringify({ question, schema: describeSchema(db) }),
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

  const sql = (answer.sql ?? '').trim();
  const comment = (answer.comment ?? '').trim();

  // Помощник отказался — так и скажем. Это честнее пустой таблицы.
  if (!sql) return { comment: comment || 'Помощник не смог ответить на этот вопрос.', sql: '', result: null };

  try {
    return { comment, sql, result: runSql(db, sql) };
  } catch (error) {
    if (error instanceof UnsafeSql) throw new ServerError(error.message);
    // Ошибка самой базы: помощник придумал колонку, которой нет. Говорим об
    // этом прямо и показываем запрос — по нему видно, где он ошибся.
    const сказала = error instanceof Error ? error.message : String(error);
    throw new ServerError(`Запрос не выполнился: ${сказала}`);
  }
}
