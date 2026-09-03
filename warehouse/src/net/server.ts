import type { SqlDriver } from '../db/driver';
import { getServer, markSynced, saveSignIn } from '../db/server';
import { applyPull, fillUids, forgetOutbox, outbox, type Payload } from '../db/sync';

/**
 * Разговор с сервером магазина.
 *
 * Здесь только сеть и перевод его ответов на человеческий. Слияние баз —
 * в `src/db/sync.ts`, и это намеренно: сеть можно подменить в проверке, а
 * правила слияния должны проверяться без неё вовсе.
 *
 * Об ошибках. Сервер отвечает кодом и полем `error`, но человеку у кассы
 * нужен не код, а что делать. Поэтому каждый случай назван словами:
 * «неверная почта или пароль», «нет связи», «такая почта уже занята».
 * Молчаливого «что-то пошло не так» здесь нет.
 */

export interface Session {
  token: string;
  org: string;
  orgName?: string | null;
  userId: string;
  userName: string;
  role: string;
}

interface UserAnswer {
  token?: string;
  user?: { id?: string; org_id?: string; name?: string; email?: string; role?: string };
  error?: string;
  message?: string;
}

/** Ошибка, которую не стыдно показать человеку целиком. */
export class ServerError extends Error {}

async function call(
  url: string,
  path: string,
  init: { method?: string; token?: string | null; body?: unknown } = {},
): Promise<unknown> {
  const address = `${url.replace(/\/+$/, '')}${path}`;

  let response: Response;
  try {
    response = await fetch(address, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    // Сети нет — это не поломка программы, а обычное дело в подвале с чаем.
    throw new ServerError('Нет связи с сервером. Проверьте интернет и адрес сервера.');
  }

  const text = await response.text();
  let answer: UserAnswer = {};
  try {
    answer = text ? (JSON.parse(text) as UserAnswer) : {};
  } catch {
    answer = {};
  }

  if (!response.ok) {
    const said = (answer.error ?? answer.message ?? '').trim();
    if (said) throw new ServerError(said);

    if (response.status === 401) throw new ServerError('Сервер не принял вход. Войдите заново.');
    if (response.status === 403) throw new ServerError('Не хватает прав для этого действия.');
    if (response.status === 404) {
      throw new ServerError('По этому адресу сервера склада нет. Проверьте адрес.');
    }
    throw new ServerError(`Сервер ответил ошибкой ${response.status}.`);
  }

  return answer;
}

function session(answer: unknown): Session {
  const one = answer as UserAnswer;
  const token = one.token;
  const user = one.user;

  if (!token || !user?.id || !user.org_id) {
    throw new ServerError('Сервер ответил не тем: в ответе нет входа. Проверьте адрес сервера.');
  }

  return {
    token,
    org: user.org_id,
    userId: user.id,
    userName: (user.name ?? '').trim() || (user.email ?? ''),
    role: user.role ?? 'owner',
  };
}

/** Завести магазин: организация, владелец и первая точка. */
export async function register(
  db: SqlDriver,
  url: string,
  input: { orgName: string; name: string; email: string; password: string },
): Promise<Session> {
  const who = session(
    await call(url, '/api/v1/auth/register', {
      method: 'POST',
      body: {
        org_name: input.orgName,
        name: input.name,
        email: input.email,
        password: input.password,
      },
    }),
  );

  saveSignIn(db, url, { ...who, orgName: input.orgName });
  return who;
}

/** Войти в заведённый магазин. */
export async function signIn(
  db: SqlDriver,
  url: string,
  input: { email: string; password: string; device?: string },
): Promise<Session> {
  const who = session(
    await call(url, '/api/v1/auth/login', {
      method: 'POST',
      body: { email: input.email, password: input.password, device_name: input.device },
    }),
  );

  saveSignIn(db, url, who);
  return who;
}

export interface SyncReport {
  sent: number;
  added: number;
  updated: number;
  skipped: number;
  cursor: number;
  /**
   * Что мы отправили, а сервер этого не знает.
   *
   * Так однажды и потерялась клиентская база: телефон честно отправлял три
   * тысячи покупателей, сервер про такую таблицу не знал и выбрасывал их
   * молча, а человеку показывалось бодрое «отправлено 4690». Теперь это
   * видно, и видно сразу.
   */
  ignored: string[];
}

/**
 * Обмен: сперва отдать своё, потом забрать чужое.
 *
 * Порядок именно такой. Если сначала забрать, а потом отдать, то чек,
 * пробитый на этом устройстве минуту назад, уедет уже после того, как мы
 * скажем «всё сошлось» — и на другом телефоне его не будет до следующего
 * раза. Отдать первым дешевле: сервер к повторам готов.
 *
 * И одно исключение — самый первый обмен после входа. Тут устройство ещё
 * ничего про магазин не знает, а магазин, скорее всего, уже заведён: те же
 * точки, те же товары, только под другими именами. Отдать первым — значит
 * завести на сервере вторую «Чайную лавку» и второй «Пуэр Шу». Поэтому в
 * первый раз мы сперва слушаем: узнаём свои же записи в присланных и берём
 * их имена, и только потом отдаём — уже под общими именами. Терять тут
 * нечего: до первого входа никаких чеков «в дороге» не бывает, а отдаём мы
 * всё равно в этом же вызове.
 */
export async function syncNow(db: SqlDriver): Promise<SyncReport> {
  const link = getServer(db);
  if (!link?.url || !link.token) {
    throw new ServerError('Устройство не связано с сервером. Войдите в учётную запись магазина.');
  }

  const первый = link.pulled === 0;

  let applied = { added: 0, updated: 0, skipped: 0 };
  let cursor = link.pulled;

  /**
   * Забрать чужое — всё, а не первые пятьсот записей.
   *
   * Сервер отдаёт порциями: за раз столько, сколько влезает в один ответ.
   * Значит, спрашивать надо, пока он не скажет «больше нет» — иначе после
   * первого входа человеку пришлось бы жать «Синхронизировать» десять раз
   * подряд, и он бы справедливо решил, что программа врёт.
   *
   * Признак конца — счётчик, который перестал двигаться. Считать порции по
   * их размеру ненадёжно: сервер вправе отдать меньше запрошенного.
   * Ограничение сверху всё же есть: если счётчик почему-то поедет вечно,
   * обмен должен кончиться сам, а не крутиться до разряженной батареи.
   */
  const забрать = async () => {
    for (let порция = 0; порция < 200; порция += 1) {
      const answer = (await call(
        link.url,
        `/api/v1/sync/pull?since=${cursor}&limit=500`,
        { token: link.token },
      )) as { cursor?: number; changes?: Payload };

      const one = applyPull(db, answer.changes ?? {});
      applied = {
        added: applied.added + one.added,
        updated: applied.updated + one.updated,
        skipped: applied.skipped + one.skipped,
      };

      const next = Number(answer.cursor ?? cursor) || cursor;
      const дальше = next > cursor;
      cursor = next;
      markSynced(db, cursor);

      if (!дальше) return;
    }
  };

  // Первый обмен: сперва выслушать сервер, чтобы узнать свои записи в чужих.
  if (первый) await забрать();

  // Записи, заведённые до синхронизации, своего имени не имеют — дадим.
  fillUids(db);

  const { payload, marks } = outbox(db);
  const sent = Object.values(payload).reduce((sum, rows) => sum + (rows?.length ?? 0), 0);

  let ignored: string[] = [];

  if (sent > 0) {
    const answer = (await call(link.url, '/api/v1/sync/push', {
      method: 'POST',
      token: link.token,
      body: payload,
    })) as { ignored?: string[] };

    ignored = Array.isArray(answer.ignored) ? answer.ignored : [];

    // Вычёркиваем только после того, как сервер сказал «принял». Если связь
    // оборвалась на полпути, отправим то же самое ещё раз — сервер к
    // повторам готов, а вот потерянный чек не вернёт никто.
    forgetOutbox(db, marks);
  }

  if (!первый) await забрать();

  return { sent, cursor, ignored, ...applied };
}
