import type { SqlDriver } from '../driver';
import { createTestDriver } from '../testDriver';
import { ensureLocation } from '../locations';
import {
  createProduct,
  getProduct,
  ensureCategory,
  listCategories,
  listPacks,
  productCategories,
  saveCategories,
  savePacks,
  saveSetItems,
  saveStorePrices,
  setItems,
  storePrices,
} from '../products';
import { postDoc } from '../stock';

let db: SqlDriver;

beforeEach(() => {
  db = createTestDriver();
});

function make(name: string, over: Partial<Parameters<typeof createProduct>[1]> = {}) {
  return createProduct(db, {
    name,
    sku: null,
    barcode: null,
    category_id: null,
    unit: 'шт',
    cost_price: 0,
    sale_price: 10000,
    min_qty: 0,
    photo_uri: null,
    ...over,
  });
}

describe('состав комплекта', () => {
  it('считает стоимость по текущим ценам входящих товаров', () => {
    const osmanthus = make('Гуй Хуа (Османтус) гр.', { unit: 'гр', sale_price: 2200 });
    const blend = make('Чайный сбор', { sale_price: 100 });
    const set = make('Османтус доп', { kind: 'set', sale_price: 5000 });

    saveSetItems(db, set, [
      { product_id: osmanthus, qty: 2000 },
      { product_id: blend, qty: 28000 },
    ]);

    const items = setItems(db, set);
    expect(items).toHaveLength(2);

    const first = items.find((i) => i.product_id === osmanthus)!;
    // 2 грамма по 22,00 — 44,00. Ровно как у него в карточке комплекта.
    expect(first.sum).toBe(4400);

    const second = items.find((i) => i.product_id === blend)!;
    // 28 штук по 1,00 — 28,00.
    expect(second.sum).toBe(2800);
  });

  it('подорожавший товар делает комплект дороже сам собой', () => {
    const tea = make('Чай', { sale_price: 10000 });
    const set = make('Набор', { kind: 'set' });
    saveSetItems(db, set, [{ product_id: tea, qty: 1000 }]);

    expect(setItems(db, set)[0].sum).toBe(10000);

    db.run('UPDATE products SET sale_price = ? WHERE id = ?', [20000, tea]);

    // Состав хранит ссылку и количество, а не цену — пересчёт не нужен.
    expect(setItems(db, set)[0].sum).toBe(20000);
  });

  it('сохранение заменяет состав целиком', () => {
    const a = make('А');
    const b = make('Б');
    const set = make('Набор', { kind: 'set' });

    saveSetItems(db, set, [{ product_id: a, qty: 1000 }]);
    saveSetItems(db, set, [{ product_id: b, qty: 2000 }]);

    expect(setItems(db, set).map((i) => i.name)).toEqual(['Б']);
  });
});

describe('цены по магазинам', () => {
  it('заводятся только там, где отличаются от общей', () => {
    const shopA = ensureLocation(db, 'Рынок');
    const shopB = ensureLocation(db, 'Чайный бар');
    const tea = make('Чай', { sale_price: 5000 });

    saveStorePrices(db, tea, new Map([[shopA, 7000]]));

    const prices = storePrices(db, tea);
    expect(prices.get(shopA)).toBe(7000);
    // У второго магазина своей цены нет — значит действует общая.
    expect(prices.has(shopB)).toBe(false);
    expect(getProduct(db, tea)!.sale_price).toBe(5000);
  });

  it('пустая цена возвращает магазин к общей, а не запоминает копию', () => {
    const shop = ensureLocation(db, 'Рынок');
    const tea = make('Чай', { sale_price: 5000 });

    saveStorePrices(db, tea, new Map([[shop, 7000]]));
    saveStorePrices(db, tea, new Map([[shop, null]]));

    expect(storePrices(db, tea).has(shop)).toBe(false);
  });
});

describe('цена закупки и себестоимость — разные числа', () => {
  it('после двух закупок расходятся', () => {
    const tea = make('Чай');
    postDoc(db, {
      type: 'purchase',
      lines: [{ product_id: tea, name: 'Чай', unit: 'шт', qty: 1000, price: 10000 }],
    });
    postDoc(db, {
      type: 'purchase',
      lines: [{ product_id: tea, name: 'Чай', unit: 'шт', qty: 1000, price: 20000 }],
    });

    const product = getProduct(db, tea)!;
    // Себестоимость — среднее по складу, цена закупки — из последней накладной.
    expect(product.cost_price).toBe(15000);
    expect(product.purchase_price).toBe(20000);
  });
});

describe('упаковки', () => {
  it('сохраняются и читаются в порядке от меньшей к большей', () => {
    const tea = make('Шу пуэр', { unit: 'кг' });

    savePacks(db, tea, [
      { name: 'Палета', qty: 120000 },
      { name: 'Коробка', qty: 12000 },
    ]);

    expect(listPacks(db, tea).map((pack) => pack.name)).toEqual(['Коробка', 'Палета']);
  });

  it('пустые строки формы не попадают в базу', () => {
    const tea = make('Шу пуэр');

    // Нажали «Добавить упаковку» и не заполнили — такие строки остаются в
    // форме, и записывать их значило бы завести упаковку без названия.
    savePacks(db, tea, [
      { name: 'Коробка', qty: 12000 },
      { name: '', qty: 0 },
      { name: 'Блок', qty: 0 },
    ]);

    expect(listPacks(db, tea)).toHaveLength(1);
  });

  it('сохранение заменяет список целиком', () => {
    const tea = make('Шу пуэр');

    savePacks(db, tea, [{ name: 'Коробка', qty: 12000 }]);
    savePacks(db, tea, [{ name: 'Блок', qty: 6000 }]);

    expect(listPacks(db, tea).map((pack) => pack.name)).toEqual(['Блок']);
  });
});

describe('категории товара', () => {
  it('их несколько, а в карточку попадает первая', () => {
    const tea = make('Шу пуэр 2019');

    saveCategories(db, tea, ['Пуэр', 'Подарочное']);

    expect(productCategories(db, tea)).toEqual(['Подарочное', 'Пуэр']);

    // На products.category_id стоят отчёт по категориям и колонка
    // справочника — она должна указывать на первую из выбранных.
    const saved = getProduct(db, tea)!;
    expect(saved.category_name).toBe('Пуэр');
  });

  it('новая категория заводится по ходу, повтор — нет', () => {
    const first = make('Шу пуэр');
    const second = make('Шэн пуэр');

    saveCategories(db, first, ['Пуэр']);
    saveCategories(db, second, ['Пуэр']);

    expect(listCategories(db).filter((item) => item.name === 'Пуэр')).toHaveLength(1);
  });

  it('снятая категория исчезает из списка товара', () => {
    const tea = make('Шу пуэр');

    saveCategories(db, tea, ['Пуэр', 'Подарочное']);
    saveCategories(db, tea, ['Пуэр']);

    expect(productCategories(db, tea)).toEqual(['Пуэр']);
    expect(getProduct(db, tea)!.category_name).toBe('Пуэр');
  });

  it('товару из импорта список собирается из его собственной категории', () => {
    // Импорт и касса заполняют одну колонку в карточке и списка не заводят.
    // Карточка всё равно должна открыться с этой категорией, а не пустой.
    const tea = make('Шу пуэр', { category_id: ensureCategory(db, 'Пуэр') });

    expect(productCategories(db, tea)).toEqual(['Пуэр']);
  });

  it('без категорий товар остаётся без категории', () => {
    const tea = make('Шу пуэр');

    saveCategories(db, tea, ['Пуэр']);
    saveCategories(db, tea, []);

    expect(productCategories(db, tea)).toEqual([]);
    expect(getProduct(db, tea)!.category_id).toBeNull();
  });
});
