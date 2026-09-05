import { parseMarking } from '../marking';

/**
 * Разбор кода маркировки.
 *
 * Проверяется на настоящем виде кода: поля идут подряд и разделены невидимым
 * знаком GS, который сканер отдаёт как обычный символ.
 */
describe('код маркировки', () => {
  const GS = '\u001d';

  it('достаёт код товара и серийный номер', () => {
    const code = `0104603734000018215Qbag!${GS}93dGVz`;
    const marking = parseMarking(code);

    expect(marking.gtin).toBe('04603734000018');
    expect(marking.serial).toBe('5Qbag!');
    expect(marking.check).toBe('dGVz');
  });

  it('пустой код ничего не выдумывает', () => {
    expect(parseMarking('   ')).toEqual({ gtin: null, serial: null, check: null });
  });

  it('обычный штрихкод маркировкой не считается', () => {
    expect(parseMarking('4600000000012').gtin).toBeNull();
  });
});
