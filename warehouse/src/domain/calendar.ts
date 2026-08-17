/**
 * Раскладка месяца по неделям — для календаря в журнале чеков.
 *
 * Здесь нет ни React, ни базы: это арифметика, и её надо уметь проверить
 * тестом, а не глазами по экрану. Ошибка в один день сдвигает весь месяц
 * и заметна не сразу — как раз тот случай, когда считать «на месте», внутри
 * разметки, нельзя.
 *
 * Неделя начинается с понедельника: так в России, и так в календаре у него —
 * «П В С Ч П С В».
 */

/** Подписи столбцов календаря. */
export const WEEKDAYS = ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'];

/** Названия месяцев в заголовке: «август 2026». */
export const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

/**
 * Годы вокруг выбранного — для списка, который открывает стрелка у заголовка.
 *
 * Окном, а не всем веком: список нужен, чтобы попасть в нужный год, а не
 * чтобы листать от тысяча девятисотого. Выбранный год оказывается в середине,
 * поэтому его видно сразу, без прокрутки.
 *
 * Прошлого берём больше, чем будущего: чеки бывают прошлым числом, а будущим
 * не бывают вовсе — там пусто, сколько ни листай.
 */
export function yearWindow(year: number, back = 12, forward = 6): number[] {
  return Array.from({ length: back + forward + 1 }, (_, index) => year - back + index);
}

/**
 * Недели месяца: шесть строк по семь клеток, пустая клетка — `null`.
 *
 * Дни соседних месяцев не показываем вовсе, а не рисуем серым: в журнале по
 * ним всё равно не ищут, а серое число рядом с чёрным читается как «этот
 * день есть, но чеков нет», что неправда.
 *
 * @param month Месяц от нуля, как в `Date`.
 */
export function monthGrid(year: number, month: number): (number | null)[][] {
  const first = new Date(year, month, 1);
  // `getDay()` считает от воскресенья, а неделя у нас с понедельника.
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (number | null)[][] = [];
  for (let at = 0; at < cells.length; at += 7) weeks.push(cells.slice(at, at + 7));
  return weeks;
}

/** `2026, 7, 17` → `«2026-08-17»` — тот же вид, в котором лежат даты в базе. */
export function isoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Соседний месяц. Декабрь плюс один — январь следующего года. */
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}
