import { applyPrices, archiveProducts, setCategoryFor } from '../bulk';
import { createProduct, listProducts } from '../products';
import { repricedTo } from '../../domain/pricing';
import { migrate } from '../schema';
import { createTestDriver } from '../testDriver';

/**
 * Действия сразу над списком товаров.
 *
 * Тест не только про итог, но и про то, что запросы вообще выполняются:
 * первая версия писала в колонку `updated_at`, которой в таблице нет, —
 * транзакция падала, изменения откатывались, а на экране всё выглядело
 * сделанным, потому что окно показывало пример пересчёта, а не данные.
 */
describe('действия над списком товаров', () => {
  function seed() {
    const db = createTestDriver();
    migrate(db);
    db.run("INSERT INTO categories (name, sort) VALUES ('Пуэр', 0)");

    const base = { sku: null, barcode: null, unit: 'гр', cost_price: 0, min_qty: 0, photo_uri: null };
    createProduct(db, { ...base, name: 'Шу', category_id: null, sale_price: 30000 });
    createProduct(db, { ...base, name: 'Шэн', category_id: null, sale_price: 50000 });
    return db;
  }

  it('поднимает цены на проценты и сохраняет их', () => {
    const db = seed();
    const before = listProducts(db, {});

    applyPrices(
      db,
      before.map((product) => ({
        id: product.id,
        price: repricedTo(product.sale_price, { mode: 'percent', value: 1000 }),
      })),
    );

    expect(listProducts(db, {}).map((product) => product.sale_price)).toEqual([33000, 55000]);
  });

  it('переносит товары в категорию', () => {
    const db = seed();
    setCategoryFor(db, listProducts(db, {}).map((product) => product.id), 1);

    expect(listProducts(db, { categoryId: 1 })).toHaveLength(2);
  });

  it('удаляет в архив, а не насовсем', () => {
    const db = seed();
    archiveProducts(db, [listProducts(db, {})[0].id]);

    expect(listProducts(db, {})).toHaveLength(1);
    expect(listProducts(db, { includeArchived: true })).toHaveLength(2);
  });
});
