import type { SqlDriver } from '../driver';
import { createTestDriver } from '../testDriver';
import {
  archiveLocation,
  createLocation,
  listLocationsWithTotals,
  renameLocation,
} from '../locations';
import { accountBalances, createMoneyDoc } from '../money';
import { createProduct } from '../products';
import { createSale } from '../sales';
import { getSettings, saveSettings } from '../settings';
import { postDoc } from '../stock';
import type { CartLine } from '../../domain/types';

let db: SqlDriver;

beforeEach(() => {
  db = createTestDriver();
});

function product() {
  return createProduct(db, {
    name: 'Шу пуэр',
    sku: null,
    barcode: null,
    category_id: null,
    unit: 'кг',
    cost_price: 100000,
    sale_price: 200000,
    min_qty: 0,
    photo_uri: null,
  });
}

describe('магазины', () => {
  it('не заводит два магазина с одним названием', () => {
    createLocation(db, 'Ереван');
    expect(() => createLocation(db, ' Ереван ')).toThrow();
  });

  it('показывает, что в магазине лежит', () => {
    const shop = createLocation(db, 'Ереван');
    const id = product();
    postDoc(db, {
      type: 'purchase',
      locationId: shop,
      lines: [{ product_id: id, name: 'Шу пуэр', unit: 'кг', qty: 3000, price: 100000 }],
    });

    const [store] = listLocationsWithTotals(db);
    expect(store.positions).toBe(1);
    expect(store.quantity).toBe(3000);
    // 3 кг по цене продажи 2000,00.
    expect(store.retailValue).toBe(600000);
  });

  it('не убирает магазин, в котором лежит товар', () => {
    const shop = createLocation(db, 'Ереван');
    const id = product();
    postDoc(db, {
      type: 'purchase',
      locationId: shop,
      lines: [{ product_id: id, name: 'Шу пуэр', unit: 'кг', qty: 1000, price: 100000 }],
    });

    expect(() => archiveLocation(db, shop)).toThrow();

    postDoc(db, {
      type: 'writeoff',
      locationId: shop,
      lines: [{ product_id: id, name: 'Шу пуэр', unit: 'кг', qty: 1000, price: 100000 }],
    });
    archiveLocation(db, shop);
    expect(listLocationsWithTotals(db)).toHaveLength(0);
  });

  it('переименование не заводит новый магазин', () => {
    const shop = createLocation(db, 'Ереван');
    renameLocation(db, shop, 'Ереван, центр');

    const stores = listLocationsWithTotals(db);
    expect(stores).toHaveLength(1);
    expect(stores[0].name).toBe('Ереван, центр');
  });
});

describe('счета', () => {
  it('складывают остаток из чеков и документов', () => {
    const id = product();
    postDoc(db, {
      type: 'purchase',
      lines: [{ product_id: id, name: 'Шу пуэр', unit: 'кг', qty: 10000, price: 100000 }],
    });

    const line: CartLine = {
      product_id: id,
      name: 'Шу пуэр',
      unit: 'кг',
      qty: 1000,
      price: 200000,
      cost_price: 100000,
      stock: 10000,
    };

    createSale(db, { lines: [line], payment: 'cash' });
    createSale(db, { lines: [line], payment: 'card' });
    createMoneyDoc(db, { type: 'expense', amount: 50000, account: 'Касса магазина' });
    createMoneyDoc(db, {
      type: 'transfer',
      amount: 100000,
      account: 'Касса магазина',
      accountTo: 'Счет в банке',
    });

    const byName = new Map(accountBalances(db).map((row) => [row.name, row]));

    // 2000,00 наличными − 500,00 расход − 1000,00 перевод.
    expect(byName.get('Касса магазина')!.balance).toBe(50000);
    expect(byName.get('Терминал / Счет в банке')!.balance).toBe(200000);
    expect(byName.get('Счет в банке')!.balance).toBe(100000);
  });
});

describe('настройки компании', () => {
  it('возвращают умолчания, пока ничего не сохраняли', () => {
    expect(getSettings(db).name).toBe('WAYSTEA');
  });

  it('переживают появление новых полей', () => {
    // Так выглядит запись, сделанная версией, в которой полей было меньше.
    db.run('INSERT INTO app_state (key, value) VALUES (?, ?)', [
      'company_settings',
      JSON.stringify({ name: 'Чайная' }),
    ]);

    const settings = getSettings(db);
    expect(settings.name).toBe('Чайная');
    expect(settings.taxSystem).toBe('УСН «Доходы»');
  });

  it('сохраняются поверх прежних', () => {
    saveSettings(db, { ...getSettings(db), taxNumber: '123456789012' });
    saveSettings(db, { ...getSettings(db), taxNumber: '210987654321' });

    expect(getSettings(db).taxNumber).toBe('210987654321');
    expect(db.all('SELECT * FROM app_state WHERE key = ?', ['company_settings'])).toHaveLength(1);
  });
});

describe('лояльность и реквизиты', () => {
  it('сохраняются и переживают перезагрузку', () => {
    saveSettings(db, {
      ...getSettings(db),
      requisites: [
        { key: 'ИНН', value: '5702001741' },
        { key: 'ОГРН', value: '1025700000000' },
      ],
      taxes: [{ name: 'НДС 20 %', code: '1', rate_bp: 2000 }],
      vatPayer: true,
      bonusOn: true,
      bonusPerRubles: 100,
      bonusEarned: 1,
      bonusLimitBp: 3000,
      presetDiscounts: [500, 1000],
      discountRules: [{ from: 1000000, discount_bp: 500 }],
    });

    const back = getSettings(db);
    expect(back.requisites).toHaveLength(2);
    expect(back.requisites[0]).toEqual({ key: 'ИНН', value: '5702001741' });
    expect(back.taxes[0].rate_bp).toBe(2000);
    expect(back.vatPayer).toBe(true);
    expect(back.bonusOn).toBe(true);
    expect(back.bonusLimitBp).toBe(3000);
    expect(back.presetDiscounts).toEqual([500, 1000]);
    expect(back.discountRules[0]).toEqual({ from: 1000000, discount_bp: 500 });
  });

  it('старые настройки без новых полей не ломаются', () => {
    // Настройки лежат одним JSON: у того, кто обновился, новых ключей в нём
    // нет, и они должны прийти из умолчаний, а не оказаться undefined.
    db.run(
      `INSERT INTO app_state (key, value) VALUES ('company_settings', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [JSON.stringify({ name: 'Старая чайная', phone: '+7 999' })],
    );

    const back = getSettings(db);
    expect(back.name).toBe('Старая чайная');
    expect(back.requisites).toEqual([]);
    expect(back.taxes).toEqual([]);
    expect(back.bonusPerRubles).toBe(100);
  });
});
