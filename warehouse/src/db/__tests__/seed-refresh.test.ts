import { createTestDriver } from '../testDriver';
import type { SqlDriver } from '../driver';
import { ensureLocation } from '../locations';
import { createProduct } from '../products';
import { createSale } from '../sales';
import {
  seedStamp,
  loadedSeedStamp,
  rememberSeedStamp,
  resetSeed,
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

    expect(
      db.get<{ n: string }>('SELECT name AS n FROM products WHERE code = ?', ['00145'])?.n,
    ).toBe('Габа Алишань');

    // Бонусный счёт клиента переносится вместе с карточкой: он приходит из
    // CloudShop итогом, а не строками чеков, и без него карточка пустая.
    expect(
      db.get<{ b: number }>('SELECT bonus_balance AS b FROM counterparties WHERE name = ?', [
        'Монтеро Антонио',
      ])?.b,
    ).toBe(16_450);
  });
});
