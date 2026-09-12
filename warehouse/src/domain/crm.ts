/**
 * CRM: кто из клиентов кто и кого пора возвращать.
 *
 * Здесь нет ни React, ни базы — только арифметика над тем, что уже посчитано
 * по чекам. Так и надо: «спящий клиент» — это не поле в базе, которое кто-то
 * должен не забыть проставить, а вывод из даты последней покупки. Поле
 * рассинхронизируется с историей ровно как хранимый остаток; вывод — нет.
 *
 * Все сроки считаются в днях и от переданного «сейчас», а не от `Date.now()`:
 * иначе тест на разделение клиентов по срокам ломался бы завтра.
 */

/** Миллисекунд в сутках. */
const ДЕНЬ = 86_400_000;

/**
 * Сколько дней ждать сверх обычного срока, прежде чем считать, что человек
 * пропал.
 *
 * Полтора обычных срока — не круглое число ради красоты. У Вазгена постоянный
 * покупатель приходит раз в 60 дней; ждать ровно 60 значит звонить каждому,
 * кто задержался на день, а ждать 120 — спохватываться, когда человек уже
 * нашёл другой чай.
 */
export const ЗАПАС = 1.5;

/** Дольше года — это уже не «задержался». */
export const ПОТЕРЯН_ДНЕЙ = 365;

/**
 * Обычный срок для того, о ком судить не по чему.
 *
 * Взят как медиана по постоянным покупателям самого магазина (`shopCadence`),
 * а 60 — только запасное значение на случай пустой базы.
 */
export const СРОК_ПО_УМОЛЧАНИЮ = 60;

export type Segment = 'none' | 'new' | 'regular' | 'sleeping' | 'lost';

export const SEGMENT_LABEL: Record<Segment, string> = {
  none: 'Без покупок',
  new: 'Новый',
  regular: 'Постоянный',
  sleeping: 'Пропал',
  lost: 'Потерян',
};

/** Что означает группа — словами, которые видит человек на экране. */
export const SEGMENT_NOTE: Record<Segment, string> = {
  none: 'Карточка есть, а покупок по ней ещё не было',
  new: 'Купил один раз. Вернётся или нет — решается сейчас',
  regular: 'Приходит вовремя, в свой обычный срок',
  sleeping: 'Покупал не раз, но не приходит дольше обычного. Этих и возвращают',
  lost: 'Не приходил больше года',
};

/** Порядок групп на экране: от тех, с кем работать, к тем, с кем поздно. */
export const SEGMENTS: Segment[] = ['sleeping', 'regular', 'new', 'lost', 'none'];

/** Всё, что нужно знать о клиенте, чтобы отнести его к группе. */
export interface ClientFacts {
  /** Сколько чеков пробито на его карточку. */
  receipts: number;
  /** Сумма покупок за всё время, копейки. */
  purchases: number;
  /** Первая и последняя покупка, ISO-строки, или null, если покупок не было. */
  first_sale_at: string | null;
  last_sale_at: string | null;
}

export interface Standing {
  segment: Segment;
  /** Его личный срок между покупками, дней. */
  cadence: number;
  /** Сколько дней прошло с последней покупки, или null, если покупок не было. */
  idle: number | null;
  /**
   * На сколько дней он опаздывает против своего срока. Ноль — пришёл вовремя,
   * отрицательных значений не бывает: «пришёл раньше» — это не опоздание.
   */
  overdue: number;
}

/** Сколько дней прошло с даты. Отрицательных не бывает: будущее — это ноль. */
export function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now - then) / ДЕНЬ));
}

/**
 * Личный срок между покупками.
 *
 * Считается как весь его срок жизни, делённый на число промежутков между
 * покупками. Для одной покупки промежутков нет вовсе, для двух — один, и
 * судить по нему рано: человек мог зайти дважды за неделю и потом пропасть на
 * полгода. Поэтому свой срок появляется с третьей покупки, до неё берётся
 * общий по магазину.
 */
export function cadence(facts: ClientFacts, shop = СРОК_ПО_УМОЛЧАНИЮ): number {
  if (facts.receipts < 3 || !facts.first_sale_at || !facts.last_sale_at) return shop;

  const first = new Date(facts.first_sale_at).getTime();
  const last = new Date(facts.last_sale_at).getTime();
  if (Number.isNaN(first) || Number.isNaN(last) || last <= first) return shop;

  const own = Math.round((last - first) / ДЕНЬ / (facts.receipts - 1));
  // День — не срок: у бара бывают клиенты, заходящие каждый день, но ждать от
  // них покупки завтра и звонить послезавтра нельзя.
  return Math.max(7, own);
}

/**
 * Обычный срок магазина — медиана личных сроков постоянных покупателей.
 *
 * Медиана, а не среднее: один оптовик, заходящий раз в год, сдвинул бы среднее
 * так, что «пропал» перестал бы значить что-либо для всех остальных.
 */
export function shopCadence(all: ClientFacts[]): number {
  const сроки = all
    .filter((one) => one.receipts >= 3)
    .map((one) => cadence({ ...one }, 0))
    .filter((days) => days > 0)
    .sort((a, b) => a - b);

  if (!сроки.length) return СРОК_ПО_УМОЛЧАНИЮ;

  // При чётном числе медиана — середина между двумя средними. Брать одно из
  // них значило бы, что срок магазина зависит от того, чётное сегодня число
  // клиентов или нет.
  const середина = Math.floor(сроки.length / 2);
  return сроки.length % 2
    ? сроки[середина]
    : Math.round((сроки[середина - 1] + сроки[середина]) / 2);
}

/**
 * К какой группе относится клиент.
 *
 * Группы не пересекаются: человек ровно в одной, иначе счётчики на экране не
 * сойдутся с суммой по группам, и верить им будет нельзя.
 */
export function standingOf(
  facts: ClientFacts,
  now: number,
  shop = СРОК_ПО_УМОЛЧАНИЮ,
): Standing {
  const срок = cadence(facts, shop);
  const idle = daysSince(facts.last_sale_at, now);

  if (facts.receipts <= 0 || idle === null) {
    return { segment: 'none', cadence: срок, idle: null, overdue: 0 };
  }

  const ждём = Math.round(срок * ЗАПАС);
  const overdue = Math.max(0, idle - ждём);

  if (idle > ПОТЕРЯН_ДНЕЙ) return { segment: 'lost', cadence: срок, idle, overdue };
  if (overdue > 0) {
    // Одна покупка — это ещё не «пропал»: он и не обещал возвращаться. Такой
    // человек новый ровно до того, как год пройдёт, и тогда он потерян.
    return { segment: facts.receipts >= 2 ? 'sleeping' : 'new', cadence: срок, idle, overdue };
  }

  return { segment: facts.receipts >= 2 ? 'regular' : 'new', cadence: срок, idle, overdue };
}

/**
 * Граница «крупного» клиента — сколько нужно принести, чтобы попасть в верхние
 * `share` долю по выручке.
 *
 * Это не группа, а отдельная отметка: крупный клиент бывает и постоянным, и
 * пропавшим, и второе куда важнее знать.
 */
export function vipThreshold(all: ClientFacts[], share = 0.1): number {
  const суммы = all
    .filter((one) => one.receipts > 0)
    .map((one) => one.purchases)
    .sort((a, b) => b - a);

  if (!суммы.length) return Infinity;
  const место = Math.max(0, Math.ceil(суммы.length * share) - 1);
  return суммы[место];
}

/**
 * День и месяц из даты рождения.
 *
 * Записей три породы: из CloudShop приходит «30/12/2026», руками пишут
 * «12.07.1990», а из выгрузок и полей ввода браузера — «1990-07-12». Первую
 * от третьей отличаем по длине первого куска: четыре цифры — это год, и
 * тогда порядок обратный.
 *
 * Сам год не нужен и часто неверен: в выгрузке CloudShop в нём стоит год
 * ближайшего дня рождения, а не рождения. Поэтому берём только день и месяц.
 */
export function birthdayParts(value: string | null): { day: number; month: number } | null {
  if (!value) return null;

  const parts = value.trim().split(/[./-]/);
  if (parts.length < 2) return null;

  const сначалаГод = parts.length >= 3 && /^\d{4}$/.test(parts[0]);
  const day = Number(сначалаГод ? parts[2] : parts[0]);
  const month = Number(parts[1]);
  if (!Number.isInteger(day) || !Number.isInteger(month)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;

  return { day, month };
}

/**
 * Через сколько дней день рождения. Сегодня — ноль.
 *
 * 29 февраля в невисокосный год поздравляем 28-го: пропустить человека раз в
 * четыре года хуже, чем поздравить на день раньше.
 */
export function daysToBirthday(value: string | null, now: number): number | null {
  const parts = birthdayParts(value);
  if (!parts) return null;

  const today = new Date(now);
  const year = today.getFullYear();
  const начало = Date.UTC(year, today.getMonth(), today.getDate());

  for (const шаг of [0, 1]) {
    const в = year + шаг;
    const последний = new Date(Date.UTC(в, parts.month, 0)).getUTCDate();
    const день = Math.min(parts.day, последний);
    const когда = Date.UTC(в, parts.month - 1, день);
    if (когда >= начало) return Math.round((когда - начало) / ДЕНЬ);
  }

  return null;
}

/** Ссылка на переписку в WhatsApp: номер без плюсов, скобок и пробелов. */
export function whatsappLink(phone: string | null, text?: string): string | null {
  const цифры = (phone ?? '').replace(/\D/g, '');
  if (цифры.length < 10) return null;

  // 8 999 … — российская запись; WhatsApp понимает только международную.
  const номер = цифры.length === 11 && цифры.startsWith('8') ? `7${цифры.slice(1)}` : цифры;
  const хвост = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${номер}${хвост}`;
}

/** «14 дней» / «2 месяца» / «больше года» — срок словами, а не числом дней. */
export function сроком(days: number | null): string {
  if (days === null) return 'никогда';
  if (days === 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 31) return `${days} дн. назад`;
  if (days < 365) return `${Math.round(days / 30)} мес. назад`;
  const лет = Math.floor(days / 365);
  return лет === 1 ? 'больше года назад' : `${лет} г. назад`;
}
