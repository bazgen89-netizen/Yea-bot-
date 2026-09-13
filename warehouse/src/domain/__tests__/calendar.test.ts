import { isoDay, monthGrid, shiftMonth, WEEKDAYS } from '../calendar';

describe('раскладка месяца', () => {
  it('август 2026 начинается в субботу', () => {
    const weeks = monthGrid(2026, 7);
    // Первая неделя пустая до субботы: 1 и 2 августа — суббота и воскресенье.
    expect(weeks[0]).toEqual([null, null, null, null, null, 1, 2]);
    expect(weeks[1]).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it('в месяце столько дней, сколько в нём есть', () => {
    const days = (year: number, month: number) =>
      monthGrid(year, month).flat().filter((day) => day !== null).length;

    expect(days(2026, 7)).toBe(31);
    expect(days(2026, 1)).toBe(28);
    // Високосный: 2028 год делится на четыре.
    expect(days(2028, 1)).toBe(29);
  });

  it('в каждой строке семь клеток, и месяц заканчивается ровно', () => {
    const weeks = monthGrid(2026, 7);
    for (const week of weeks) expect(week).toHaveLength(WEEKDAYS.length);
    expect(weeks.flat()).toHaveLength(weeks.length * 7);
  });

  it('день записывается так же, как хранится в базе', () => {
    expect(isoDay(2026, 7, 17)).toBe('2026-08-17');
    expect(isoDay(2026, 0, 1)).toBe('2026-01-01');
  });

  it('переход через границу года', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 7, 0)).toEqual({ year: 2026, month: 7 });
  });
});
