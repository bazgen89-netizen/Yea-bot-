import { createTestDriver } from '../testDriver';
import type { SqlDriver } from '../driver';
import { ensureLocation } from '../locations';
import { createProduct } from '../products';
import { createSale } from '../sales';
import { checkSql, runSql, UnsafeSql } from '../ask';
import { describeSchema } from '../askSchema';

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

    it('на пустой ответ не падает, а честно говорит «ничего»', () => {
      const итог = runSql(db, "SELECT name FROM products WHERE name = 'такого нет'");
      expect(итог.total).toBe(0);
      expect(итог.rows).toEqual([]);
    });

    /**
     * Длинный ответ обрезается для показа, но общее число называется: «первые
     * 200 из 1043» — это разные вещи, и путать их нельзя.
     */
    it('показывает не больше двухсот строк, но говорит, сколько всего', () => {
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
      expect(итог.rows.length).toBe(200);
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

    it('не рассказывает про служебные таблицы', () => {
      const описание = describeSchema(db);

      // Токен сервера лежит в `server`, и помощнику там делать нечего.
      expect(описание).not.toContain('server ');
      expect(описание).not.toContain('sync_outbox');
      expect(описание).not.toContain('app_state');
    });
  });
});
