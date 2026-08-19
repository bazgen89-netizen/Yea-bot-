import { partySets, usefulColumns } from '../partyColumns';
import type { CounterpartyWithTotals } from '../../domain/types';

/**
 * Пустая колонка не показывается.
 *
 * Он открыл клиентов и сказал: «всё криво, нет всех клиентов с их
 * информацией». Half экрана занимали «Описание» и «Адрес» — CloudShop этих
 * полей по ключу не отдаёт, и во всех 3206 строках стояли прочерки. А
 * скидка с бонусами из-за этого уезжали за правый край, и выглядело так,
 * будто они не перенеслись.
 */
const party = (extra: Partial<CounterpartyWithTotals> = {}): CounterpartyWithTotals =>
  ({
    id: 1,
    kind: 'customer',
    name: 'Рудник Михаил',
    phone: '89612532757',
    email: null,
    note: null,
    address: null,
    birthday: null,
    gender: null,
    created_by: null,
    created_at: '2022-02-09T10:00:00.000Z',
    archived: 0,
    discount_bp: 0,
    discount_card: null,
    loyalty_type: null,
    bonus_balance: 0,
    bonus_spent: 0,
    cashback_bp: 0,
    phones: '[]',
    party_type: 'person',
    is_default: 0,
    enable_savings: 0,
    details: '[]',
    bank_details: '[]',
    account_number: null,
    legal_address: null,
    search_text: '',
    purchases: 0,
    receipts: 0,
    last_sale_at: null,
    returns: 0,
    returns_sum: 0,
    debit_sum: 0,
    credit_sum: 0,
    purchases_count: 0,
    purchases_sum: 0,
    purchase_returns: 0,
    purchase_returns_sum: 0,
    ...extra,
  }) as CounterpartyWithTotals;

const basic = () => partySets('customer')[0].columns;
const titles = (parties: CounterpartyWithTotals[]) =>
  usefulColumns(basic(), parties).map((column) => column.title);

describe('колонки справочника клиентов', () => {
  it('колонки без единого значения прячутся', () => {
    const shown = titles([party(), party({ id: 2, name: 'Анна' })]);

    expect(shown).not.toContain('Адрес');
    expect(shown).not.toContain('Описание');
    expect(shown).not.toContain('Email');
  });

  it('имя и телефон остаются всегда', () => {
    // Даже если телефона нет ни у кого: таблица клиентов без телефона —
    // уже не таблица клиентов, и колонка должна ждать, когда его впишут.
    const shown = titles([party({ phone: null })]);

    expect(shown).toContain('Наименование');
    expect(shown).toContain('Телефон');
  });

  it('колонка возвращается, как только значение появилось хоть у одного', () => {
    const shown = titles([
      party(),
      party({ id: 2, name: 'Анна', address: 'Нижний Новгород, Студёная 5' }),
    ]);

    expect(shown).toContain('Адрес');
  });

  it('скидка и бонусы стоят в основном наборе, а не только в «Лояльности»', () => {
    const shown = titles([party({ discount_bp: 1000, bonus_balance: 22950 })]);

    expect(shown).toContain('Скидка');
    expect(shown).toContain('Бонусов');
  });

  it('на пустом справочнике колонки не схлопываются', () => {
    // Иначе новая база встречала бы таблицей из двух колонок, и куда
    // вписывать день рождения, было бы непонятно.
    expect(titles([]).length).toBe(basic().length);
  });
});
