/**
 * Ряд для графика: по точке на каждый день периода.
 *
 * База отдаёт только те дни, в которые что-то продали: `GROUP BY day` пустые
 * дни пропускает. График же рисует точки подряд, одну за другой, — и если
 * шестого числа не торговали, седьмое встаёт на место шестого, и весь ряд
 * уезжает влево. На месяце с одним выходным вершина оказывается не в том
 * дне, а подпись под ней — чужая.
 *
 * Поэтому ряд раскладывается по номерам дней: пустой день — ноль, а не
 * пропуск.
 */
export interface DayValue {
  /** День строкой «ГГГГ-ММ-ДД» — как его отдаёт отчёт. */
  day: string;
  value: number;
}

/**
 * Разложить точки по дням периода.
 *
 * `from` — начало периода, ISO местной полуночи (то, что возвращает
 * `periodFor`). `days` — сколько дней в периоде.
 */
export function densify(points: readonly DayValue[], from: string, days: number): number[] {
  const start = new Date(from);
  const row = new Array<number>(Math.max(0, days)).fill(0);
  if (Number.isNaN(start.getTime())) return row;

  // Считаем в UTC-сутках: в местных к номеру дня примешался бы переход на
  // летнее время, и один день в году сдвинул бы весь ряд.
  const base = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());

  for (const point of points) {
    const [year, month, day] = point.day.split('-').map(Number);
    if (!year || !month || !day) continue;

    const index = Math.round((Date.UTC(year, month - 1, day) - base) / 86_400_000);
    if (index >= 0 && index < row.length) row[index] = point.value;
  }

  return row;
}
