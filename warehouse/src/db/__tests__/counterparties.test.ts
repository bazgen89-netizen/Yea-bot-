import type { SqlDriver } from '../driver';
import { createTestDriver } from '../testDriver';
import {
  archiveCounterparty,
  countCounterparties,
  createCounterparty,
  formatPhone,
  getCounterparty,
  importCounterparties,
  listCounterparties,
  phoneDigits,
  updateCounterparty,
} from '../counterparties';
import { createProduct } from '../products';
import { postDoc } from '../stock';
import { createSale } from '../sales';
import type { CartLine, DocLine } from '../../domain/types';

let db: SqlDriver;

beforeEach(() => {
  db = createTestDriver();
});

describe('справочник контрагентов', () => {
  it('заводит клиента и находит его в списке', () => {
    const id = createCounterparty(db, {
      kind: 'customer',
      name: 'Иван Петров',
      phone: '+7 (999) 123-45-67',
    });

    const list = listCounterparties(db, { kind: 'customer' });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].purchases).toBe(0);
    expect(list[0].receipts).toBe(0);
    expect(list[0].last_sale_at).toBeNull();
  });

  it('разделяет клиентов и поставщиков, а «оба» показывает в двух списках', () => {
    createCounterparty(db, { kind: 'customer', name: 'Клиент' });
    createCounterparty(db, { kind: 'supplier', name: 'Поставщик' });
    createCounterparty(db, { kind: 'both', name: 'И то и то' });

    expect(listCounterparties(db, { kind: 'customer' }).map((p) => p.name)).toEqual([
      'И то и то',
      'Клиент',
    ]);
    expect(listCounterparties(db, { kind: 'supplier' }).map((p) => p.name)).toEqual([
      'И то и то',
      'Поставщик',
    ]);

    expect(countCounterparties(db, 'customer')).toBe(2);
    expect(countCounterparties(db, 'supplier')).toBe(2);
  });

  it('ищет по имени в любом регистре и по телефону в любом написании', () => {
    createCounterparty(db, {
      kind: 'customer',
      name: 'Ольга Смирнова',
      phone: '+7 (999) 123-45-67',
    });

    // LIKE в SQLite не знает регистра кириллицы — поиск идёт по search_text.
    expect(listCounterparties(db, { search: 'ольга' })).toHaveLength(1);
    expect(listCounterparties(db, { search: 'СМИРНОВА' })).toHaveLength(1);
    expect(listCounterparties(db, { search: '9991234567' })).toHaveLength(1);
    expect(listCounterparties(db, { search: 'Иванов' })).toHaveLength(0);
  });

  it('обновляет строку поиска вместе с карточкой', () => {
    const id = createCounterparty(db, { kind: 'customer', name: 'Старое имя' });
    updateCounterparty(db, id, { kind: 'customer', name: 'Новое имя', phone: '89990001122' });

    expect(listCounterparties(db, { search: 'старое' })).toHaveLength(0);
    expect(listCounterparties(db, { search: 'новое' })).toHaveLength(1);
    expect(listCounterparties(db, { search: '9990001122' })).toHaveLength(1);
  });

  it('убирает карточку из списка, не удаляя её', () => {
    const id = createCounterparty(db, { kind: 'customer', name: 'Ушедший' });
    archiveCounterparty(db, id);

    expect(listCounterparties(db, { kind: 'customer' })).toHaveLength(0);
    expect(listCounterparties(db, { kind: 'customer', includeArchived: true })).toHaveLength(1);
    expect(getCounterparty(db, id)?.name).toBe('Ушедший');
  });

  it('считает покупки клиента по чекам', () => {
    const customer = createCounterparty(db, { kind: 'customer', name: 'Постоянный' });
    const product = createProduct(db, {
      name: 'Шу пуэр',
      sku: null,
      barcode: null,
      category_id: null,
      unit: 'кг',
      cost_price: 200000,
      sale_price: 500000,
      min_qty: 0,
      photo_uri: null,
    });

    const line: DocLine = {
      product_id: product,
      name: 'Шу пуэр',
      unit: 'кг',
      qty: 10000,
      price: 200000,
    };
    postDoc(db, { type: 'receipt', counterparty: null, note: null, lines: [line] });

    const cart: CartLine[] = [
      {
        product_id: product,
        name: 'Шу пуэр',
        unit: 'кг',
        qty: 2000,
        price: 500000,
        cost_price: 200000,
        stock: 10000,
      },
    ];
    const sale = createSale(db, { discount: 0, payment: 'cash', lines: cart });
    db.run('UPDATE sales SET customer_id = ? WHERE id = ?', [customer, sale]);

    const found = getCounterparty(db, customer);
    expect(found?.purchases).toBe(1000000); // 2 кг × 5000,00 ₽
    expect(found?.receipts).toBe(1);
    expect(found?.last_sale_at).not.toBeNull();
  });
});

describe('загрузка клиентской базы', () => {
  it('заводит новых и не плодит дубли при повторной загрузке', () => {
    const rows = [
      { kind: 'customer' as const, name: 'Иван Петров', phone: '+7 (999) 123-45-67' },
      { kind: 'customer' as const, name: 'Ольга Смирнова', phone: '8 (901) 000-11-22' },
    ];

    expect(importCounterparties(db, rows)).toEqual({ created: 2, updated: 0, skipped: 0 });
    expect(importCounterparties(db, rows)).toEqual({ created: 0, updated: 2, skipped: 0 });
    expect(countCounterparties(db, 'customer')).toBe(2);
  });

  it('узнаёт человека по телефону, записанному иначе', () => {
    importCounterparties(db, [
      { kind: 'customer', name: 'Иван Петров', phone: '+7 (999) 123-45-67' },
    ]);
    // Тот же номер через восьмёрку и без разделителей.
    importCounterparties(db, [{ kind: 'customer', name: 'Петров И.', phone: '89991234567' }]);

    const list = listCounterparties(db, { kind: 'customer' });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Петров И.');
  });

  it('не склеивает тёзок с разными телефонами', () => {
    importCounterparties(db, [
      { kind: 'customer', name: 'Иван Петров', phone: '+79991234567' },
      { kind: 'customer', name: 'Иван Петров', phone: '+79997654321' },
    ]);

    expect(countCounterparties(db, 'customer')).toBe(2);
  });

  it('без телефона опознаёт по имени', () => {
    importCounterparties(db, [{ kind: 'customer', name: 'Чайная лавка' }]);
    const result = importCounterparties(db, [{ kind: 'customer', name: 'чайная лавка' }]);

    expect(result).toEqual({ created: 0, updated: 1, skipped: 0 });
    expect(countCounterparties(db, 'customer')).toBe(1);
  });

  it('не затирает заполненное поле пустым значением из выгрузки', () => {
    importCounterparties(db, [
      { kind: 'customer', name: 'Иван', phone: '+79991234567', email: 'ivan@mail.ru' },
    ]);
    importCounterparties(db, [{ kind: 'customer', name: 'Иван', phone: '+79991234567' }]);

    expect(listCounterparties(db, { kind: 'customer' })[0].email).toBe('ivan@mail.ru');
  });

  it('пропускает строки без имени', () => {
    const result = importCounterparties(db, [
      { kind: 'customer', name: '   ', phone: '+79991234567' },
      { kind: 'customer', name: 'Нормальный' },
    ]);

    expect(result).toEqual({ created: 1, updated: 0, skipped: 1 });
  });
});

describe('телефоны', () => {
  it('сводит разные написания к десяти цифрам', () => {
    expect(phoneDigits('+7 (999) 123-45-67')).toBe('9991234567');
    expect(phoneDigits('89991234567')).toBe('9991234567');
    expect(phoneDigits('9991234567')).toBe('9991234567');
  });

  it('короткий или пустой номер номером не считает', () => {
    expect(phoneDigits('123')).toBeNull();
    expect(phoneDigits('')).toBeNull();
    expect(phoneDigits(null)).toBeNull();
  });

  it('показывает номер в привычном виде, а непонятный отдаёт как есть', () => {
    expect(formatPhone('89991234567')).toBe('+7 (999) 123-45-67');
    expect(formatPhone('доб. 12')).toBe('доб. 12');
    expect(formatPhone(null)).toBe('');
  });
});
