import {
  dayShift,
  formatDate,
  formatPercent,
  marginBp,
  markupBp,
  parseDate,
  parsePercent,
  priceFromMarkup,
  priceWithDiscount,
  vatInPrice,
} from '../pricing';

describe('проценты', () => {
  it('печатает целые и дробные', () => {
    expect(formatPercent(0)).toBe('0 %');
    expect(formatPercent(2000)).toBe('20 %');
    expect(formatPercent(550)).toBe('5,5 %');
    expect(formatPercent(525)).toBe('5,25 %');
  });

  it('разбирает то, что печатает', () => {
    expect(parsePercent('20')).toBe(2000);
    expect(parsePercent('5,5')).toBe(550);
    expect(parsePercent('20 %')).toBe(2000);
    expect(parsePercent('')).toBeNull();
    expect(parsePercent('много')).toBeNull();
  });
});

describe('скидка', () => {
  it('снимает свой процент с цены', () => {
    // 5000,00 минус 10 % = 4500,00
    expect(priceWithDiscount(500000, 1000)).toBe(450000);
  });

  it('нулевую скидку не считает', () => {
    expect(priceWithDiscount(500000, 0)).toBe(500000);
  });

  it('не уводит цену в минус даже при скидке больше ста процентов', () => {
    expect(priceWithDiscount(500000, 15000)).toBe(0);
  });
});

describe('наценка и маржа', () => {
  it('наценка считается от цены закупки, маржа — от цены продажи', () => {
    // Купили за 2000,00, продаём за 5000,00: накинули 150 %, оставляем себе 60 %.
    expect(markupBp(200000, 500000)).toBe(15000);
    expect(marginBp(200000, 500000)).toBe(6000);
  });

  it('повторяет пример из исходного приложения', () => {
    // Цена закупки 17,00 и цена продажи 59,90 дают у него наценку 252,35 %.
    expect(markupBp(1700, 5990)).toBe(25235);
  });

  it('без цены закупки наценка не определена, без цены продажи — маржа', () => {
    expect(markupBp(0, 500000)).toBeNull();
    expect(marginBp(200000, 0)).toBeNull();
  });

  it('цена по наценке возвращается обратно в ту же наценку', () => {
    const price = priceFromMarkup(200000, 15000);
    expect(price).toBe(500000);
    expect(markupBp(200000, price)).toBe(15000);
  });
});

describe('НДС', () => {
  it('выделяется из цены, а не начисляется сверху', () => {
    // 120,00 с НДС 20 % содержат 20,00 налога.
    expect(vatInPrice(12000, 2000)).toBe(2000);
  });

  it('без ставки равен нулю', () => {
    expect(vatInPrice(12000, null)).toBe(0);
  });
});

describe('даты', () => {
  it('сдвигает день, не путаясь в границах месяца', () => {
    expect(dayShift(7, '2026-08-28')).toBe('2026-09-04');
    expect(dayShift(-90, '2026-08-10')).toBe('2026-05-12');
  });

  it('печатает и разбирает срок годности', () => {
    expect(formatDate('2026-12-31')).toBe('31.12.2026');
    expect(formatDate(null)).toBe('—');
    expect(parseDate('31.12.2026')).toBe('2026-12-31');
    expect(parseDate('1.7.2026')).toBe('2026-07-01');
    expect(parseDate('2026-12-31')).toBe('2026-12-31');
    expect(parseDate('вчера')).toBeNull();
  });
});
