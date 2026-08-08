import { formatMoneyWeb } from '../../domain/money';
import { visiblePages } from '../pagination';
import { titleFor } from '../menu';

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
});
