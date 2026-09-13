import { createTestDriver } from '../testDriver';
import type { SqlDriver } from '../driver';
import { archiveProduct, createProduct, listProducts, restoreProduct } from '../products';
import { archiveCounterparty, createCounterparty } from '../counterparties';
import { ВИДЫ, countTrash, listTrash, restoreFromTrash, restoreMany } from '../trash';

/**
 * Корзина.
 *
 * Вазген прокликал разделы своего CloudShop и сказал сверить с нашими. У него
 * корзина живая: список удалённого с датой, отбор по виду и за период, кнопка
 * «Восстановить». У нас на её месте стояло «Раздел в работе».
 */

let db: SqlDriver;

beforeEach(() => {
  db = createTestDriver();
});

function товар(name: string, sku: string | null = null) {
  return createProduct(db, {
    name,
    sku,
    barcode: null,
    category_id: null,
    unit: 'шт',
    cost_price: 0,
    sale_price: 10000,
    min_qty: 0,
    photo_uri: null,
  });
}

describe('что попадает в корзину', () => {
  it('пока ничего не удаляли — пусто', () => {
    товар('Шу пуэр');
    expect(listTrash(db)).toEqual([]);
    expect(countTrash(db)).toBe(0);
  });

  it('удалённый товар появляется в корзине с датой', () => {
    const id = товар('Шу пуэр', '8886241');
    archiveProduct(db, id);

    const корзина = listTrash(db);

    expect(корзина).toHaveLength(1);
    expect(корзина[0].name).toBe('Шу пуэр');
    expect(корзина[0].вид).toBe('product');
    expect(корзина[0].note).toBe('8886241');
    // Дата ставится сама, при удалении: у него в корзине она и есть главное.
    expect(корзина[0].archived_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('живой товар в корзину не попадает', () => {
    товар('Живой');
    const id = товар('Удалённый');
    archiveProduct(db, id);

    expect(listTrash(db).map((строка) => строка.name)).toEqual(['Удалённый']);
  });

  it('контрагенты лежат там же, но своим видом', () => {
    const id = createCounterparty(db, { kind: 'customer', name: 'Пётр', phone: '+79990000000' });
    archiveCounterparty(db, id);

    const корзина = listTrash(db);
    expect(корзина).toHaveLength(1);
    expect(корзина[0].вид).toBe('counterparty');
    expect(ВИДЫ[корзина[0].вид]).toBe('Контрагенты');
  });
});

describe('отбор', () => {
  it('по виду — только он', () => {
    archiveProduct(db, товар('Товар'));
    archiveCounterparty(db, createCounterparty(db, { kind: 'customer', name: 'Клиент' }));

    expect(listTrash(db, { вид: 'product' }).map((с) => с.name)).toEqual(['Товар']);
    expect(listTrash(db, { вид: 'counterparty' }).map((с) => с.name)).toEqual(['Клиент']);
    expect(listTrash(db)).toHaveLength(2);
  });

  it('за период — по дате удаления', () => {
    const id = товар('Старый');
    archiveProduct(db, id);
    // Подменяем дату: в жизни она набежит сама, а тесту ждать сутки незачем.
    db.run("UPDATE products SET archived_at = '2026-09-01 12:00:00' WHERE id = ?", [id]);

    expect(listTrash(db, { от: '2026-09-01', до: '2026-09-01' })).toHaveLength(1);
    expect(listTrash(db, { от: '2026-09-02', до: '2026-09-30' })).toHaveLength(0);
    // Границы включаются: удалённое в первый день периода видно.
    expect(listTrash(db, { от: '2026-08-25', до: '2026-09-01' })).toHaveLength(1);
  });
});

describe('порядок', () => {
  it('свежее сверху, а то, у чего даты нет, — в конце', () => {
    const первый = товар('Первый');
    const второй = товар('Второй');
    const безДаты = товар('Без даты');
    archiveProduct(db, первый);
    archiveProduct(db, второй);
    archiveProduct(db, безДаты);

    db.run("UPDATE products SET archived_at = '2026-09-01 10:00:00' WHERE id = ?", [первый]);
    db.run("UPDATE products SET archived_at = '2026-09-05 10:00:00' WHERE id = ?", [второй]);
    // Так выглядит всё, что удалили до появления колонки: даты взять неоткуда.
    db.run('UPDATE products SET archived_at = NULL WHERE id = ?', [безДаты]);

    expect(listTrash(db).map((с) => с.name)).toEqual(['Второй', 'Первый', 'Без даты']);
  });
});

describe('возврат', () => {
  it('товар возвращается в справочник и уходит из корзины', () => {
    const id = товар('Вернулся');
    archiveProduct(db, id);
    expect(listProducts(db).some((т) => т.name === 'Вернулся')).toBe(false);

    restoreFromTrash(db, 'product', id);

    expect(listTrash(db)).toEqual([]);
    expect(listProducts(db).some((т) => т.name === 'Вернулся')).toBe(true);
  });

  it('дата удаления стирается — иначе он вернётся в корзину со старой', () => {
    const id = товар('Вернулся');
    archiveProduct(db, id);
    restoreFromTrash(db, 'product', id);
    archiveProduct(db, id);

    const дата = listTrash(db)[0].archived_at;
    expect(дата).not.toBeNull();
  });

  it('несколько разом — и всё одной транзакцией', () => {
    const a = товар('Раз');
    const b = товар('Два');
    const клиент = createCounterparty(db, { kind: 'customer', name: 'Три' });
    archiveProduct(db, a);
    archiveProduct(db, b);
    archiveCounterparty(db, клиент);

    const сколько = restoreMany(db, [
      { вид: 'product', id: a },
      { вид: 'product', id: b },
      { вид: 'counterparty', id: клиент },
    ]);

    expect(сколько).toBe(3);
    expect(listTrash(db)).toEqual([]);
  });

  it('возврат того, чего нет, ничего не ломает', () => {
    archiveProduct(db, товар('Один'));
    restoreFromTrash(db, 'product', 99999);
    expect(listTrash(db)).toHaveLength(1);
  });

  it('прежний restoreProduct работает так же — он и есть возврат', () => {
    const id = товар('Через справочник');
    archiveProduct(db, id);
    restoreProduct(db, id);

    expect(listTrash(db)).toEqual([]);
  });
});

describe('счётчик', () => {
  it('считает всё вместе, независимо от вида', () => {
    archiveProduct(db, товар('Товар'));
    archiveCounterparty(db, createCounterparty(db, { kind: 'supplier', name: 'Поставщик' }));

    expect(countTrash(db)).toBe(2);
  });
});
