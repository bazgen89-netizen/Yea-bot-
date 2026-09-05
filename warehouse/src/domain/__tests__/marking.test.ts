import { MARKING_TYPES, TAX_SYSTEMS, barcodeFromCode, gtinFromBarcode, nameByCode } from '../marking';

describe('товарные группы', () => {
  it('коды не повторяются', () => {
    const codes = MARKING_TYPES.map((item) => item.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('код читается названием, а неизвестный — самим собой', () => {
    expect(nameByCode(MARKING_TYPES, '12')).toBe('Молочная продукция');
    expect(nameByCode(TAX_SYSTEMS, '04')).toBe('УСН Доход');
    // Товар мог приехать из выгрузки с группой, которой у нас ещё нет.
    // Показать код лучше, чем не показать ничего.
    expect(nameByCode(MARKING_TYPES, '99')).toBe('99');
    expect(nameByCode(MARKING_TYPES, null)).toBe('');
  });
});

describe('GTIN из штрихкода', () => {
  it('дополняет нулями до четырнадцати знаков', () => {
    expect(gtinFromBarcode('4600000000001')).toBe('04600000000001');
    expect(gtinFromBarcode('12345678')).toBe('00000012345678');
  });

  it('не трогает то, что штрихкодом не является', () => {
    // Внутренний код магазина длиной пять знаков — не EAN, и делать из него
    // GTIN нельзя: получился бы товар, которого нет ни в одном реестре.
    expect(gtinFromBarcode('01444')).toBeNull();
    expect(gtinFromBarcode('SH-01')).toBeNull();
    expect(gtinFromBarcode('')).toBeNull();
  });
});

describe('штрихкод из кода товара', () => {
  it('собирает внутренний EAN-13 с верной контрольной суммой', () => {
    const code = barcodeFromCode('1444');
    expect(code).toHaveLength(13);
    expect(code!.startsWith('2')).toBe(true);
    expect(checksum(code!)).toBe(true);
  });

  it('одинаковый код даёт одинаковый штрихкод', () => {
    expect(barcodeFromCode('1444')).toBe(barcodeFromCode('01444'));
  });

  it('без цифр в коде генерировать нечего', () => {
    expect(barcodeFromCode('')).toBeNull();
    expect(barcodeFromCode('без номера')).toBeNull();
  });
});

/** Проверка EAN-13 по её собственному правилу, а не повтором нашего кода. */
function checksum(barcode: string): boolean {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(barcode[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(barcode[12]);
}
