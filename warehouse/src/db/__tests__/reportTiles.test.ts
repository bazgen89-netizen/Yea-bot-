import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPORTS, reportById } from '../reportTypes';

/**
 * Плитки отчётов на главной ведут в существующие отчёты.
 *
 * Четыре плитки из шести открывали «Такого отчёта нет»: на главной они
 * назывались `daily`, `products`, `customers`, `moves`, а в реестре отчёты
 * зовутся `day`, `product`, `agent`, `motion`. Поймать это можно было
 * только пальцем — типы тут не помогают, имя отчёта склеивается в адрес
 * строкой.
 *
 * Поэтому имена вычитываются из самого экрана: список, переписанный сюда
 * руками, разошёлся бы с ним ровно так же, как разошёлся с реестром.
 */
describe('плитки отчётов на главной', () => {
  const экран = readFileSync(
    join(__dirname, '..', '..', '..', 'app', '(tabs)', 'index.tsx'),
    'utf8',
  );

  /** Имена из массива REPORTS на главной. */
  const имена = (() => {
    const начало = экран.indexOf('const REPORTS = [');
    expect(начало).toBeGreaterThan(-1);
    const конец = экран.indexOf('];', начало);
    const кусок = экран.slice(начало, конец);
    return [...кусок.matchAll(/key: '([^']+)'/g)].map((найдено) => найдено[1]);
  })();

  it('на главной шесть плиток — столько же, сколько у него', () => {
    expect(имена).toHaveLength(6);
  });

  it.each(имена)('плитка «%s» открывает существующий отчёт', (имя) => {
    expect(reportById(имя)).not.toBeNull();
  });

  it('в реестре нет двух отчётов с одним именем', () => {
    const все = REPORTS.map((отчёт) => отчёт.id);
    expect(new Set(все).size).toBe(все.length);
  });
});
