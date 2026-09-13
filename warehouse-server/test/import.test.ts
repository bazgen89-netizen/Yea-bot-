import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';

import type { SqlDb } from '../src/db/driver.ts';
import { importCounterparties, importProducts, phoneDigits } from '../src/core/import.ts';
import { listCounterparties } from '../src/core/counterparties.ts';
import { listLocations, listProducts } from '../src/core/catalog.ts';
import { getStock } from '../src/core/stock.ts';
import { createTestDb } from './helpers.ts';

let db: SqlDb;
let orgId: string;

beforeEach(async () => {
  db = await createTestDb();
  orgId = randomUUID();
  await db.query('INSERT INTO orgs (id, name) VALUES ($1, $2)', [orgId, 'Waystea']);
});

const row = (over: Record<string, unknown> = {}) => ({
  name: 'Дун Фан Мэй Жэнь',
  code: '01444',
  unit: 'шт',
  sale_price: 75_000,
  ...over,
});

describe('загрузка каталога', () => {
  it('заводит товары и магазины из файла', async () => {
    const result = await importProducts(db, orgId, null, [
      row({ stocks: { 'Чайный бар': 5_000, 'Черёмушки': 2_000 } }),
    ]);

    assert.equal(result.created, 1);
    assert.equal(result.locationsCreated, 2);

    const locations = await listLocations(db, orgId);
    assert.deepEqual(locations.map((l) => l.name).sort(), ['Чайный бар', 'Черёмушки']);
  });

  it('проставляет остатки по каждому магазину', async () => {
    await importProducts(db, orgId, null, [
      row({ stocks: { 'Чайный бар': 5_000, 'Черёмушки': 2_000 } }),
    ]);

    const [product] = await listProducts(db, orgId);
    const locations = await listLocations(db, orgId);
    const bar = locations.find((l) => l.name === 'Чайный бар')!;

    assert.equal(await getStock(db, orgId, product.id, bar.id), 5_000);
    assert.equal(await getStock(db, orgId, product.id), 7_000);
  });

  it('принимает отрицательные остатки из выгрузки', async () => {
    await importProducts(db, orgId, null, [row({ stocks: { 'Рынок': -945_382 } })]);

    const [product] = await listProducts(db, orgId);
    assert.equal(await getStock(db, orgId, product.id), -945_382);
  });

  it('повторная загрузка обновляет, а не задваивает', async () => {
    await importProducts(db, orgId, null, [row({ stocks: { 'Рынок': 5_000 } })]);

    const second = await importProducts(db, orgId, null, [
      row({ sale_price: 99_000, stocks: { 'Рынок': 3_000 } }),
    ]);

    assert.equal(second.created, 0);
    assert.equal(second.updated, 1);
    assert.equal(second.locationsCreated, 0);

    const products = await listProducts(db, orgId);
    assert.equal(products.length, 1);
    assert.equal(Number(products[0].sale_price), 99_000);
    // Остаток выставляется как факт, а не прибавляется к прошлому.
    assert.equal(await getStock(db, orgId, products[0].id), 3_000);
  });

  it('узнаёт товар по артикулу, когда кода нет', async () => {
    await importProducts(db, orgId, null, [
      { name: 'Улун', sku: 'UL-01', unit: 'гр', sale_price: 3_000 },
    ]);
    const again = await importProducts(db, orgId, null, [
      { name: 'Улун другой', sku: 'UL-01', unit: 'гр', sale_price: 4_000 },
    ]);

    assert.equal(again.updated, 1);
    assert.equal((await listProducts(db, orgId)).length, 1);
  });

  it('название магазина с лишними пробелами не плодит дубли', async () => {
    await importProducts(db, orgId, null, [row({ stocks: { 'Чайный  бар': 1_000 } })]);
    await importProducts(db, orgId, null, [
      row({ code: '01445', name: 'Другой', stocks: { 'Чайный бар': 1_000 } }),
    ]);

    assert.equal((await listLocations(db, orgId)).length, 1);
  });

  it('пустая единица измерения превращается в штуки', async () => {
    await importProducts(db, orgId, null, [row({ unit: '' })]);
    assert.equal((await listProducts(db, orgId))[0].unit, 'шт');
  });

  it('строка без названия пропускается с указанием номера', async () => {
    const result = await importProducts(db, orgId, null, [
      row(),
      { name: '  ', code: '01500' },
    ]);

    assert.equal(result.created, 1);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].row, 3);
  });

  it('пустой файл не принимается', async () => {
    await assert.rejects(() => importProducts(db, orgId, null, []), /нет строк/);
  });
});

describe('опознание строк', () => {
  it('не склеивает разные товары с одинаковым артикулом', async () => {
    // Так выглядит настоящая выгрузка: чай в зале и он же на развес имеют
    // общий артикул, но разные коды и разные цены.
    const result = await importProducts(db, orgId, null, [
      { name: 'В Зале Шоу Мэй', code: '01200', sku: '8884039', sale_price: 30_000 },
      { name: 'Шоу Мэй', code: '01201', sku: '8884039', sale_price: 4_400 },
    ]);

    assert.equal(result.created, 2);
    assert.equal(result.updated, 0);
    assert.equal((await listProducts(db, orgId)).length, 2);
  });

  it('код важнее артикула при повторной загрузке', async () => {
    await importProducts(db, orgId, null, [
      { name: 'Шоу Мэй', code: '01201', sku: '8884039', sale_price: 4_400 },
    ]);
    const again = await importProducts(db, orgId, null, [
      { name: 'Шоу Мэй новое имя', code: '01201', sku: '8884039', sale_price: 5_000 },
    ]);

    assert.equal(again.updated, 1);
    const products = await listProducts(db, orgId);
    assert.equal(products.length, 1);
    assert.equal(products[0].name, 'Шоу Мэй новое имя');
  });
});

describe('загрузка клиентской базы', () => {
  it('заводит карточки и не плодит дубли при повторной загрузке', async () => {
    const rows = [
      { name: 'Иван Петров', phone: '+7 (999) 123-45-67' },
      { name: 'Ольга Смирнова', phone: '8 (901) 000-11-22' },
    ];

    const first = await importCounterparties(db, orgId, rows);
    assert.equal(first.created, 2);
    assert.equal(first.updated, 0);

    const second = await importCounterparties(db, orgId, rows);
    assert.equal(second.created, 0);
    assert.equal(second.updated, 2);

    assert.equal((await listCounterparties(db, orgId)).length, 2);
  });

  it('узнаёт человека по телефону, записанному иначе', async () => {
    await importCounterparties(db, orgId, [
      { name: 'Иван Петров', phone: '+7 (999) 123-45-67' },
    ]);
    await importCounterparties(db, orgId, [{ name: 'Петров И.', phone: '89991234567' }]);

    const parties = await listCounterparties(db, orgId);
    assert.equal(parties.length, 1);
    assert.equal(parties[0].name, 'Петров И.');
  });

  it('не склеивает тёзок с разными телефонами', async () => {
    await importCounterparties(db, orgId, [
      { name: 'Иван Петров', phone: '+79991234567' },
      { name: 'Иван Петров', phone: '+79997654321' },
    ]);

    assert.equal((await listCounterparties(db, orgId)).length, 2);
  });

  it('без телефона опознаёт по имени', async () => {
    await importCounterparties(db, orgId, [{ name: 'Чайная лавка' }]);
    const again = await importCounterparties(db, orgId, [{ name: 'чайная  лавка' }]);

    assert.equal(again.updated, 1);
    assert.equal((await listCounterparties(db, orgId)).length, 1);
  });

  it('пустое поле в выгрузке не затирает заполненное в базе', async () => {
    await importCounterparties(db, orgId, [
      { name: 'Иван', phone: '+79991234567', email: 'ivan@mail.ru' },
    ]);
    await importCounterparties(db, orgId, [{ name: 'Иван', phone: '+79991234567' }]);

    const [party] = await listCounterparties(db, orgId);
    assert.equal(party.email, 'ivan@mail.ru');
  });

  it('поставщики попадают в свой список', async () => {
    await importCounterparties(db, orgId, [
      { name: 'Чайный склад', kind: 'supplier', phone: '+79990001111' },
      { name: 'Покупатель', phone: '+79990002222' },
    ]);

    assert.equal((await listCounterparties(db, orgId, { kind: 'supplier' })).length, 1);
    assert.equal((await listCounterparties(db, orgId, { kind: 'customer' })).length, 1);
  });

  it('строка без имени пропускается с указанием номера', async () => {
    const result = await importCounterparties(db, orgId, [
      { name: 'Нормальный' },
      { name: '   ', phone: '+79991234567' },
    ]);

    assert.equal(result.created, 1);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].row, 3);
  });

  it('пустой файл не принимается', async () => {
    await assert.rejects(() => importCounterparties(db, orgId, []), /нет строк/);
  });

  it('сводит разные написания телефона к десяти цифрам', () => {
    assert.equal(phoneDigits('+7 (999) 123-45-67'), '9991234567');
    assert.equal(phoneDigits('89991234567'), '9991234567');
    assert.equal(phoneDigits('123'), null);
    assert.equal(phoneDigits(null), null);
  });
});
