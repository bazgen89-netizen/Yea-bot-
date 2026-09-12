import { createCounterparty, getCounterparty, listCounterparties } from '../counterparties';
import type { SqlDriver } from '../driver';
import { catalogCsv, partiesCsv } from '../export';
import { importParties } from '../import';
import { createProduct } from '../products';
import { createTestDriver } from '../testDriver';

/**
 * Выгрузка и загрузка — одна дорога в обе стороны.
 *
 * Смысл этих проверок не в том, что файл получился, а в том, что он
 * **возвращается**: выгрузил справочник, поправил в таблице, залил обратно —
 * и ничего не потерялось и не задвоилось. Если заголовок колонки разойдётся
 * со словом, по которому его ищет импорт, поле молча обнулится при загрузке,
 * и заметить это по глазам невозможно.
 */
describe('выгрузка справочников', () => {
  let db: SqlDriver;

  beforeEach(() => {
    db = createTestDriver();
  });

  it('клиенты выгружаются со всеми полями карточки', () => {
    createCounterparty(db, {
      kind: 'customer',
      name: 'Рудник Михаил',
      phones: ['+7 (961) 253-27-57', '89001112233'],
      email: 'rudnik@example.com',
      birthday: '12.07.2006',
      gender: 'Мужской',
      address: 'Нижний Новгород, Студёная 5',
      note: 'Любит шу пуэр',
      discount_bp: 1000,
      discount_card: 'K-77',
      loyalty_type: 'bonus',
      bonus_balance: 22950,
      bonus_spent: 5000,
      cashback_bp: 300,
      created_by: 'waystea',
    });

    const csv = partiesCsv(db, 'customer');

    expect(csv).toContain('Рудник Михаил');
    expect(csv).toContain('89001112233');
    expect(csv).toContain('12.07.2006');
    expect(csv).toContain('Мужской');
    expect(csv).toContain('Студёная 5');
    expect(csv).toContain('Любит шу пуэр');
    expect(csv).toContain('K-77');
    expect(csv).toContain('229,50');
    expect(csv).toContain('waystea');

    // Основной телефон не должен повторяться в колонке «Другие телефоны».
    const line = csv.split('\r\n')[1];
    expect(line.match(/9612532757|961\) 253-27-57/g)?.length).toBe(1);
  });

  it('выгруженные клиенты грузятся обратно, не задваиваясь', () => {
    createCounterparty(db, {
      kind: 'customer',
      name: 'Рудник Михаил',
      phone: '+7 (961) 253-27-57',
      birthday: '12.07.2006',
      discount_bp: 1000,
      bonus_balance: 22950,
      cashback_bp: 300,
      note: 'Любит шу пуэр',
    });

    const csv = partiesCsv(db, 'customer');
    const result = importParties(db, csv.replace(/^﻿/, ''), 'customer');

    expect(result.added).toBe(0);
    expect(result.updated).toBe(1);
    expect(listCounterparties(db, { kind: 'customer' })).toHaveLength(1);

    const back = listCounterparties(db, { kind: 'customer' })[0];
    expect(back.birthday).toBe('12.07.2006');
    expect(back.discount_bp).toBe(1000);
    expect(back.note).toBe('Любит шу пуэр');
  });

  it('бонусы и кешбэк переживают обратную загрузку', () => {
    const id = createCounterparty(db, {
      kind: 'customer',
      name: 'Анна',
      phone: '89990001122',
      bonus_balance: 22950,
      bonus_spent: 5000,
      cashback_bp: 300,
      discount_card: 'K-77',
      loyalty_type: 'bonus',
    });

    // Правим файл так, как правил бы человек в таблице: меняем бонусы.
    const csv = partiesCsv(db, 'customer').replace('229,50', '300,00');
    importParties(db, csv.replace(/^﻿/, ''), 'customer');

    const back = getCounterparty(db, id)!;
    expect(back.bonus_balance).toBe(30000);
    expect(back.bonus_spent).toBe(5000);
    expect(back.cashback_bp).toBe(300);
    expect(back.discount_card).toBe('K-77');
  });

  it('каталог выгружается со всеми полями карточки', () => {
    createProduct(db, {
      name: 'Пиала узор',
      code: '01527',
      sku: '8883113',
      barcode: '2001527000007',
      plu_code: '42',
      unit: 'шт',
      category_id: null,
      min_qty: 0,
      photo_uri: null,
      sale_price: 75000,
      cost_price: 30000,
      discount_bp: 500,
      description: 'Керамика, ручная роспись',
      weight_g: 120,
      height_mm: 50,
      width_mm: 80,
      depth_mm: 80,
    });

    const csv = catalogCsv(db);

    expect(csv).toContain('01527');
    expect(csv).toContain('8883113');
    expect(csv).toContain('2001527000007');
    expect(csv).toContain('Керамика, ручная роспись');
    expect(csv).toContain('120');
    expect(csv).toContain('750,00');
  });
});
