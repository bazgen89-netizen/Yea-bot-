/**
 * Листание периодов на главной: день назад, неделя назад, месяц, год.
 *
 * Вазген показал, как это устроено у него: сверху «День · Неделя · Месяц ·
 * Год», а карточку с показателями можно листать вправо-влево — и она
 * переносит на предыдущий такой же период. Выбрал «день» — листаешь по дням,
 * выбрал «месяц» — по месяцам.
 *
 * Здесь только даты: ни React, ни базы. Смещение считается сдвигом опорного
 * дня, а границы периода из него достаёт `periodFor` — тот же самый код, что
 * и для сегодняшнего дня. Так «месяц назад» не может разойтись с «этим
 * месяцем» в трактовке границ.
 */

/** Насколько назад листнули: 0 — текущий период, 1 — предыдущий. */
export type Back = number;

export type PeriodName = 'today' | 'week' | 'month' | 'year';

const MONTHS_RODIT = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const MONTHS_NOMIN = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const WEEKDAYS = [
  'Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота',
];

/**
 * Опорный день периода, отстоящего на `back` шагов назад.
 *
 * Месяц и год сдвигаются по календарю, а не вычитанием тридцати дней: «месяц
 * назад» от 31 марта — это февраль, а не 1 марта. День месяца при этом
 * прижимается к последнему существующему, иначе 31 марта минус месяц дало бы
 * 3 марта — так ведёт себя `setMonth` в JavaScript.
 */
export function anchorOf(kind: PeriodName, back: Back, now = new Date()): Date {
  const date = new Date(now);

  if (kind === 'today') {
    date.setDate(date.getDate() - back);
    return date;
  }

  if (kind === 'week') {
    date.setDate(date.getDate() - back * 7);
    return date;
  }

  if (kind === 'month') {
    const day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() - back);
    date.setDate(Math.min(day, daysInMonth(date.getFullYear(), date.getMonth())));
    return date;
  }

  const day = date.getDate();
  date.setDate(1);
  date.setFullYear(date.getFullYear() - back);
  date.setDate(Math.min(day, daysInMonth(date.getFullYear(), date.getMonth())));
  return date;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Подпись периода — та, что стоит над числом выручки.
 *
 * До листания здесь было «Последние 7 дней» и «Последние 30 дней», и это
 * расходилось с тем, что считалось: `periodFor` берёт календарную неделю с
 * понедельника и календарный месяц. Пока листать было нечего, разница не
 * бросалась в глаза; теперь «последние 7 дней» три шага назад — бессмыслица.
 */
export function periodTitle(kind: PeriodName, back: Back, now = new Date()): string {
  const date = anchorOf(kind, back, now);

  if (kind === 'today') {
    if (back === 0) return 'Сегодня';
    if (back === 1) return 'Вчера';
    return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS_RODIT[date.getMonth()]}`;
  }

  if (kind === 'week') {
    const start = new Date(date);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    // «1–7 сентября», но «29 сентября – 5 октября»: месяц у начала пишем
    // только когда он другой, иначе строка раздувается без нужды.
    const left =
      start.getMonth() === end.getMonth()
        ? String(start.getDate())
        : `${start.getDate()} ${MONTHS_RODIT[start.getMonth()]}`;

    return `${left} – ${end.getDate()} ${MONTHS_RODIT[end.getMonth()]}`;
  }

  if (kind === 'month') {
    const name = MONTHS_NOMIN[date.getMonth()];
    // Год дописываем, только если он не нынешний: «Сентябрь» короче и понятнее.
    return date.getFullYear() === now.getFullYear() ? name : `${name} ${date.getFullYear()}`;
  }

  return `${date.getFullYear()} год`;
}

/**
 * Можно ли листнуть вперёд.
 *
 * Вперёд от нынешнего периода листать некуда: будущей выручки не бывает, а
 * пустой экран с нулями читается как поломка, а не как «этот день ещё не
 * настал».
 */
export function canGoForward(back: Back): boolean {
  return back > 0;
}

/** Точка графика: день или час и выручка за него. */
export interface Point {
  day: string;
  revenue: number;
}

const MONTHS_SHORT = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

/**
 * Свести дни в месяцы.
 *
 * Год — это двенадцать столбиков, а не триста шестьдесят пять. Триста
 * шестьдесят пять в карточке шириной с телефон схлопываются в ничто: одни
 * отступы между ними занимают больше места, чем вся карточка, — и график
 * выходил пустым белым полем. Пустое поле читается как «данных нет», хотя
 * выручка за год есть.
 *
 * Порядок сохраняется тот, в котором пришли дни: их отдаёт база по возрастанию
 * даты, и пересортировывать нечего.
 */
export function byMonth(points: Point[]): Point[] {
  const out: Point[] = [];
  const место = new Map<string, number>();

  for (const point of points) {
    const key = point.day.slice(0, 7);
    const at = место.get(key);

    if (at === undefined) {
      место.set(key, out.length);
      out.push({ day: `${key}-01`, revenue: point.revenue });
    } else {
      out[at].revenue += point.revenue;
    }
  }

  return out;
}

/** Подпись под столбиком: «9» для дня и часа, «сен» для месяца. */
export function tickLabel(day: string, unit: 'hour' | 'day' | 'month'): string {
  if (unit === 'month') return MONTHS_SHORT[Number(day.slice(5, 7)) - 1] ?? day;
  if (day.length <= 2) return String(Number(day));
  return String(Number(day.slice(8, 10)));
}
