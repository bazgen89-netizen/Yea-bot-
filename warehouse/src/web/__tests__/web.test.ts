import { formatMoneyWeb } from '../../domain/money';
import { visiblePages } from '../pagination';
import { titleFor } from '../menu';
import { entryTitle, formatDay, groupByDay } from '../../db/journal';

describe('суммы в кабинете', () => {
  it('пишет разряды запятой, а копейки точкой', () => {
    // На экранах кабинета суммы записаны по-английски: 1,183.62.
    expect(formatMoneyWeb(118362)).toBe('1,183.62');
    expect(formatMoneyWeb(10487884)).toBe('104,878.84');
    expect(formatMoneyWeb(1500)).toBe('15.00');
  });

  it('не теряет ноль в копейках и разделяет каждые три разряда', () => {
    expect(formatMoneyWeb(0)).toBe('0.00');
    expect(formatMoneyWeb(5)).toBe('0.05');
    expect(formatMoneyWeb(100000000)).toBe('1,000,000.00');
  });

  it('минус остаётся перед числом, а не перед разрядом', () => {
    expect(formatMoneyWeb(-64763812)).toBe('-647,638.12');
  });
});

describe('постраничная навигация', () => {
  it('короткий список показывает все страницы', () => {
    expect(visiblePages(1, 1)).toEqual([1]);
    expect(visiblePages(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('длинный список сворачивает середину', () => {
    // 3184 клиента дают 64 страницы — в строку они не помещаются.
    expect(visiblePages(1, 64)).toEqual([1, 2, 3, 4, 5, 6, 7, null, 64]);
  });

  it('показывает текущую страницу, даже когда она в свёрнутой середине', () => {
    expect(visiblePages(30, 64)).toEqual([1, 2, 3, 4, 5, 6, 7, null, 30, null, 64]);
  });

  it('на последней странице середину не разворачивает', () => {
    expect(visiblePages(64, 64)).toEqual([1, 2, 3, 4, 5, 6, 7, null, 64]);
  });
});

describe('заголовок раздела', () => {
  it('берётся по адресу', () => {
    expect(titleFor('/')).toBe('Главная');
    expect(titleFor('/catalog')).toBe('Товары и услуги / справочник');
    expect(titleFor('/journal')).toBe('Движение товара');
    expect(titleFor('/money')).toBe('Движение денег');
  });

  it('различает клиентов и поставщиков по параметру', () => {
    expect(titleFor('/counterparties', 'customer')).toBe('Клиенты');
    expect(titleFor('/counterparties', 'supplier')).toBe('Поставщики');
  });

  it('называет создаваемый документ', () => {
    expect(titleFor('/doc/new', 'transfer')).toBe('Движение товара / Перемещение');
    expect(titleFor('/doc/new', 'stock_in')).toBe('Движение товара / Оприходование');
  });

  it('не путает создание денежного документа с журналом денег', () => {
    expect(titleFor('/money/new', undefined, 'expense')).toBe('Движение денег / Расход');
    expect(titleFor('/money/new', undefined, 'transfer')).toBe('Движение денег / Перевод');
    expect(titleFor('/money')).toBe('Движение денег');
  });
});

describe('журнал движения товара', () => {
  it('складывает строки в группы по дням, сохраняя порядок', () => {
    const entry = (id: number, created_at: string) =>
      ({ id, number: null, kind: 'sale', created_at, positions: 1, amount: 0, paid: 0,
         sender: null, receiver: null, author: null, note: null, discount: 0, posted: 1 }) as const;

    const groups = groupByDay([
      entry(3, '2026-08-08T11:27:00.000Z'),
      entry(2, '2026-08-08T10:43:00.000Z'),
      entry(1, '2026-08-07T20:59:00.000Z'),
    ]);

    expect(groups.map((g) => g.day)).toEqual(['2026-08-08', '2026-08-07']);
    expect(groups[0].entries.map((e) => e.id)).toEqual([3, 2]);
  });

  it('пишет заголовок дня по-русски', () => {
    expect(formatDay('2026-08-08')).toBe('8 августа');
    expect(formatDay('2026-01-01')).toBe('1 января');
  });

  it('называет документ так же, как в исходном приложении', () => {
    const base = {
      number: null, created_at: '', positions: 0, amount: 0, paid: null,
      sender: null, receiver: null, author: null, note: null, discount: 0, posted: 1,
    };
    expect(entryTitle({ ...base, id: 4784, kind: 'sale' })).toBe('Продажа #4784');
    expect(entryTitle({ ...base, id: 3303, kind: 'adjustment' })).toBe('Корректировка #3303');
    expect(entryTitle({ ...base, id: 12, kind: 'purchase' })).toBe('Закупка #12');
    expect(entryTitle({ ...base, id: 13, kind: 'purchase_return' })).toBe('Возврат закупки #13');
    expect(entryTitle({ ...base, id: 14, kind: 'stock_in' })).toBe('Оприходование #14');
    expect(entryTitle({ ...base, id: 15, kind: 'transfer' })).toBe('Перемещение #15');

    // У перенесённого чека номер свой — тот, что был в CloudShop. Внутренний
    // номер рядом с ним чужой: свой чек хозяин ищет по «#45658».
    expect(entryTitle({ ...base, id: 7, number: 45658, kind: 'sale' })).toBe('Продажа #45658');
  });
});
