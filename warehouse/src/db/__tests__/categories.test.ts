import { listCategoryViews, reorderCategories, setCategoryBig, setCategoryColor, setCategoryHidden } from '../categories';
import { listCategoryTiles, listProducts } from '../products';
import { createProduct } from '../products';
import { createTestDriver } from '../testDriver';
import { migrate } from '../schema';

/**
 * Категории на витрине: цвет, порядок, размер и скрытие.
 *
 * Проверяется не то, что поля записались, а что от них зависит показ:
 * скрытая категория пропадает с витрины вместе с товарами, а переключатель
 * в настройках возвращает товары, не возвращая плитку.
 */
describe('вид категорий', () => {
  function seed() {
    const db = createTestDriver();
    migrate(db);
    db.run("INSERT INTO categories (name, sort) VALUES ('Белый чай', 0)");
    db.run("INSERT INTO categories (name, sort) VALUES ('Зелёный чай', 1)");

    const base = {
      sku: null,
      barcode: null,
      unit: 'гр',
      cost_price: 0,
      min_qty: 0,
      photo_uri: null,
    };
    createProduct(db, { ...base, name: 'Бай Хао', category_id: 1, sale_price: 10000 });
    createProduct(db, { ...base, name: 'Лун Цзин', category_id: 2, sale_price: 20000 });
    return db;
  }

  it('порядок держится номером, а не названием', () => {
    const db = seed();
    reorderCategories(db, [2, 1]);

    expect(listCategoryViews(db).map((row) => `${row.name} - ${row.sort}`)).toEqual([
      'Зелёный чай - 0',
      'Белый чай - 1',
    ]);
  });

  it('скрытая категория уходит с витрины вместе с товарами', () => {
    const db = seed();
    setCategoryHidden(db, 1, true);

    expect(listCategoryTiles(db).map((tile) => tile.name)).toEqual(['Зелёный чай']);
    expect(
      listProducts(db, { hideHiddenCategories: true }).map((product) => product.name),
    ).toEqual(['Лун Цзин']);

    // А переключатель в настройках возвращает товары — плитку не возвращая.
    expect(listProducts(db, {}).map((product) => product.name).sort()).toEqual([
      'Бай Хао',
      'Лун Цзин',
    ]);
  });

  it('цвет и размер доходят до плитки', () => {
    const db = seed();
    setCategoryColor(db, 1, '#EF9A9A');
    setCategoryBig(db, 1, true);

    const tile = listCategoryTiles(db).find((row) => row.name === 'Белый чай');
    expect(tile?.color).toBe('#EF9A9A');
    expect(tile?.big).toBe(true);
  });
});
