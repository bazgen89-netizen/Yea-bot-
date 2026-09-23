import { SCALE_TITLE, scaleFile, scaleHeader, scaleRows, scaleSelect } from '../scales';
import type { ScaleProduct } from '../scales';

/**
 * Файл для весов.
 *
 * Пункт был приглушён, а в списке стояло «нужны марка и модель весов». На
 * деле кабинет ничего не спрашивает: он даёт выбрать одну из трёх моделей
 * и отдаёт таблицу с её колонками. Наборы взяты из их же собранной
 * страницы, и проверять надо ровно это — что колонка встала на своё место.
 */
describe('файл для весов', () => {
  const чай: ScaleProduct = {
    name: 'Габа Алишань',
    code: '0142',
    plu: '00073',
    price: 125_000,
    weighted: true,
    expiresAt: null,
  };

  const стакан: ScaleProduct = {
    name: 'Чай с собой, большой стакан',
    code: '0009',
    plu: null,
    price: 25_000,
    weighted: false,
    expiresAt: null,
  };

  it('называет модели так же, как кабинет', () => {
    expect(SCALE_TITLE.massak).toBe('МАССА-К');
    expect(SCALE_TITLE.mertech).toBe('MERTECH M-ER');
    expect(SCALE_TITLE.rongta).toBe('RONGTA');
  });

  describe('МАССА-К', () => {
    it('ставит колонки в их порядке', () => {
      expect(scaleHeader('massak')).toEqual([
        'ID',
        'Code',
        'Name',
        'Type',
        'Price',
        'Composition',
        'Expiration',
        'PLU',
      ]);
    });

    it('пишет цену рублями, а не копейками', () => {
      const [, row] = scaleRows('massak', [чай]);
      expect(row[4]).toBe('1250.00');
    });

    it('различает весовой и штучный: 0 и 1', () => {
      const [, весовой, штучный] = scaleRows('massak', [чай, стакан]);
      expect(весовой[3]).toBe('0');
      expect(штучный[3]).toBe('1');
    });

    it('нумерует подряд, а не по коду товара', () => {
      const [, первый, второй] = scaleRows('massak', [чай, стакан]);
      expect(первый[0]).toBe('1');
      expect(второй[0]).toBe('2');
    });
  });

  describe('MERTECH M-ER', () => {
    it('срезает ведущие нули у PLU: весы их не принимают', () => {
      const [, row] = scaleRows('mertech', [чай]);
      expect(row[2]).toBe('73');
    });

    it('режет длинное название надвое — на этикетке две строки', () => {
      const длинный: ScaleProduct = { ...чай, name: 'П'.repeat(70) };
      const [, row] = scaleRows('mertech', [длинный]);

      expect(String(row[3])).toHaveLength(50);
      expect(String(row[4])).toHaveLength(20);
    });

    it('считает, сколько дней осталось до конца срока годности', () => {
      const через10 = new Date(Date.now() + 10 * 86_400_000).toISOString();
      const [, row] = scaleRows('mertech', [{ ...чай, expiresAt: через10 }]);

      expect(row[8]).toBe('10');
      expect(String(row[15])).toMatch(/^\d\d\.\d\d\.\d\d$/);
    });

    it('без срока годности оставляет клетки пустыми, а не «0»', () => {
      const [, row] = scaleRows('mertech', [чай]);
      expect(row[8]).toBe('');
      expect(row[15]).toBe('');
    });
  });

  describe('RONGTA', () => {
    it('пишет цену целым числом в копейках', () => {
      const [, row] = scaleRows('rongta', [чай]);
      expect(row[5]).toBe(125_000);
    });

    it('кладёт префикс штрихкода в «Department» — по умолчанию 21', () => {
      const [, обычный] = scaleRows('rongta', [чай]);
      const [, свой] = scaleRows('rongta', [чай], { prefix: 22 });

      expect(обычный[7]).toBe(21);
      expect(свой[7]).toBe(22);
    });
  });

  describe('отбор', () => {
    it('«только весовые» убирает штучные', () => {
      expect(scaleSelect([чай, стакан], { weightedOnly: true })).toEqual([чай]);
    });

    it('«только с PLU» убирает тех, кого весы не найдут', () => {
      expect(scaleSelect([чай, стакан], { pluOnly: true })).toEqual([чай]);
    });

    it('без флажков берёт всех', () => {
      expect(scaleSelect([чай, стакан])).toHaveLength(2);
    });
  });

  describe('готовый файл', () => {
    it('у МАССА-К — запятые и .csv', () => {
      const file = scaleFile('massak', [чай]);
      expect(file.name).toBe('scale.csv');
      expect(file.text).toContain('ID,Code,Name');
    });

    it('у RONGTA — табуляции и .txp', () => {
      const file = scaleFile('rongta', [чай]);
      expect(file.name).toBe('scale.txp');
      expect(file.text).toContain('PLU No.\tName');
    });

    it('начинается с метки кодировки: иначе весы читают кириллицу кашей', () => {
      expect(scaleFile('massak', [чай]).text.startsWith('﻿')).toBe(true);
    });

    it('запятую в названии заменяет точкой — она бы разорвала строку', () => {
      const file = scaleFile('massak', [стакан]);
      expect(file.text).toContain('Чай с собой. большой стакан');
      // Колонок должно остаться восемь, а не девять.
      const columns = file.text.trim().split('\n')[1].split(',');
      expect(columns).toHaveLength(8);
    });
  });
});
