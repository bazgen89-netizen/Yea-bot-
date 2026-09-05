/**
 * Группировка дневных точек в недели и месяцы.
 *
 * Здесь, а не в SQL: неделя у SQLite считается от воскресенья, а у нас от
 * понедельника, и подкручивать это в запросе означало бы прятать календарную
 * логику там, где её не проверить тестом без базы.
 */

export interface DayPoint {
  /** Дата в формате YYYY-MM-DD. */
  day: string;
  revenue: number;
  profit: number;
  receipts: number;
}

export interface Bucket extends Omit<DayPoint, 'day'> {
  /** Подпись периода: «18–24 августа», «август 2026». */
  label: string;
  /** Первый день периода, YYYY-MM-DD — по нему идёт сортировка. */
  from: string;
}

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const MONTHS_NOMINATIVE = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

function parse(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Понедельник той недели, в которую попадает день. */
function monday(day: string): Date {
  const date = parse(day);
  // getUTCDay(): воскресенье = 0. Сдвигаем так, чтобы неделя начиналась с понедельника.
  const shift = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - shift);
  return date;
}

function add(points: Bucket, point: DayPoint): void {
  points.revenue += point.revenue;
  points.profit += point.profit;
  points.receipts += point.receipts;
}

function collect(points: DayPoint[], keyOf: (day: string) => { from: string; label: string }): Bucket[] {
  const buckets = new Map<string, Bucket>();

  for (const point of points) {
    const { from, label } = keyOf(point.day);
    let bucket = buckets.get(from);
    if (!bucket) {
      bucket = { from, label, revenue: 0, profit: 0, receipts: 0 };
      buckets.set(from, bucket);
    }
    add(bucket, point);
  }

  return [...buckets.values()].sort((a, b) => (a.from < b.from ? -1 : 1));
}

export function groupByWeek(points: DayPoint[]): Bucket[] {
  return collect(points, (day) => {
    const start = monday(day);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);

    // «18–24 августа», а если неделя переходит в другой месяц — «29 июля – 4 августа».
    const label =
      start.getUTCMonth() === end.getUTCMonth()
        ? `${start.getUTCDate()}–${end.getUTCDate()} ${MONTHS[start.getUTCMonth()]}`
        : `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]} – ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`;

    return { from: iso(start), label };
  });
}

export function groupByMonth(points: DayPoint[]): Bucket[] {
  return collect(points, (day) => {
    const date = parse(day);
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    return {
      from: iso(start),
      label: `${MONTHS_NOMINATIVE[start.getUTCMonth()]} ${start.getUTCFullYear()}`,
    };
  });
}

/** «2026-08-10» -> «10 августа». */
export function formatDayLabel(day: string): string {
  const date = parse(day);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}
