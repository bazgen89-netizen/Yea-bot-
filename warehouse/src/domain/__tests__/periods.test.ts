import { anchorOf, byMonth, canGoForward, periodTitle, tickLabel } from '../periods';

/**
 * Листание периодов на главной.
 *
 * Все проверки от одной даты — среда, 9 сентября 2026 года. Это тот самый
 * день, что на снимке, который прислал Вазген.
 */
const NOW = new Date(2026, 8, 9, 12, 0, 0);

describe('опорный день', () => {
  it('день листается по дням', () => {
    expect(anchorOf('today', 0, NOW).getDate()).toBe(9);
    expect(anchorOf('today', 1, NOW).getDate()).toBe(8);
    expect(anchorOf('today', 9, NOW).getDate()).toBe(31); // 31 августа
    expect(anchorOf('today', 9, NOW).getMonth()).toBe(7);
  });

  it('неделя — по семь дней', () => {
    const назад = anchorOf('week', 2, NOW);
    expect(назад.getDate()).toBe(26);
    expect(назад.getMonth()).toBe(7);
  });

  it('месяц — по календарю, а не по тридцать дней', () => {
    const назад = anchorOf('month', 1, NOW);
    expect(назад.getMonth()).toBe(7);
    expect(назад.getFullYear()).toBe(2026);

    // Через год с лишним попадаем в тот же месяц прошлого года.
    expect(anchorOf('month', 12, NOW).getMonth()).toBe(8);
    expect(anchorOf('month', 12, NOW).getFullYear()).toBe(2025);
  });

  /**
   * Иначе 31 марта минус месяц дало бы 3 марта: `setMonth` в JavaScript не
   * умеет прижимать число к последнему дню и перепрыгивает через месяц.
   */
  it('31-е число не перепрыгивает через февраль', () => {
    const марта31 = new Date(2026, 2, 31, 12, 0, 0);
    const назад = anchorOf('month', 1, марта31);
    expect(назад.getMonth()).toBe(1); // февраль
    expect(назад.getDate()).toBe(28);
  });

  it('29 февраля минус год попадает на 28-е', () => {
    const февраля29 = new Date(2028, 1, 29, 12, 0, 0);
    const назад = anchorOf('year', 1, февраля29);
    expect(назад.getFullYear()).toBe(2027);
    expect(назад.getMonth()).toBe(1);
    expect(назад.getDate()).toBe(28);
  });

  it('год листается по годам', () => {
    expect(anchorOf('year', 3, NOW).getFullYear()).toBe(2023);
  });

  it('нулевой шаг — сегодняшний день', () => {
    for (const kind of ['today', 'week', 'month', 'year'] as const) {
      expect(anchorOf(kind, 0, NOW).getDate()).toBe(9);
      expect(anchorOf(kind, 0, NOW).getMonth()).toBe(8);
    }
  });
});

describe('подпись периода', () => {
  it('день: сегодня, вчера, дальше — по имени', () => {
    expect(periodTitle('today', 0, NOW)).toBe('Сегодня');
    expect(periodTitle('today', 1, NOW)).toBe('Вчера');
    expect(periodTitle('today', 2, NOW)).toBe('Понедельник, 7 сентября');
  });

  it('неделя: месяц у начала пишется только когда он другой', () => {
    // 9 сентября 2026 — среда, неделя с понедельника 7-го по воскресенье 13-е.
    expect(periodTitle('week', 0, NOW)).toBe('7 – 13 сентября');
    // Неделя, переходящая через месяц, называет оба.
    expect(periodTitle('week', 1, NOW)).toBe('31 августа – 6 сентября');
  });

  it('месяц: год дописывается только у прошлых лет', () => {
    expect(periodTitle('month', 0, NOW)).toBe('Сентябрь');
    expect(periodTitle('month', 1, NOW)).toBe('Август');
    expect(periodTitle('month', 12, NOW)).toBe('Сентябрь 2025');
  });

  it('год', () => {
    expect(periodTitle('year', 0, NOW)).toBe('2026 год');
    expect(periodTitle('year', 2, NOW)).toBe('2024 год');
  });

  /** Раньше здесь стояло «Последние 7 дней», а считалась календарная неделя. */
  it('не обещает «последние семь дней», когда считает неделю с понедельника', () => {
    expect(periodTitle('week', 0, NOW)).not.toContain('Последние');
    expect(periodTitle('month', 0, NOW)).not.toContain('Последние');
  });
});

describe('вперёд', () => {
  it('из нынешнего периода листать вперёд некуда', () => {
    expect(canGoForward(0)).toBe(false);
    expect(canGoForward(1)).toBe(true);
  });
});

describe('столбики графика', () => {
  const дни = [
    { day: '2026-01-05', revenue: 100 },
    { day: '2026-01-20', revenue: 50 },
    { day: '2026-02-01', revenue: 7 },
    { day: '2026-03-15', revenue: 3 },
  ];

  it('дни сводятся в месяцы, порядок сохраняется', () => {
    expect(byMonth(дни)).toEqual([
      { day: '2026-01-01', revenue: 150 },
      { day: '2026-02-01', revenue: 7 },
      { day: '2026-03-01', revenue: 3 },
    ]);
  });

  it('сумма по месяцам равна сумме по дням', () => {
    const было = дни.reduce((a, p) => a + p.revenue, 0);
    expect(byMonth(дни).reduce((a, p) => a + p.revenue, 0)).toBe(было);
  });

  it('пустой год не ломает', () => {
    expect(byMonth([])).toEqual([]);
  });

  it('подписи: число для дня и часа, короткое имя для месяца', () => {
    expect(tickLabel('2026-09-09', 'day')).toBe('9');
    expect(tickLabel('07', 'hour')).toBe('7');
    expect(tickLabel('2026-09-01', 'month')).toBe('сен');
  });
});
