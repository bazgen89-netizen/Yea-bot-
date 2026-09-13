import { createTestDriver } from '../testDriver';
import type { SqlDriver } from '../driver';
import { ensureLocation } from '../locations';
import { createProduct } from '../products';
import { createSale } from '../sales';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkSql, runSql, UnsafeSql } from '../ask';
import { describeSchema } from '../askSchema';
import { ПРАВИЛА } from '../../domain/askPrompt';

/**
 * Помощник: что он присылает и что из этого выполняется.
 *
 * Проверяется главное: запрос приехал снаружи, и доверия ему нет. Между
 * моделью и базой лежит интернет, где ответ может подменить кто угодно, да и
 * сама модель ошибается. Поэтому здесь не «функция вернула строку», а
 * «испорченный запрос до базы не дошёл».
 */
describe('запрос от помощника', () => {
  let db: SqlDriver;

  beforeEach(() => {
    db = createTestDriver();
  });

  const заводимЧай = () =>
    createProduct(db, {
      name: 'Габа Алишань',
      sku: null,
      barcode: null,
      category_id: null,
      unit: 'гр',
      cost_price: 3_000,
      sale_price: 10_000,
      min_qty: 0,
      photo_uri: null,
    });

  describe('что не выполняется', () => {
    it('всё, что меняет базу', () => {
      for (const плохой of [
        'DELETE FROM products',
        'UPDATE products SET sale_price = 0',
        "INSERT INTO products (name) VALUES ('х')",
        'DROP TABLE sales',
        'PRAGMA table_list',
        'ATTACH DATABASE "чужая.db" AS чужая',
      ]) {
        expect(() => checkSql(плохой)).toThrow(UnsafeSql);
      }
    });

    /**
     * Так и подкладывают: безобидная выборка, точка с запятой, и следом
     * «удали всё». Один запрос — значит один.
     */
    it('второй запрос, приписанный к первому', () => {
      expect(() => checkSql('SELECT 1; DELETE FROM sales')).toThrow(/больше одной команды/);
    });

    it('спрятанное в середине выборки', () => {
      expect(() =>
        checkSql('SELECT * FROM products WHERE id IN (SELECT 1) UNION SELECT 1 FROM sqlite_master'),
      ).not.toThrow();

      // А вот это уже правка, пусть и внутри выборки.
      expect(() => checkSql('WITH x AS (DELETE FROM sales RETURNING 1) SELECT * FROM x')).toThrow(
        UnsafeSql,
      );
    });

    it('пустой ответ', () => {
      expect(() => checkSql('   ')).toThrow(/не прислал запрос/);
    });
  });

  describe('что выполняется', () => {
    it('выборка с точкой с запятой на конце — точка отрезается', () => {
      expect(checkSql('SELECT 1;  ')).toBe('SELECT 1');
    });

    it('WITH в начале — это тоже чтение', () => {
      expect(checkSql('WITH x AS (SELECT 1 AS a) SELECT a FROM x')).toContain('WITH');
    });

    /** Ради чего всё: настоящий вопрос про настоящий склад. */
    it('считает выручку по местной базе', () => {
      const бар = ensureLocation(db, 'Чайный бар');
      const чай = заводимЧай();
      db.run(
        `INSERT INTO stock_moves (product_id, qty_delta, reason, price, location_id, created_at)
         VALUES (?, 10000, 'receipt', 3000, ?, '2026-08-01T08:00:00.000Z')`,
        [чай, бар],
      );
      createSale(db, {
        lines: [
          {
            product_id: чай,
            name: 'Габа Алишань',
            qty: 2_000,
            price: 10_000,
            cost_price: 3_000,
            unit: 'гр',
            stock: 10_000,
          },
        ],
        locationId: бар,
        payment: 'cash',
      });

      const итог = runSql(
        db,
        `SELECT p.name AS "Товар",
                SUM(i.qty) / 1000.0 AS "Продано, гр",
                ROUND(SUM(i.qty * i.price / 1000) / 100.0, 2) AS "Выручка, ₽"
           FROM sale_items i JOIN products p ON p.id = i.product_id
          GROUP BY p.id`,
      );

      expect(итог.columns).toEqual(['Товар', 'Продано, гр', 'Выручка, ₽']);
      expect(итог.total).toBe(1);
      // Два грамма по сто рублей за грамм — двести рублей.
      expect(итог.rows[0]).toEqual(['Габа Алишань', 2, 200]);
    });

    it('остаток считает суммой движений, а не колонкой', () => {
      const бар = ensureLocation(db, 'Чайный бар');
      const чай = заводимЧай();
      db.run(
        `INSERT INTO stock_moves (product_id, qty_delta, reason, location_id, created_at)
         VALUES (?, 10000, 'receipt', ?, '2026-08-01T08:00:00.000Z'),
                (?, -2500, 'sale', ?, '2026-08-02T08:00:00.000Z')`,
        [чай, бар, чай, бар],
      );

      const итог = runSql(
        db,
        'SELECT SUM(qty_delta) / 1000.0 AS "Остаток, гр" FROM stock_moves',
      );
      expect(итог.rows[0]).toEqual([7.5]);
    });

    /**
     * Поиск по русскому названию.
     *
     * Он спросил «сколько продано пуэра за август» и сказал: показало очень
     * мало. Так и было. У него 373 товара со словом «пуэр», но со строчной
     * буквы написаны только 53 — остальные «Шу Пуэр», «Шэн Пуэр». А SQLite
     * русские буквы к строчным не приводит: lower('Шу Пуэр') так и остаётся
     * 'Шу Пуэр', и LIKE '%пуэр%' его не находит.
     *
     * Хуже всего, что врёт это молча: запрос выполняется, таблица выходит
     * куцая, и человек решает, что столько и продано. Поэтому искать надо по
     * `search_text`, куда название кладётся строчными ещё в программе.
     */
    it('находит товар по названию независимо от заглавных букв', () => {
      for (const name of ['Шу Пуэр Золотой Бутон', 'Шэн Пуэр Булан', 'Шу пуэр блин Гу юнь']) {
        createProduct(db, {
          name,
          sku: null,
          barcode: null,
          category_id: null,
          unit: 'гр',
          cost_price: 0,
          sale_price: 100,
          min_qty: 0,
          photo_uri: null,
        });
      }

      // Так писала модель — и находила меньшинство.
      const было = runSql(
        db,
        `SELECT name AS "Товар" FROM products WHERE lower(name) LIKE '%пуэр%'`,
      );
      expect(было.total).toBe(1);

      // Так надо — и находятся все три.
      const стало = runSql(
        db,
        `SELECT name AS "Товар" FROM products WHERE search_text LIKE '%пуэр%'`,
      );
      expect(стало.total).toBe(3);
    });

    it('на пустой ответ не падает, а честно говорит «ничего»', () => {
      const итог = runSql(db, "SELECT name FROM products WHERE name = 'такого нет'");
      expect(итог.total).toBe(0);
      expect(итог.rows).toEqual([]);
    });

    /**
     * Найденное держится целиком, а двести показывает уже экран.
     *
     * Так надо, чтобы «упорядочить по убыванию» переставляло всё найденное, а
     * не первые двести между собой — иначе самое большое осталось бы за краем
     * и в таблицу не попало бы никогда.
     */
    it('держит найденное целиком, а не первую сотню', () => {
      for (let i = 0; i < 250; i += 1) {
        createProduct(db, {
          name: `Чай №${i}`,
          sku: null,
          barcode: null,
          category_id: null,
          unit: 'гр',
          cost_price: 0,
          sale_price: 100,
          min_qty: 0,
          photo_uri: null,
        });
      }

      const итог = runSql(db, 'SELECT name AS "Товар" FROM products');
      expect(итог.total).toBe(250);
      expect(итог.rows.length).toBe(250);
    });
  });

  /**
   * То, что уезжает наружу. Здесь важно не «строка не пустая», а что в ней
   * нет ни одной цифры магазина: уедут названия таблиц и колонок, и только.
   */
  describe('описание базы для помощника', () => {
    it('перечисляет таблицы и колонки', () => {
      const описание = describeSchema(db);

      expect(описание).toContain('products');
      expect(описание).toContain('sale_price');
      expect(описание).toContain('stock_moves');
      // Про главную странность базы сказано прямо, иначе помощник насчитает
      // выручку в сто раз больше настоящей.
      expect(описание).toContain('копейк');
      expect(описание).toContain('тысячных');
    });

    /**
     * Слова, которыми записаны оплата, движение и единица.
     *
     * Без них помощник угадывает: пишет `payment = 'наличные'` и получает
     * пусто. Ошибка выходит тихая — запрос выполнился, таблица пустая, и
     * человек решает, что за месяц ничего не продано. Это хуже честного
     * отказа, потому что выглядит как ответ.
     */
    it('называет служебные слова: оплату, движение, единицу', () => {
      const бар = ensureLocation(db, 'Чайный бар');
      const чай = заводимЧай();
      db.run(
        `INSERT INTO stock_moves (product_id, qty_delta, reason, location_id, created_at)
         VALUES (?, 1000, 'receipt', ?, '2026-08-01'), (?, -500, 'writeoff', ?, '2026-08-02')`,
        [чай, бар, чай, бар],
      );
      db.run(
        `INSERT INTO sales (total, cost_total, payment, created_at)
         VALUES (100, 50, 'cash', '2026-08-01'), (200, 60, 'card', '2026-08-02')`,
      );

      const описание = describeSchema(db);

      expect(описание).toMatch(/payment бывает только такой:.*'cash'/);
      expect(описание).toMatch(/reason бывает только такой:.*'receipt'/);
      expect(описание).toMatch(/unit бывает только такой:.*'гр'/);
    });

    /**
     * Словарь — это десяток служебных слов. Если значений много, это уже не
     * словарь, а содержимое магазина, и наружу оно не идёт.
     */
    it('длинный список значений наружу не выносит', () => {
      for (let i = 0; i < 40; i += 1) {
        createProduct(db, {
          name: `Чай №${i}`,
          sku: null,
          barcode: null,
          category_id: null,
          unit: `единица-${i}`,
          cost_price: 0,
          sale_price: 100,
          min_qty: 0,
          photo_uri: null,
        });
      }

      const описание = describeSchema(db);
      expect(описание).not.toContain('единица-7');
      expect(описание).not.toMatch(/unit бывает только такой/);
    });

    it('не выносит наружу ни одной строки данных', () => {
      ensureLocation(db, 'Чайный бар на Гагарина');
      заводимЧай();
      db.run("INSERT INTO counterparties (kind, name, phone, created_at) VALUES ('customer', ?, ?, '2026-01-01')", [
        'Пётр Иванович',
        '+79161234567',
      ]);

      const описание = describeSchema(db);

      expect(описание).not.toContain('Габа Алишань');
      expect(описание).not.toContain('Пётр Иванович');
      expect(описание).not.toContain('+79161234567');
      expect(описание).not.toContain('Гагарина');
    });

    /**
     * Колонки в описание попадают из самой базы, а пояснения к таблицам
     * написаны руками — и руками написанное расходится с базой молча.
     *
     * Так и вышло: в пояснении к чекам стояло «refunded_at не пусто у
     * возвращённых», а колонки `refunded_at` в базе нет вовсе — я перенёс её
     * из схемы сервера. На первом же живом вопросе помощник послушно взял
     * `s.refunded_at`, и запрос не выполнился. Ошибка была не его.
     *
     * Поэтому каждое имя вида `что_то` из пояснений сверяется с базой.
     */
    it('в пояснениях не упомянуто ни одной колонки, которой нет в базе', () => {
      const описание = describeSchema(db);

      // Всё, что выглядит как имя колонки или таблицы: два слова через
      // подчёркивание. Латиницей — русские слова так не пишутся.
      const имена = new Set(описание.match(/\b[a-z]+_[a-z_]+\b/g) ?? []);
      expect(имена.size).toBeGreaterThan(5);

      const настоящие = new Set<string>();
      const таблицы = db.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      );
      for (const { name } of таблицы) {
        настоящие.add(name);
        for (const column of db.all<{ name: string }>(`PRAGMA table_info(${name})`)) {
          настоящие.add(column.name);
        }
      }

      const выдуманные = [...имена].filter((имя) => !настоящие.has(имя));
      expect(выдуманные).toEqual([]);
    });

    /**
     * Единица у каждого товара своя.
     *
     * На это он и указал: помощник написал «Продано, кг», а у него из полутора
     * тысяч товаров тысяча сто в штуках, четыреста в граммах и пять в
     * килограммах. Единицу надо брать из `products.unit`, а не выдумывать —
     * и это должно быть сказано и в правилах, и в описании товаров.
     */
    it('про единицу товара сказано, что она у каждого своя', () => {
      expect(describeSchema(db)).toMatch(/unit — единица измерения ИМЕННО ЭТОГО товара/);
      expect(ПРАВИЛА).toContain('products.unit');
      expect(ПРАВИЛА).toMatch(/НИКОГДА не пиши единицу в названии колонки наугад/);
    });

    /**
     * Правила лежат в двух местах, и это не забытая копия: спросить можно
     * своим ключом (тогда правила берутся здесь) или через сервер магазина
     * (тогда там), а общей библиотеки у приложения и сервера нет — они даже
     * собираются по отдельности.
     *
     * Но раз копии две, они разойдутся молча: поправишь одну — и половина
     * магазинов получит помощника, который считает по-старому. Поэтому они
     * сверяются здесь.
     */
    it('правила на сервере — слово в слово те же', () => {
      const серверный = readFileSync(
        join(__dirname, '../../../../warehouse-server/src/core/assistant.ts'),
        'utf8',
      );

      const кусок = серверный.match(/export const RULES = `([\s\S]*?)`;\n/);
      expect(кусок).not.toBeNull();
      // На сервере обратные кавычки внутри строки экранированы — снимаем.
      expect(кусок![1].replace(/\\`/g, '`')).toBe(ПРАВИЛА);
    });

    it('не рассказывает про служебные таблицы', () => {
      const описание = describeSchema(db);

      // Токен сервера лежит в `server`, и помощнику там делать нечего.
      expect(описание).not.toContain('server ');
      expect(описание).not.toContain('sync_outbox');
      expect(описание).not.toContain('app_state');
    });
  });
});
