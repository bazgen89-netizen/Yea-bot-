import type { SqlDriver, SqlParam } from './driver';
import {
  daysToBirthday,
  shopCadence,
  standingOf,
  vipThreshold,
  type ClientFacts,
  type Segment,
  type Standing,
} from '../domain/crm';
import type { Kopecks } from '../domain/money';
import type { Id } from '../domain/types';

/**
 * CRM поверх той же базы: клиенты, их группы, заметки и дела.
 *
 * Ни одной новой цифры о покупках здесь не хранится. Сколько человек принёс,
 * когда был последний раз, к какой группе относится — всё считается из чеков
 * при чтении, ровно как остаток товара. Поле «спящий», проставленное однажды,
 * назавтра врало бы: клиент вернулся, а поле осталось.
 *
 * Разбиение по группам делает `src/domain/crm.ts`, а не SQL. Правило одно и
 * то же для экрана, для отчёта и для будущей рассылки; расписанное дважды —
 * на SQL и на TypeScript — оно разойдётся при первой же правке.
 */

/** Строка списка клиентов: карточка, итоги по чекам и вывод из них. */
export interface CrmClient extends ClientFacts {
  id: Id;
  name: string;
  phone: string | null;
  birthday: string | null;
  tags: string;
  note: string | null;
  bonus_balance: Kopecks;
  discount_bp: number;
  /** Группа, личный срок и опоздание. */
  standing: Standing;
  /** Входит в верхние 10 % по выручке. */
  vip: boolean;
  /** Сколько дней до дня рождения, или null, если он не записан. */
  birthdayIn: number | null;
  /** Сколько заметок и невыполненных дел по нему. */
  notes: number;
  tasks: number;
}

const FACTS_SQL = `
  SELECT p.id, p.name, p.phone, p.birthday, p.tags, p.note,
         p.bonus_balance, p.discount_bp,
         COUNT(s.id)               AS receipts,
         COALESCE(SUM(s.total), 0) AS purchases,
         MIN(s.created_at)         AS first_sale_at,
         MAX(s.created_at)         AS last_sale_at,
         (SELECT COUNT(*) FROM client_notes n WHERE n.counterparty_id = p.id) AS notes,
         (SELECT COUNT(*) FROM client_tasks t
           WHERE t.counterparty_id = p.id AND t.done_at IS NULL)              AS tasks
    FROM counterparties p
    LEFT JOIN sales s ON s.customer_id = p.id
   WHERE p.kind IN ('customer','both')
     AND p.archived = 0
     -- «Розничный покупатель» — не человек, а способ пробить чек без карточки.
     -- В CRM ему делать нечего: ни позвонить, ни поздравить.
     AND p.is_default = 0
   GROUP BY p.id
`;

interface FactsRow extends ClientFacts {
  id: Id;
  name: string;
  phone: string | null;
  birthday: string | null;
  tags: string | null;
  note: string | null;
  bonus_balance: Kopecks;
  discount_bp: number;
  notes: number;
  tasks: number;
}

/**
 * Все клиенты с их группами.
 *
 * Читается одним запросом и разбирается в памяти. Клиентов тысячи, а не
 * миллионы: три тысячи строк проходятся быстрее, чем база успела бы их
 * отдать по одной, — а взамен правило группы остаётся в одном месте.
 */
export function crmClients(db: SqlDriver, now = Date.now()): CrmClient[] {
  const rows = db.all<FactsRow>(FACTS_SQL);

  const срок = shopCadence(rows);
  const граница = vipThreshold(rows);

  return rows.map((row) => ({
    ...row,
    tags: row.tags ?? '',
    standing: standingOf(row, now, срок),
    vip: row.receipts > 0 && row.purchases >= граница,
    birthdayIn: daysToBirthday(row.birthday, now),
  }));
}

export interface CrmFilter {
  segment?: Segment | 'all' | 'vip';
  /** Поиск по имени, телефону и меткам. */
  search?: string;
  /** Только те, у кого записан телефон: остальным всё равно не написать. */
  withPhone?: boolean;
  tag?: string;
}

/**
 * Отбор и порядок.
 *
 * Порядок разный по группам, и это не украшение. В «пропали» сверху должен
 * быть тот, кто принёс больше всех: возвращать двадцать человек из пятисот
 * имеет смысл, только если это те двадцать. В «новых» — наоборот, свежие
 * сверху: разговор с человеком, купившим вчера, ещё возможен.
 */
export function filterClients(all: CrmClient[], filter: CrmFilter = {}): CrmClient[] {
  const слово = (filter.search ?? '').trim().toLowerCase();
  const цифры = слово.replace(/\D/g, '');
  const метка = (filter.tag ?? '').trim().toLowerCase();

  const found = all.filter((one) => {
    if (filter.segment === 'vip') {
      if (!one.vip) return false;
    } else if (filter.segment && filter.segment !== 'all') {
      if (one.standing.segment !== filter.segment) return false;
    }

    if (filter.withPhone && !one.phone) return false;

    if (метка && !tagsOf(one.tags).some((t) => t.toLowerCase() === метка)) return false;

    if (слово) {
      const где = [one.name, one.phone ?? '', one.tags].join(' ').toLowerCase();
      // Телефон ищется и в свободной записи: «+7 (900) 583-29-29» должен
      // находиться по «9005832929».
      const поЦифрам = цифры.length >= 3 && (one.phone ?? '').replace(/\D/g, '').includes(цифры);
      if (!где.includes(слово) && !поЦифрам) return false;
    }

    return true;
  });

  const свежие = filter.segment === 'new';
  return found.sort((a, b) => {
    if (свежие) return (a.standing.idle ?? 1e9) - (b.standing.idle ?? 1e9);
    return b.purchases - a.purchases;
  });
}

/** Метки строкой «опт, бар» — списком. */
export function tagsOf(tags: string | null): string[] {
  return (tags ?? '')
    .split(',')
    .map((one) => one.trim())
    .filter(Boolean);
}

/** Все метки, что уже заведены, — чтобы не придумывать их заново каждый раз. */
export function allTags(all: CrmClient[]): string[] {
  const счёт = new Map<string, number>();
  for (const one of all) {
    for (const tag of tagsOf(one.tags)) счёт.set(tag, (счёт.get(tag) ?? 0) + 1);
  }
  return [...счёт.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
}

export function setTags(db: SqlDriver, id: Id, tags: string[]): void {
  const чистые = [...new Set(tags.map((one) => one.trim()).filter(Boolean))];
  db.run('UPDATE counterparties SET tags = ? WHERE id = ?', [чистые.join(', '), id]);
}

/** Сводка для главного экрана CRM. */
export interface CrmSummary {
  /** Сколько человек в каждой группе. */
  counts: Record<Segment, number>;
  /** Сколько всего клиентов (кроме «Розничного покупателя»). */
  total: number;
  /** Выручка от пропавших за всё время — столько стоит их не вернуть. */
  sleepingMoney: Kopecks;
  /** Обычный срок магазина между покупками, дней. */
  cadence: number;
  /** Дни рождения на ближайшую неделю. */
  birthdays: number;
  /** Дел на сегодня и раньше. */
  tasksDue: number;
}

export function crmSummary(db: SqlDriver, now = Date.now()): CrmSummary {
  const clients = crmClients(db, now);

  const counts: Record<Segment, number> = { none: 0, new: 0, regular: 0, sleeping: 0, lost: 0 };
  let sleepingMoney = 0;

  for (const one of clients) {
    counts[one.standing.segment] += 1;
    if (one.standing.segment === 'sleeping') sleepingMoney += one.purchases;
  }

  return {
    counts,
    total: clients.length,
    sleepingMoney,
    cadence: shopCadence(clients),
    birthdays: clients.filter((one) => one.birthdayIn !== null && one.birthdayIn <= 7).length,
    tasksDue: countDueTasks(db, now),
  };
}

/** Дни рождения ближайших `days` дней, ближайшие сверху. */
export function birthdaysSoon(db: SqlDriver, days = 7, now = Date.now()): CrmClient[] {
  return crmClients(db, now)
    .filter((one) => one.birthdayIn !== null && one.birthdayIn <= days)
    .sort((a, b) => (a.birthdayIn ?? 0) - (b.birthdayIn ?? 0));
}

// ── Заметки ────────────────────────────────────────────────────────────────

export interface ClientNote {
  id: Id;
  counterparty_id: Id;
  body: string;
  author: string | null;
  created_at: string;
}

export function listNotes(db: SqlDriver, partyId: Id): ClientNote[] {
  return db.all<ClientNote>(
    'SELECT * FROM client_notes WHERE counterparty_id = ? ORDER BY created_at DESC, id DESC',
    [partyId],
  );
}

export function addNote(db: SqlDriver, partyId: Id, body: string, author?: string | null): Id {
  const текст = body.trim();
  if (!текст) throw new Error('Пустую заметку не сохранить');

  db.run(
    'INSERT INTO client_notes (counterparty_id, body, author, created_at) VALUES (?, ?, ?, ?)',
    [partyId, текст, author?.trim() || null, new Date().toISOString()],
  );
  return db.lastInsertId();
}

export function removeNote(db: SqlDriver, id: Id): void {
  db.run('DELETE FROM client_notes WHERE id = ?', [id]);
}

// ── Дела ───────────────────────────────────────────────────────────────────

export interface ClientTask {
  id: Id;
  counterparty_id: Id | null;
  title: string;
  /** Срок днём, «ГГГГ-ММ-ДД». */
  due_date: string;
  done_at: string | null;
  author: string | null;
  created_at: string;
}

export interface TaskWithClient extends ClientTask {
  client_name: string | null;
  client_phone: string | null;
}

export interface TaskFilter {
  /** Только по этому клиенту. */
  partyId?: Id;
  /** 'open' — невыполненные, 'done' — выполненные, 'all' — все. */
  state?: 'open' | 'done' | 'all';
  /** Только со сроком не позже этого дня, «ГГГГ-ММ-ДД». */
  until?: string;
}

export function listTasks(db: SqlDriver, filter: TaskFilter = {}): TaskWithClient[] {
  const where: string[] = [];
  const params: SqlParam[] = [];

  if (filter.partyId) {
    where.push('t.counterparty_id = ?');
    params.push(filter.partyId);
  }
  if (filter.state === 'done') where.push('t.done_at IS NOT NULL');
  else if (filter.state !== 'all') where.push('t.done_at IS NULL');

  if (filter.until) {
    where.push('t.due_date <= ?');
    params.push(filter.until);
  }

  return db.all<TaskWithClient>(
    `SELECT t.*, p.name AS client_name, p.phone AS client_phone
       FROM client_tasks t
       LEFT JOIN counterparties p ON p.id = t.counterparty_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      -- Просроченные сверху, а внутри дня — в порядке появления: список дел,
      -- перетасовывающийся сам, перестают читать.
      ORDER BY t.done_at IS NOT NULL, t.due_date, t.id`,
    params,
  );
}

/** Сколько дел просрочено или на сегодня — число для значка на экране. */
export function countDueTasks(db: SqlDriver, now = Date.now()): number {
  const row = db.get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM client_tasks WHERE done_at IS NULL AND due_date <= ?',
    [today(now)],
  );
  return row?.n ?? 0;
}

export interface TaskInput {
  partyId?: Id | null;
  title: string;
  /** «ГГГГ-ММ-ДД». Пусто — на сегодня. */
  due?: string | null;
  author?: string | null;
}

export function addTask(db: SqlDriver, input: TaskInput, now = Date.now()): Id {
  const название = input.title.trim();
  if (!название) throw new Error('У дела должно быть название');

  db.run(
    `INSERT INTO client_tasks (counterparty_id, title, due_date, author, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      input.partyId ?? null,
      название,
      (input.due ?? '').trim() || today(now),
      input.author?.trim() || null,
      new Date(now).toISOString(),
    ],
  );
  return db.lastInsertId();
}

/**
 * Отметить дело сделанным или вернуть в работу.
 *
 * Вернуть можно: отметил не то — и без этого пришлось бы заводить дело заново,
 * потеряв, когда оно появилось и кто его поставил.
 */
export function setTaskDone(db: SqlDriver, id: Id, done: boolean, now = Date.now()): void {
  db.run('UPDATE client_tasks SET done_at = ? WHERE id = ?', [
    done ? new Date(now).toISOString() : null,
    id,
  ]);
}

export function removeTask(db: SqlDriver, id: Id): void {
  db.run('DELETE FROM client_tasks WHERE id = ?', [id]);
}

/** Сегодняшний день как «ГГГГ-ММ-ДД» по местному времени, а не по UTC. */
export function today(now = Date.now()): string {
  const date = new Date(now);
  const два = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${два(date.getMonth() + 1)}-${два(date.getDate())}`;
}
