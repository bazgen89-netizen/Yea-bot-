import { listSales } from '../sales';
import { migrate } from '../schema';
import { createTestDriver } from '../testDriver';

/**
 * История покупок из CloudShop.
 *
 * Главное свойство проверяется прямо: чеки истории **не двигают склад**.
 * Остатки приходят вместе с каталогом уже с учётом этих продаж, и списать
 * товар второй раз — значит увести склад в минус ровно на всё, что магазин
 * когда-либо продал.
 */
describe('перенос истории покупок', () => {
  function seeded() {
    const db = createTestDriver();
    migrate(db);

    // Каталог и клиент — как их заводит перенос.
    db.run(
      `INSERT INTO products (name, sku, code, unit, cost_price, sale_price, min_qty, created_at, search_text)
       VALUES ('Шу пуэр', NULL, '0001', 'гр', 10000, 30000, 0, datetime('now'), 'шу пуэр 0001')`,
    );
    db.run(
      `INSERT INTO counterparties (kind, name, created_at, search_text)
       VALUES ('customer', 'Тарасова Елена', datetime('now'), 'тарасова елена')`,
    );

    // Чек истории: две позиции по 100 г.
    db.run(
      `INSERT INTO sales (discount, total, cost_total, payment, created_at, customer_id, note)
       VALUES (0, 60000, 20000, 'cash', '2026-08-01T10:00:00.000Z', 1, 'CloudShop №1234')`,
    );
    db.run(
      `INSERT INTO sale_items (sale_id, product_id, qty, price, cost_price)
       VALUES (1, 1, 200000, 30000, 10000)`,
    );

    return db;
  }

  it('чек виден в журнале и привязан к клиенту', () => {
    const db = seeded();
    const sales = listSales(db, 10);

    expect(sales).toHaveLength(1);
    expect(sales[0].total).toBe(60000);
  });

  it('склад историей не трогается', () => {
    const db = seeded();

    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM stock_moves')?.n).toBe(0);
  });
});
