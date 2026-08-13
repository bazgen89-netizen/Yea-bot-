import type { SqlDriver } from '../driver';
import { createTestDriver } from '../testDriver';
import {
  archiveAccount,
  blankAccount,
  createAccount,
  getAccount,
  listAccounts,
  totalBalance,
} from '../accounts';
import {
  archiveLocation,
  blankLocation,
  createLocation,
  getLocation,
  listLocationsWithTotals,
  renameLocation,
  saveLocation,
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
      cashbackRateBp: 500,
      redemptionRateBp: 10000,
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
    expect(back.cashbackRateBp).toBe(500);
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
    expect(back.cashbackRateBp).toBe(0);
  });
});

describe('счета отдельными записями', () => {
  it('заводятся тремя знакомыми и считают остаток с начального', () => {
    const names = listAccounts(db).map((account) => account.name);
    expect(names).toContain('Касса магазина');
    expect(names).toContain('Терминал / Счет в банке');
    expect(names).toContain('Счет в банке');

    const wallet = createAccount(db, {
      ...blankAccount(),
      name: 'Кошелёк',
      opening_balance: 100000,
    });

    createMoneyDoc(db, { type: 'income', amount: 50000, account: 'Кошелёк' });

    // 1000,00 было + 500,00 пришло.
    expect(getAccount(db, wallet)!.balance).toBe(150000);
  });

  it('счёт без движений удаляется, счёт с движениями прячется', () => {
    const unused = createAccount(db, { ...blankAccount(), name: 'Пустой' });
    archiveAccount(db, unused);
    expect(listAccounts(db, true).find((a) => a.name === 'Пустой')).toBeUndefined();

    const used = createAccount(db, { ...blankAccount(), name: 'Рабочий' });
    createMoneyDoc(db, { type: 'expense', amount: 10000, account: 'Рабочий' });
    archiveAccount(db, used);

    expect(listAccounts(db).find((a) => a.name === 'Рабочий')).toBeUndefined();
    expect(listAccounts(db, true).find((a) => a.name === 'Рабочий')?.archived).toBe(1);
  });

  it('в общий баланс попадают только отмеченные', () => {
    createAccount(db, {
      ...blankAccount(),
      name: 'Личный',
      opening_balance: 700000,
      include: false,
    });
    createAccount(db, { ...blankAccount(), name: 'Рабочий', opening_balance: 300000 });

    expect(totalBalance(db)).toBe(300000);
  });

  it('счёт по умолчанию только один', () => {
    const first = createAccount(db, { ...blankAccount(), name: 'Первый', is_default: true });
    const second = createAccount(db, { ...blankAccount(), name: 'Второй', is_default: true });

    expect(getAccount(db, first)!.is_default).toBe(0);
    expect(getAccount(db, second)!.is_default).toBe(1);
  });

  it('эквайринг остаётся только у расчётного счёта', () => {
    const wallet = createAccount(db, {
      ...blankAccount(),
      name: 'Кошелёк',
      type: 'wallet',
      use_terminal: true,
    });
    expect(getAccount(db, wallet)!.use_terminal).toBe(0);

    const bank = createAccount(db, {
      ...blankAccount(),
      name: 'Расчётный',
      type: 'bank_account',
      use_terminal: true,
    });
    expect(getAccount(db, bank)!.use_terminal).toBe(1);
  });
});

describe('карточка магазина', () => {
  it('хранит адрес, описание и налоги точки', () => {
    const id = saveLocation(db, null, {
      name: 'Ереван',
      address: 'Северный проспект, 1',
      description: 'Первый этаж',
      is_default: true,
      taxes: ['1', '2'],
    });

    const back = getLocation(db, id)!;
    expect(back.address).toBe('Северный проспект, 1');
    expect(back.description).toBe('Первый этаж');
    expect(back.taxes).toBe('1,2');
    expect(back.is_default).toBe(1);
  });

  it('магазин по умолчанию только один', () => {
    const first = saveLocation(db, null, { ...blankLocation(), name: 'Ереван', is_default: true });
    const second = saveLocation(db, null, { ...blankLocation(), name: 'Гюмри', is_default: true });

    expect(getLocation(db, first)!.is_default).toBe(0);
    expect(getLocation(db, second)!.is_default).toBe(1);
  });

  it('не заводит два магазина с одним названием', () => {
    saveLocation(db, null, { ...blankLocation(), name: 'Ереван' });
    expect(() => saveLocation(db, null, { ...blankLocation(), name: 'Ереван' })).toThrow();
  });
});
