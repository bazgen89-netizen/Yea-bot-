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
  parseList,
  parsePairs,
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

describe('карточка контрагента целиком', () => {
  it('хранит организацию с реквизитами и адресами', () => {
    const id = createCounterparty(db, {
      kind: 'supplier',
      name: 'ООО «Чайный путь»',
      party_type: 'company',
      is_default: true,
      phones: ['+7 999 111-22-33', '+7 999 444-55-66'],
      email: 'sales@tea.example',
      details: [
        { key: 'ИНН', value: '5702001741' },
        { key: '', value: '' },
      ],
      bank_details: [{ key: 'БИК', value: '044525225' }],
      account_number: '40702810000000000001',
      legal_address: 'Москва, ул. Чайная, 1',
      address: 'Склад на Студёной',
    });

    const back = getCounterparty(db, id)!;
    expect(back.party_type).toBe('company');
    expect(back.is_default).toBe(1);
    expect(back.account_number).toBe('40702810000000000001');
    expect(back.legal_address).toBe('Москва, ул. Чайная, 1');

    // Первый телефон списка попадает и в старую колонку — по ней ищут.
    expect(back.phone).toBe('+7 999 111-22-33');
    expect(parseList(back.phones)).toHaveLength(2);

    // Пустая пара реквизитов не сохраняется.
    expect(parsePairs(back.details)).toEqual([{ key: 'ИНН', value: '5702001741' }]);
    expect(parsePairs(back.bank_details)).toHaveLength(1);
  });

  it('ищется по второму телефону, почте и дисконтной карте', () => {
    createCounterparty(db, {
      kind: 'customer',
      name: 'Анна',
      phones: ['+7 900 000-00-01', '+7 911 222-33-44'],
      email: 'anna@example.com',
      discount_card: 'K-2048',
    });

    const found = (search: string) =>
      listCounterparties(db, { kind: 'customer', search }).map((party) => party.name);

    expect(found('9112223344')).toEqual(['Анна']);
    expect(found('anna@')).toEqual(['Анна']);
    expect(found('K-2048')).toEqual(['Анна']);
    expect(found('нетакого')).toEqual([]);
  });

  it('ищется по ФИО в любом порядке и по телефону как его набрали', () => {
    createCounterparty(db, {
      kind: 'customer',
      name: 'Рудник Михаил Петрович',
      phone: '+7 (961) 253-27-57',
    });
    createCounterparty(db, { kind: 'customer', name: 'Михаил Соколов', phone: '89990001122' });

    const found = (search: string) =>
      listCounterparties(db, { kind: 'customer', search }).map((party) => party.name);

    // Фамилию с именем вспоминают в том порядке, в каком придётся.
    expect(found('Рудник Михаил')).toEqual(['Рудник Михаил Петрович']);
    expect(found('Михаил Рудник')).toEqual(['Рудник Михаил Петрович']);
    expect(found('петрович рудник')).toEqual(['Рудник Михаил Петрович']);

    // Одно имя — оба однофамильца.
    expect(found('михаил').sort()).toEqual(['Михаил Соколов', 'Рудник Михаил Петрович']);

    // Телефон: как записан, как набирают и кусками.
    expect(found('+7 (961) 253-27-57')).toEqual(['Рудник Михаил Петрович']);
    expect(found('89612532757')).toEqual(['Рудник Михаил Петрович']);
    expect(found('9612532757')).toEqual(['Рудник Михаил Петрович']);
    expect(found('2532757')).toEqual(['Рудник Михаил Петрович']);
    // Номер, набранный через пробелы, не должен рассыпаться на «8», «961»…
    expect(found('8 961 253 27 57')).toEqual(['Рудник Михаил Петрович']);

    // Имя и телефон вместе — так отсеивают однофамильцев.
    expect(found('михаил 9990001122')).toEqual(['Михаил Соколов']);
  });

  it('контрагент по умолчанию только один в своём виде', () => {
    const first = createCounterparty(db, { kind: 'customer', name: 'Первый', is_default: true });
    const second = createCounterparty(db, { kind: 'customer', name: 'Второй', is_default: true });

    expect(getCounterparty(db, first)!.is_default).toBe(0);
    expect(getCounterparty(db, second)!.is_default).toBe(1);

    // У поставщиков свой «по умолчанию» — клиента он не трогает.
    const supplier = createCounterparty(db, {
      kind: 'supplier',
      name: 'Поставщик',
      is_default: true,
    });
    expect(getCounterparty(db, second)!.is_default).toBe(1);
    expect(getCounterparty(db, supplier)!.is_default).toBe(1);
  });

  it('правка не теряет тип и реквизиты', () => {
    const id = createCounterparty(db, {
      kind: 'customer',
      name: 'Борис',
      party_type: 'company',
      details: [{ key: 'ОГРН', value: '1025700000000' }],
    });

    updateCounterparty(db, id, {
      kind: 'customer',
      name: 'Борис Петрович',
      party_type: 'company',
      details: [{ key: 'ОГРН', value: '1025700000000' }],
      loyalty_type: 'bonus',
      cashback_bp: 500,
    });

    const back = getCounterparty(db, id)!;
    expect(back.name).toBe('Борис Петрович');
    expect(back.party_type).toBe('company');
    expect(back.loyalty_type).toBe('bonus');
    expect(back.cashback_bp).toBe(500);
    expect(parsePairs(back.details)).toHaveLength(1);
  });
});
