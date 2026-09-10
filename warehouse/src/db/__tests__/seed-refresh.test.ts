import { createTestDriver } from '../testDriver';
import type { SqlDriver } from '../driver';
import { ensureLocation } from '../locations';
import { createProduct } from '../products';
import { listJournal } from '../journal';
import { createSale, getSale } from '../sales';
import {
  seedStamp,
  keepCrm,
  loadedSeedStamp,
  rememberSeedStamp,
  resetSeed,
  restoreCrm,
  seedCatalog,
  useSeedData,
} from '../seed';

/**
 * Новый файл программы должен привозить новые данные.
 *
 * Это не отвлечённая проверка. Каждая часть наполнения помечается в базе и
 * второй раз не заводится — иначе повторный запуск задваивал бы каталог. Но
 * браузер держит базу от прежнего файла, и когда приходит следующий, со
 * свежей выгрузкой, отметки уже стоят. Снаружи это выглядит так, будто
 * перенос не сработал: товары старые, истории покупок нет. Ровно на это я и
 * напоролся.
 */
describe('обновление поставляемых данных', () => {
  let db: SqlDriver;

  beforeEach(() => {
    db = createTestDriver();
  });

  const count = (table: string) =>
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0;

  it('на свежей базе подписи нет, после наполнения она появляется', () => {
    expect(loadedSeedStamp(db)).toBeNull();

    seedCatalog(db);
    rememberSeedStamp(db);

    expect(loadedSeedStamp(db)).toBe(seedStamp());
    expect(count('products')).toBeGreaterThan(0);
  });

  it('повторное наполнение ничего не задваивает', () => {
    seedCatalog(db);
    const products = count('products');
    const sales = count('sales');

    seedCatalog(db);

    expect(count('products')).toBe(products);
    expect(count('sales')).toBe(sales);
  });

  it('база от прежней сборки очищается и заводится заново', () => {
    // Так выглядит база, заведённая старым файлом: отметки стоят,
    // подписи нет.
    seedCatalog(db);
    expect(loadedSeedStamp(db)).toBeNull();

    const products = count('products');
    const sales = count('sales');
    expect(products).toBeGreaterThan(0);

    // То, что делает сборка при запуске: подпись не совпала — заводим заново.
    if (loadedSeedStamp(db) !== seedStamp()) resetSeed(db);
    seedCatalog(db);
    rememberSeedStamp(db);

    expect(count('products')).toBe(products);
    expect(count('sales')).toBe(sales);
    expect(loadedSeedStamp(db)).toBe(seedStamp());
  });

  it('очистка не спотыкается о связи между таблицами', () => {
    // Ровно эта ошибка вышла у него при запуске: «Не удалось открыть
    // исходные данные. Нарушено ограничение внешнего ключа». Смена
    // ссылается на кассу, а кассы стирались раньше смен — и файл не
    // открывался вовсе.
    db.exec('PRAGMA foreign_keys = ON;');
    seedCatalog(db);

    const location = ensureLocation(db, 'Черёмушки');
    db.run('INSERT INTO registers (name, location_id, created_at) VALUES (?, ?, ?)', [
      'Касса — Черёмушки',
      location,
      '2026-08-19T09:00:00.000Z',
    ]);
    const register = db.lastInsertId();
    db.run('INSERT INTO shifts (register_id, opened_at, created_at) VALUES (?, ?, ?)', [
      register,
      '2026-08-19T09:00:00.000Z',
      '2026-08-19T09:00:00.000Z',
    ]);

    expect(() => resetSeed(db)).not.toThrow();
    expect(count('shifts')).toBe(0);
    expect(count('registers')).toBe(0);

    // И после очистки связи снова включены — иначе база молча наберёт
    // висячих ссылок.
    expect(db.get<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys).toBe(1);
  });

  it('очистка снимает отметки, иначе следующий проход ничего не заведёт', () => {
    seedCatalog(db);
    resetSeed(db);

    expect(count('products')).toBe(0);
    expect(count('sales')).toBe(0);
    expect(count('counterparties')).toBe(0);

    seedCatalog(db);
    expect(count('products')).toBeGreaterThan(0);
  });

  it('после очистки история снова ложится на своих клиентов', () => {
    seedCatalog(db);
    const named = () =>
      db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sales WHERE customer_id IS NOT NULL')?.n ?? 0;

    const before = named();

    resetSeed(db);
    seedCatalog(db);

    expect(named()).toBe(before);
  });
});

/**
 * Своя нумерация продолжает чужую.
 *
 * Перенесённые чеки принесли с собой номера CloudShop — до «#45868». Новый
 * чек, пробитый на кассе, должен встать следующим, а не получить номер из
 * середины: такой номер уже занят чеком трёхлетней давности, его не найти в
 * кабинете и не назвать покупателю.
 */
describe('нумерация новых чеков', () => {
  it('новый чек продолжает номера перенесённой истории', () => {
    const db = createTestDriver();

    const product = createProduct(db, {
      name: 'Пиала бордовая 45 мл',
      sku: null,
      barcode: null,
      unit: 'шт',
      sale_price: 55000,
      cost_price: 0,
      category_id: null,
      min_qty: 0,
      photo_uri: null,
    });

    // Так выглядит перенесённая история: у чеков стоят номера CloudShop, и
    // они много больше внутренних номеров строк.
    db.run(
      `INSERT INTO sales (discount, total, cost_total, payment, created_at, number)
       VALUES (0, 55000, 0, 'cash', '2026-08-19T09:00:00.000Z', 45868)`,
    );

    const id = createSale(db, {
      lines: [
        {
          product_id: product,
          name: 'Пиала бордовая 45 мл',
          unit: 'шт',
          stock: 0,
          qty: 1000,
          price: 55000,
          cost_price: 0,
        },
      ],
      allowNegative: true,
    });

    // Внутренний номер строки здесь — 2, и именно его чек получал раньше.
    expect(id).toBeLessThan(45868);
    expect(
      db.get<{ number: number }>('SELECT number FROM sales WHERE id = ?', [id])?.number,
    ).toBe(45869);
  });

  it('на пустой базе нумерация начинается с единицы', () => {
    const db = createTestDriver();
    const product = createProduct(db, {
      name: 'Пиала',
      sku: null,
      barcode: null,
      unit: 'шт',
      sale_price: 55000,
      cost_price: 0,
      category_id: null,
      min_qty: 0,
      photo_uri: null,
    });

    const id = createSale(db, {
      lines: [
        {
          product_id: product,
          name: 'Пиала',
          unit: 'шт',
          stock: 0,
          qty: 1000,
          price: 55000,
          cost_price: 0,
        },
      ],
      allowNegative: true,
    });

    expect(
      db.get<{ number: number }>('SELECT number FROM sales WHERE id = ?', [id])?.number,
    ).toBe(1);
  });
});

/**
 * Данные для сборки приезжают не только файлами.
 *
 * У страницы по ссылке есть предел размера, и вся история — сорок пять
 * тысяч чеков, четырнадцать мегабайт текстом — в него не помещалась:
 * приходилось обрезать её до последних восемнадцати тысяч. Теперь набор
 * кладётся рядом со страницей пожатым, а распаковав, его подставляют
 * вместо файлов. Проверяем, что подстановка действительно работает: иначе
 * сборка вышла бы с пустышками вместо данных и это заметил бы только он.
 */
describe('подстановка распакованного набора', () => {
  it('наполняет базу подставленными данными, а не вшитыми файлами', () => {
    const db = createTestDriver();

    useSeedData({
      products: [
        {
          n: 'Габа Алишань',
          c: '00145',
          s: '8883014',
          u: 'гр',
          p: 3299,
          cp: 1200,
          pp: 1000,
          d: 0,
          q: { 'Чайный бар': 10_000 },
        },
      ],
      clients: [
        {
          n: 'Монтеро Антонио',
          p: '+79990000001',
          e: null,
          b: null,
          g: null,
          d: null,
          a: null,
          by: null,
          bo: 16_450,
          lt: 'bonus',
        },
      ],
      sales: [],
      photos: {},
      stores: [],
    });

    expect(seedStamp()).toBe('1:1:0');

    seedCatalog(db);

    const product = db.get<{ n: string; cost: number; purchase: number }>(
      'SELECT name AS n, cost_price AS cost, purchase_price AS purchase FROM products WHERE code = ?',
      ['00145'],
    );

    expect(product?.n).toBe('Габа Алишань');

    // Себестоимость и цена закупки: в карточке товара CloudShop их не
    // отдаёт, перенос собирает их из документов корректировки. Без них
    // «Себестоимость продаж» и «Прибыль» на главной оставались нулями.
    expect(product?.cost).toBe(1200);
    expect(product?.purchase).toBe(1000);

    // Бонусный счёт клиента переносится вместе с карточкой: он приходит из
    // CloudShop итогом, а не строками чеков, и без него карточка пустая.
    expect(
      db.get<{ b: number }>('SELECT bonus_balance AS b FROM counterparties WHERE name = ?', [
        'Монтеро Антонио',
      ])?.b,
    ).toBe(16_450);
  });
});

/**
 * Возврат продажи среди перенесённых документов.
 *
 * У возвратов в CloudShop свой раздел, и в переносе их не было вовсе —
 * девять документов просто отсутствовали. Свои возвраты мы узнаём по
 * движению склада, но у перенесённой истории движений нет: она склад не
 * трогает. Поэтому признак хранится в самом чеке, и журнал обязан по нему
 * называть документ возвратом, а не продажей.
 */
describe('перенесённые возвраты', () => {
  it('журнал называет их возвратом продажи', () => {
    const db = createTestDriver();

    useSeedData({
      products: [
        { n: 'Габа Алишань', c: '00145', s: null, u: 'гр', p: 3299, d: 0, q: { 'Чайный бар': 10_000 } },
      ],
      clients: [],
      sales: [
        {
          at: '2026-08-16T11:43:45.000Z',
          c: null,
          ret: 1,
          no: 11,
          t: 65_000,
          st: 'Чайный бар',
          ln: [{ code: '00145', q: 1_000, p: 65_000 }],
        },
        {
          at: '2026-08-16T12:00:00.000Z',
          c: null,
          no: 12,
          t: 9_920,
          st: 'Чайный бар',
          ln: [{ code: '00145', q: 1_000, p: 9_920 }],
        },
      ],
      photos: {},
      stores: [],
    });

    seedCatalog(db);

    const kinds = new Map(
      listJournal(db, 10).map((entry) => [entry.number, entry.kind] as const),
    );

    expect(kinds.get(11)).toBe('refund');
    expect(kinds.get(12)).toBe('sale');
  });
});

/**
 * Комментарий к продаже.
 *
 * В CloudShop у чека есть своё поле `comment` — оно и показывается значком в
 * журнале и плашкой в самом документе. В переносе я его не забирал вовсе, и
 * все комментарии за историю оставались в кабинете.
 *
 * Второе здесь же: имя покупателя без карточки — это **не** комментарий. Я
 * складывал его в то же поле, и у чеков без комментария в журнале загорался
 * значок, а в документе на месте комментария стояло имя человека.
 */
describe('комментарий к перенесённому чеку', () => {
  it('доезжает в журнал и в документ, а имя покупателя в него не попадает', () => {
    const db = createTestDriver();

    useSeedData({
      products: [
        { n: 'Габа Алишань', c: '00145', s: null, u: 'гр', p: 3299, d: 0, q: { 'Чайный бар': 10_000 } },
      ],
      clients: [],
      sales: [
        {
          at: '2026-08-16T12:00:00.000Z',
          c: null,
          no: 21,
          t: 9_920,
          st: 'Чайный бар',
          cm: 'отложил до субботы',
          ln: [{ code: '00145', q: 1_000, p: 9_920 }],
        },
        {
          at: '2026-08-16T12:30:00.000Z',
          c: null,
          cn: 'Пётр Иванов',
          no: 22,
          t: 9_920,
          st: 'Чайный бар',
          ln: [{ code: '00145', q: 1_000, p: 9_920 }],
        },
      ],
      photos: {},
      stores: [],
    });

    seedCatalog(db);

    const notes = new Map(listJournal(db, 10).map((entry) => [entry.number, entry.note] as const));
    expect(notes.get(21)).toBe('отложил до субботы');
    // У второго чека комментария нет — значит и значка в журнале не будет.
    expect(notes.get(22)).toBeNull();

    const ids = new Map(listJournal(db, 10).map((entry) => [entry.number, entry.id] as const));
    expect(getSale(db, ids.get(21)!)?.note).toBe('отложил до субботы');
    // Имя покупателя лежит своим полем и читается как покупатель.
    expect(getSale(db, ids.get(22)!)?.customer).toBe('Пётр Иванов');
  });

  /**
   * Поиск в журнале — «по номеру или комментарию», как и подписано в поле.
   *
   * Номер сравнивался с внутренним `id`, а в строке журнала стоит номер
   * CloudShop. Поиск «21» не находил «Продажа #21»: в базе у неё свой другой
   * `id`, и поле выглядело сломанным.
   */
  it('находится по номеру из строки и по слову из комментария', () => {
    const db = createTestDriver();

    useSeedData({
      products: [
        { n: 'Габа Алишань', c: '00145', s: null, u: 'гр', p: 3299, d: 0, q: { 'Чайный бар': 10_000 } },
      ],
      clients: [],
      sales: [
        {
          at: '2026-08-16T12:00:00.000Z',
          c: null,
          no: 45_967,
          t: 9_920,
          st: 'Чайный бар',
          cm: 'отложил до субботы',
          ln: [{ code: '00145', q: 1_000, p: 9_920 }],
        },
        {
          at: '2026-08-16T12:30:00.000Z',
          c: null,
          no: 45_968,
          t: 9_920,
          st: 'Чайный бар',
          ln: [{ code: '00145', q: 1_000, p: 9_920 }],
        },
      ],
      photos: {},
      stores: [],
    });

    seedCatalog(db);

    const numbers = (search: string) =>
      listJournal(db, 10, { search }).map((entry) => entry.number);

    expect(numbers('45967')).toEqual([45_967]);
    expect(numbers('субботы')).toEqual([45_967]);
    // Номер — точным совпадением: «4596» не должно вытаскивать оба чека.
    expect(numbers('4596')).toEqual([]);
  });
});

/**
 * Складские документы из переноса.
 *
 * До сих пор в журнале стояли одни чеки: движение товара состояло из
 * продаж, а откуда товар взялся — видно не было. Connect API отдаёт
 * закупки и возвраты поставщику, и теперь они приезжают вместе с историей.
 *
 * Склад они не двигают — остаток приезжает готовым из карточек товара.
 * Если бы двигали, он вышел бы вдвое больше настоящего.
 */
describe('перенесённые закупки', () => {
  it('становятся документами журнала и склад не трогают', () => {
    const db = createTestDriver();

    useSeedData({
      products: [
        { n: 'Габа Алишань', c: '00145', s: null, u: 'гр', p: 3299, d: 0, q: { 'Чайный бар': 10_000 } },
      ],
      clients: [],
      sales: [],
      docs: [
        {
          k: 'purchase',
          at: '2026-08-16T09:00:00.000Z',
          no: 128,
          st: 'Чайный бар',
          cp: 'Чайная лавка',
          cm: 'по накладной 4512',
          ln: [{ code: '00145', q: 5_000, p: 1_200 }],
        },
      ],
      photos: {},
      stores: [],
    });

    seedCatalog(db);

    const entry = listJournal(db, 10).find((row) => row.number === 128);
    expect(entry?.kind).toBe('purchase');
    expect(entry?.sender).toBe('Чайная лавка');
    expect(entry?.receiver).toBe('Чайный бар');
    expect(entry?.note).toBe('по накладной 4512');
    expect(entry?.positions).toBe(1);

    // Остаток — тот, что приехал из карточки товара: закупка его не двигает.
    const store = db.get<{ id: number }>('SELECT id FROM locations WHERE name = ?', ['Чайный бар'])!;
    const stock = db.get<{ qty: number }>(
      'SELECT COALESCE(SUM(qty_delta), 0) AS qty FROM stock_moves WHERE location_id = ?',
      [store.id],
    );
    expect(stock?.qty).toBe(10_000);

    // Поставщик заведён карточкой: в журнале его имя — ссылка.
    expect(
      db.get('SELECT id FROM counterparties WHERE name = ? AND kind = ?', [
        'Чайная лавка',
        'supplier',
      ]),
    ).not.toBeNull();
  });
});

/**
 * Заметки, дела и метки переживают ночное обновление.
 *
 * Это самая опасная часть обновления: клиенты стираются и заводятся заново с
 * другими номерами, а внешние ключи на время очистки сняты. Не снять заметки
 * заранее — и «пьёт только шу» после ночи окажется у другого человека.
 */
describe('CRM переживает обновление данных', () => {
  let db: SqlDriver;

  beforeEach(() => {
    db = createTestDriver();
  });

  function клиент(name: string, phone: string | null) {
    db.run(
      `INSERT INTO counterparties (kind, name, phone, created_at, search_text)
       VALUES ('customer', ?, ?, '2026-01-01T00:00:00.000Z', '')`,
      [name, phone],
    );
    return db.lastInsertId();
  }

  it('возвращает заметку тому же человеку, хоть номер записи и сменился', () => {
    const был = клиент('Сафонов Юрий', '89056162582');
    db.run(
      "INSERT INTO client_notes (counterparty_id, body, created_at) VALUES (?, 'Берёт шу коробками', '2026-09-08T10:00:00.000Z')",
      [был],
    );
    db.run("UPDATE counterparties SET tags = 'опт' WHERE id = ?", [был]);

    const kept = keepCrm(db);
    resetSeed(db);

    // Ночная выгрузка завела его заново — с другим номером и в другом
    // написании телефона.
    const стал = клиент('Сафонов Юрий', '+7 (905) 616-25-82');
    клиент('Кто-то другой', '89990001122');
    expect(стал).not.toBe(был);

    restoreCrm(db, kept);

    const заметки = db.all<{ counterparty_id: number; body: string }>('SELECT * FROM client_notes');
    expect(заметки).toHaveLength(1);
    expect(заметки[0].counterparty_id).toBe(стал);
    expect(заметки[0].body).toBe('Берёт шу коробками');

    const метка = db.get<{ tags: string }>('SELECT tags FROM counterparties WHERE id = ?', [стал]);
    expect(метка?.tags).toBe('опт');
  });

  it('дело возвращается со своим сроком и отметкой', () => {
    const был = клиент('Никита', '89046530214');
    db.run(
      `INSERT INTO client_tasks (counterparty_id, title, due_date, done_at, created_at)
       VALUES (?, 'Позвонить про пуэр', '2026-09-15', NULL, '2026-09-08T10:00:00.000Z')`,
      [был],
    );

    const kept = keepCrm(db);
    resetSeed(db);
    const стал = клиент('Никита', '89046530214');
    restoreCrm(db, kept);

    const [дело] = db.all<{ counterparty_id: number; due_date: string; done_at: string | null }>(
      'SELECT * FROM client_tasks',
    );
    expect(дело.counterparty_id).toBe(стал);
    expect(дело.due_date).toBe('2026-09-15');
    expect(дело.done_at).toBeNull();
  });

  /** Иначе заметка про исчезнувшего прицепилась бы к случайному человеку. */
  it('заметку о пропавшем из выгрузки клиенте молча выбрасывает', () => {
    const был = клиент('Удалённый', '89001112233');
    db.run(
      "INSERT INTO client_notes (counterparty_id, body, created_at) VALUES (?, 'Что-то', '2026-09-08T10:00:00.000Z')",
      [был],
    );

    const kept = keepCrm(db);
    resetSeed(db);
    клиент('Совсем другой', '89998887766');
    restoreCrm(db, kept);

    expect(db.all('SELECT * FROM client_notes')).toHaveLength(0);
  });

  /** Очистка снимает внешние ключи, поэтому сироты не удалились бы сами. */
  it('очистка не оставляет заметок, висящих на стёртых карточках', () => {
    const был = клиент('Кто-то', '89001112233');
    db.run(
      "INSERT INTO client_notes (counterparty_id, body, created_at) VALUES (?, 'Заметка', '2026-09-08T10:00:00.000Z')",
      [был],
    );

    resetSeed(db);
    expect(db.all('SELECT * FROM client_notes')).toHaveLength(0);
  });
});
