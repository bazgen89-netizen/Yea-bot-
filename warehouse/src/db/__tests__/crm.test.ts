import type { SqlDriver } from '../driver';
import { createTestDriver } from '../testDriver';
import { createCounterparty } from '../counterparties';
import {
  addNote,
  addTask,
  allTags,
  birthdaysSoon,
  countDueTasks,
  crmClients,
  crmSummary,
  filterClients,
  listNotes,
  listTasks,
  removeNote,
  removeTask,
  setTags,
  setTaskDone,
  tagsOf,
  today,
} from '../crm';

/**
 * CRM на настоящей базе.
 *
 * Здесь проверяется то, чего не видно в чистой арифметике: что «Розничный
 * покупатель» не попадает в список людей, что группы считаются по чекам, а не
 * по проставленному кем-то полю, и что заметки не затирают друг друга.
 */

let db: SqlDriver;

const NOW = Date.parse('2026-09-07T12:00:00Z');
const дней = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

beforeEach(() => {
  db = createTestDriver();
});

/** Чек прямо в базу: складская часть тут ни при чём, важны сумма и дата. */
function чек(customer: number | null, total: number, at: string) {
  db.run(
    `INSERT INTO sales (discount, total, cost_total, payment, created_at, customer_id)
     VALUES (0, ?, 0, 'cash', ?, ?)`,
    [total, at, customer],
  );
}

function клиент(name: string, extra: Partial<{ phone: string; birthday: string }> = {}) {
  return createCounterparty(db, { kind: 'customer', name, ...extra });
}

describe('список клиентов CRM', () => {
  it('считает покупки по чекам, а не по полю', () => {
    const id = клиент('Никита Акимов');
    чек(id, 100_000, дней(10));
    чек(id, 50_000, дней(40));

    const [один] = crmClients(db, NOW);
    expect(один.receipts).toBe(2);
    expect(один.purchases).toBe(150_000);
    expect(один.standing.idle).toBe(10);
  });

  it('«Розничный покупатель» в CRM не показывается', () => {
    const розница = клиент('Розничный покупатель');
    db.run('UPDATE counterparties SET is_default = 1 WHERE id = ?', [розница]);
    чек(розница, 500_000, дней(1));
    клиент('Живой человек');

    expect(crmClients(db, NOW).map((one) => one.name)).toEqual(['Живой человек']);
  });

  it('поставщик не считается клиентом, а «оба» считается', () => {
    createCounterparty(db, { kind: 'supplier', name: 'Поставщик чая' });
    createCounterparty(db, { kind: 'both', name: 'И то и то' });
    клиент('Клиент');

    expect(crmClients(db, NOW).map((one) => one.name).sort()).toEqual(['И то и то', 'Клиент']);
  });

  it('убранная карточка исчезает и из CRM', () => {
    const id = клиент('Ушедший');
    db.run('UPDATE counterparties SET archived = 1 WHERE id = ?', [id]);
    expect(crmClients(db, NOW)).toHaveLength(0);
  });

  it('раскладывает по группам так же, как арифметика', () => {
    // Ходил раз в месяц, не был сто дней — вот это и есть «пропал». Четыре
    // покупки за 400 дней им бы не были: раз в сто дней он и ходит.
    const пропал = клиент('Пропал');
    for (const d of [200, 180, 160, 100]) чек(пропал, 100_000, дней(d));

    const ходит = клиент('Ходит');
    for (const d of [120, 90, 60, 30, 5]) чек(ходит, 100_000, дней(d));

    const новый = клиент('Новый');
    чек(новый, 100_000, дней(3));

    const потерян = клиент('Потерян');
    чек(потерян, 100_000, дней(500));

    клиент('Без покупок');

    const по = new Map(crmClients(db, NOW).map((one) => [one.name, one.standing.segment]));
    expect(по.get('Пропал')).toBe('sleeping');
    expect(по.get('Ходит')).toBe('regular');
    expect(по.get('Новый')).toBe('new');
    expect(по.get('Потерян')).toBe('lost');
    expect(по.get('Без покупок')).toBe('none');
  });

  it('крупные — верхние 10 % по выручке', () => {
    for (let i = 1; i <= 10; i += 1) {
      const id = клиент(`Клиент ${i}`);
      чек(id, i * 10_000, дней(5));
    }

    const крупные = crmClients(db, NOW).filter((one) => one.vip);
    expect(крупные.map((one) => one.name)).toEqual(['Клиент 10']);
  });
});

describe('отбор', () => {
  // Заводится один раз на тест, а не при каждом обращении: помощник, который
  // добавляет клиентов на каждый вызов, показывает двойников там, где их нет.
  let все: ReturnType<typeof crmClients>;

  beforeEach(() => {
    const пропал = клиент('Пропавший Пётр', { phone: '+7 (900) 583-29-29' });
    for (const d of [200, 180, 160, 100]) чек(пропал, 200_000, дней(d));

    const ещё = клиент('Пропавшая Ольга');
    for (const d of [200, 180, 160, 100]) чек(ещё, 50_000, дней(d));

    const свежий = клиент('Новичок Иван');
    чек(свежий, 10_000, дней(2));

    все = crmClients(db, NOW);
  });

  it('по группе', () => {
    expect(filterClients(все, { segment: 'sleeping' })).toHaveLength(2);
    expect(filterClients(все, { segment: 'new' })).toHaveLength(1);
    expect(filterClients(все, { segment: 'all' })).toHaveLength(3);
  });

  it('в «пропавших» сверху тот, кто принёс больше', () => {
    const кто = filterClients(все, { segment: 'sleeping' }).map((one) => one.name);
    expect(кто).toEqual(['Пропавший Пётр', 'Пропавшая Ольга']);
  });

  it('только с телефоном — остальным всё равно не написать', () => {
    const с = filterClients(все, { segment: 'sleeping', withPhone: true });
    expect(с.map((one) => one.name)).toEqual(['Пропавший Пётр']);
  });

  it('ищет по имени в любом регистре — SQLite тут не при чём, поиск в памяти', () => {
    expect(filterClients(все, { search: 'ПРОПАВШ' })).toHaveLength(2);
    expect(filterClients(все, { search: 'иван' })).toHaveLength(1);
  });

  it('ищет по телефону в любом написании', () => {
    expect(filterClients(все, { search: '9005832929' })).toHaveLength(1);
    expect(filterClients(все, { search: '+7 (900) 583-29-29' })).toHaveLength(1);
  });
});

describe('метки', () => {
  it('пишутся строкой и читаются списком', () => {
    const id = клиент('Оптовик');
    setTags(db, id, ['опт', 'бар']);

    const [один] = crmClients(db, NOW);
    expect(один.tags).toBe('опт, бар');
    expect(tagsOf(один.tags)).toEqual(['опт', 'бар']);
  });

  it('не плодят повторов и пустот', () => {
    const id = клиент('Кто-то');
    setTags(db, id, ['опт', ' опт ', '', '  ', 'бар']);
    expect(tagsOf(crmClients(db, NOW)[0].tags)).toEqual(['опт', 'бар']);
  });

  it('отбираются точным совпадением, а не куском слова', () => {
    const a = клиент('Первый');
    const b = клиент('Второй');
    setTags(db, a, ['опт']);
    setTags(db, b, ['оптика']);

    const все = crmClients(db, NOW);
    expect(filterClients(все, { tag: 'опт' }).map((one) => one.name)).toEqual(['Первый']);
  });

  it('подсказка собирает уже заведённые метки, частые сверху', () => {
    setTags(db, клиент('А'), ['опт']);
    setTags(db, клиент('Б'), ['опт', 'бар']);
    expect(allTags(crmClients(db, NOW))).toEqual(['опт', 'бар']);
  });
});

describe('заметки о клиенте', () => {
  it('копятся, а не затирают друг друга', () => {
    const id = клиент('Никита');
    addNote(db, id, 'Пьёт только шу');
    addNote(db, id, 'Дочь Аня, аллергия на жасмин');

    const заметки = listNotes(db, id);
    expect(заметки).toHaveLength(2);
    // Свежая сверху: последнее сказанное о человеке важнее первого.
    expect(заметки[0].body).toBe('Дочь Аня, аллергия на жасмин');
  });

  it('пустую не сохраняет', () => {
    const id = клиент('Никита');
    expect(() => addNote(db, id, '   ')).toThrow();
    expect(listNotes(db, id)).toHaveLength(0);
  });

  it('удаляется поштучно', () => {
    const id = клиент('Никита');
    const первая = addNote(db, id, 'Раз');
    addNote(db, id, 'Два');
    removeNote(db, первая);
    expect(listNotes(db, id).map((one) => one.body)).toEqual(['Два']);
  });

  it('уходит вместе с карточкой, а не остаётся сиротой', () => {
    const id = клиент('Никита');
    addNote(db, id, 'Что-то');
    db.run('DELETE FROM counterparties WHERE id = ?', [id]);
    expect(db.all('SELECT * FROM client_notes')).toHaveLength(0);
  });

  it('считается в списке клиентов', () => {
    const id = клиент('Никита');
    addNote(db, id, 'Раз');
    addNote(db, id, 'Два');
    expect(crmClients(db, NOW)[0].notes).toBe(2);
  });
});

describe('дела', () => {
  it('заводится на клиента и попадает в список', () => {
    const id = клиент('Никита');
    addTask(db, { partyId: id, title: 'Позвонить про пуэр', due: '2026-09-15' }, NOW);

    const [дело] = listTasks(db);
    expect(дело.title).toBe('Позвонить про пуэр');
    expect(дело.client_name).toBe('Никита');
  });

  it('бывает и без клиента', () => {
    addTask(db, { title: 'Заказать коробки' }, NOW);
    const [дело] = listTasks(db);
    expect(дело.counterparty_id).toBeNull();
    expect(дело.client_name).toBeNull();
    // Без срока — на сегодня: дело без даты теряется навсегда.
    expect(дело.due_date).toBe(today(NOW));
  });

  it('без названия не заводится', () => {
    expect(() => addTask(db, { title: '  ' }, NOW)).toThrow();
    expect(listTasks(db)).toHaveLength(0);
  });

  it('просроченные сверху', () => {
    addTask(db, { title: 'Потом', due: '2026-12-01' }, NOW);
    addTask(db, { title: 'Вчера', due: '2026-09-06' }, NOW);
    addTask(db, { title: 'Сегодня', due: '2026-09-07' }, NOW);

    expect(listTasks(db).map((one) => one.title)).toEqual(['Вчера', 'Сегодня', 'Потом']);
  });

  it('считает только то, что горит', () => {
    addTask(db, { title: 'Вчера', due: '2026-09-06' }, NOW);
    addTask(db, { title: 'Сегодня', due: '2026-09-07' }, NOW);
    addTask(db, { title: 'Через месяц', due: '2026-10-07' }, NOW);

    expect(countDueTasks(db, NOW)).toBe(2);
  });

  it('отмечается сделанным и возвращается в работу', () => {
    const id = addTask(db, { title: 'Позвонить', due: '2026-09-07' }, NOW);

    setTaskDone(db, id, true, NOW);
    expect(listTasks(db)).toHaveLength(0);
    expect(listTasks(db, { state: 'done' })).toHaveLength(1);
    expect(countDueTasks(db, NOW)).toBe(0);

    // Отметил не то — вернуть можно, не заводя заново.
    setTaskDone(db, id, false, NOW);
    expect(listTasks(db)).toHaveLength(1);
    expect(listTasks(db)[0].created_at).toBeTruthy();
  });

  it('удаляется и уходит вместе с карточкой клиента', () => {
    const id = клиент('Никита');
    const дело = addTask(db, { partyId: id, title: 'Раз' }, NOW);
    addTask(db, { partyId: id, title: 'Два' }, NOW);

    removeTask(db, дело);
    expect(listTasks(db, { partyId: id })).toHaveLength(1);

    db.run('DELETE FROM counterparties WHERE id = ?', [id]);
    expect(listTasks(db, { state: 'all' })).toHaveLength(0);
  });

  it('невыполненные считаются в списке клиентов', () => {
    const id = клиент('Никита');
    const первое = addTask(db, { partyId: id, title: 'Раз' }, NOW);
    addTask(db, { partyId: id, title: 'Два' }, NOW);
    setTaskDone(db, первое, true, NOW);

    expect(crmClients(db, NOW)[0].tasks).toBe(1);
  });
});

describe('дни рождения', () => {
  it('ближайшие сверху, дальние не показываются', () => {
    клиент('Завтра', { birthday: '08/09/1990' });
    клиент('Через неделю', { birthday: '14/09/1990' });
    клиент('В декабре', { birthday: '30/12/1990' });
    клиент('Без даты');

    expect(birthdaysSoon(db, 7, NOW).map((one) => one.name)).toEqual(['Завтра', 'Через неделю']);
  });
});

describe('сводка', () => {
  it('сумма по группам сходится с числом клиентов', () => {
    const пропал = клиент('Пропал');
    for (const d of [200, 180, 160, 100]) чек(пропал, 200_000, дней(d));
    const ходит = клиент('Ходит');
    for (const d of [120, 90, 60, 30, 5]) чек(ходит, 100_000, дней(d));
    клиент('Без покупок');

    const сводка = crmSummary(db, NOW);
    const сумма = Object.values(сводка.counts).reduce((a, b) => a + b, 0);
    expect(сумма).toBe(сводка.total);
    expect(сводка.total).toBe(3);
  });

  it('показывает, сколько денег стоит за пропавшими', () => {
    const пропал = клиент('Пропал');
    for (const d of [200, 180, 160, 100]) чек(пропал, 200_000, дней(d));

    const сводка = crmSummary(db, NOW);
    expect(сводка.counts.sleeping).toBe(1);
    expect(сводка.sleepingMoney).toBe(800_000);
  });

  it('на пустой базе не падает и не врёт', () => {
    const сводка = crmSummary(db, NOW);
    expect(сводка.total).toBe(0);
    expect(сводка.sleepingMoney).toBe(0);
    expect(сводка.cadence).toBe(60);
    expect(сводка.tasksDue).toBe(0);
  });
});
