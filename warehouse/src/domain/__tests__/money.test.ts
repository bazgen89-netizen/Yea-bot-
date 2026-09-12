import { formatMoney, formatMoneyWeb, formatMoneyWithSign, parseMoney } from '../money';
import { formatQty, formatQtyWeb, lineTotal, parseQty } from '../qty';

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

  /**
   * Цена, записанная так, как её показывает кабинет.
   *
   * Экраны пишут суммы по-английски — «1,250.00» — и эта же строка стоит в
   * поле ввода цены. Пока запятая читалась как дробная часть, выходило
   * «1.250.00»: открыть карточку товара за 1 250 ₽ и нажать «Сохранить»,
   * ничего не меняя, значило потерять цену. На товарах дешевле тысячи это
   * не проявлялось, поэтому и жило долго.
   */
  it('читает сумму в том же виде, в каком её показывает', () => {
    expect(parseMoney(formatMoneyWeb(125_000))).toBe(125_000);
    expect(parseMoney(formatMoneyWeb(452_588_510))).toBe(452_588_510);
    expect(parseMoney(formatMoney(125_000))).toBe(125_000);

    expect(parseMoney('1,250.00')).toBe(125_000);
    expect(parseMoney('4,525,885.10')).toBe(452_588_510);
    expect(parseMoney('-1,250.00')).toBe(-125_000);
  });

  it('разделитель тысяч узнаёт только там, где он не спутается с копейками', () => {
    // Две группы подряд бывают только у тысяч.
    expect(parseMoney('1.250.000')).toBe(125_000_000);
    // А одна — это дробная часть: «12.345» так и остаётся 12 руб. 35 коп.
    expect(parseMoney('12.345')).toBe(1235);
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

describe('formatQtyWeb', () => {
  it('пишет количество по-английски и всегда с тремя знаками', () => {
    expect(formatQtyWeb(692599300)).toBe('692,599.300');
    expect(formatQtyWeb(-692599300)).toBe('-692,599.300');
    expect(formatQtyWeb(2000)).toBe('2.000');
    expect(formatQtyWeb(50)).toBe('0.050');
    expect(formatQtyWeb(0)).toBe('0.000');
  });
});

describe('parseQty', () => {
  /**
   * Количество ломалось ровно так же, как цена: экран пишет
   * «692,599.300», а разбор читал запятую как дробную часть. На складе,
   * где остаток шестизначный, это значило «не число».
   */
  it('читает количество в том же виде, в каком его показывает', () => {
    expect(parseQty(formatQtyWeb(692_599_300))).toBe(692_599_300);
    expect(parseQty('692,599.300')).toBe(692_599_300);
    expect(parseQty('1 234,5')).toBe(1_234_500);
  });

  it('и по-прежнему не принимает мусор', () => {
    expect(parseQty('')).toBeNull();
    expect(parseQty('две пачки')).toBeNull();
    expect(parseQty('1..2')).toBeNull();
  });
});
