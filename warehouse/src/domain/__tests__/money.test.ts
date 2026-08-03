import { formatMoney, formatMoneyWithSign, parseMoney } from '../money';
import { formatQty, lineTotal, parseQty } from '../qty';

describe('parseMoney', () => {
  it('разбирает запятую и точку как разделитель', () => {
    expect(parseMoney('1234,50')).toBe(123450);
    expect(parseMoney('1234.50')).toBe(123450);
  });

  it('игнорирует пробелы и знак рубля', () => {
    expect(parseMoney('1 234,50 ₽')).toBe(123450);
    expect(parseMoney('1 234,50')).toBe(123450); // неразрывный пробел
  });

  it('округляет до копейки без ошибки float', () => {
    expect(parseMoney('12.345')).toBe(1235);
    expect(parseMoney('0.1')).toBe(10);
    expect(parseMoney('19.99')).toBe(1999);
  });

  it('возвращает null на мусоре', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('абв')).toBeNull();
    expect(parseMoney('1..2')).toBeNull();
  });
});

describe('formatMoney', () => {
  it('всегда показывает две копейки', () => {
    expect(formatMoney(123450)).toBe('1\u00A0234,50');
    expect(formatMoney(100)).toBe('1,00');
    expect(formatMoney(5)).toBe('0,05');
    expect(formatMoney(0)).toBe('0,00');
  });

  it('группирует разряды', () => {
    expect(formatMoney(123456789)).toBe('1\u00A0234\u00A0567,89');
  });

  it('сохраняет минус', () => {
    expect(formatMoney(-12345)).toBe('-123,45');
  });

  it('добавляет знак рубля', () => {
    expect(formatMoneyWithSign(50000)).toBe('500,00\u00A0₽');
  });
});

describe('parseQty / formatQty', () => {
  it('поддерживает вес с граммами', () => {
    expect(parseQty('0,05')).toBe(50);
    expect(formatQty(50)).toBe('0,05');
  });

  it('не показывает лишние нули у целых', () => {
    expect(formatQty(2000)).toBe('2');
    expect(formatQty(1500)).toBe('1,5');
    expect(formatQty(1250)).toBe('1,25');
  });

  it('round-trip не теряет значение', () => {
    for (const value of ['1', '1,5', '0,001', '123,456']) {
      expect(formatQty(parseQty(value)!)).toBe(value);
    }
  });
});

describe('lineTotal', () => {
  it('считает цену за вес', () => {
    // 0,5 кг по 1000,00 ₽/кг = 500,00 ₽
    expect(lineTotal(100000, 500)).toBe(50000);
  });

  it('округляет дробную копейку', () => {
    // 0,333 кг по 100,00 ₽/кг = 33,30 ₽
    expect(lineTotal(10000, 333)).toBe(3330);
  });

  it('целые количества считает точно', () => {
    expect(lineTotal(19999, 3000)).toBe(59997);
  });
});
