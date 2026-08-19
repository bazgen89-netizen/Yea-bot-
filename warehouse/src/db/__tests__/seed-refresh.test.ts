import { createTestDriver } from '../testDriver';
import type { SqlDriver } from '../driver';
import {
  SEED_STAMP,
  loadedSeedStamp,
  rememberSeedStamp,
  resetSeed,
  seedCatalog,
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

    expect(loadedSeedStamp(db)).toBe(SEED_STAMP);
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
    if (loadedSeedStamp(db) !== SEED_STAMP) resetSeed(db);
    seedCatalog(db);
    rememberSeedStamp(db);

    expect(count('products')).toBe(products);
    expect(count('sales')).toBe(sales);
    expect(loadedSeedStamp(db)).toBe(SEED_STAMP);
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
