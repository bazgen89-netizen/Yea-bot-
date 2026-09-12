/**
 * Цена товара: скидка, наценка, маржа, НДС.
 *
 * Проценты живут в сотых долях процента (500 = 5 %) — как скидка клиента в
 * базе. Дробных процентов не бывает: 5,5 % — это 550, а не 5.5, и умножение
 * на копейки остаётся целочисленным.
 */
import type { Kopecks } from './money';

/** Сотые доли процента: 500 = 5 %, 2000 = 20 %. */
export type Bp = number;

/** 500 -> "5 %", 550 -> "5,5 %". */
export function formatPercent(bp: Bp): string {
  const whole = Math.trunc(bp / 100);
  const frac = Math.abs(bp % 100);
  if (frac === 0) return `${whole} %`;
  const digits = frac % 10 === 0 ? String(frac / 10) : String(frac).padStart(2, '0');
  return `${whole},${digits} %`;
}

/** "5", "5,5", "5 %" -> сотые доли процента. null, если не число. */
export function parsePercent(input: string): Bp | null {
  const cleaned = input.replace(/[\s %]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Цена после скидки. Скидка больше 100 % цену в минус не уводит. */
export function priceWithDiscount(price: Kopecks, discountBp: Bp): Kopecks {
  if (discountBp <= 0) return price;
  const capped = Math.min(discountBp, 10000);
  return price - Math.round((price * capped) / 10000);
}

/**
 * Наценка — сколько накинули сверху **цены закупки**.
 *
 * Именно закупки, а не себестоимости: в исходном приложении товар с ценой
 * закупки 17,00 и ценой продажи 59,90 показывает наценку 252,35 %, а это
 * ровно (59,90 − 17,00) / 17,00. Себестоимость там своя, средняя по складу,
 * и наценку от неё не считают.
 *
 * При нулевой закупке не определена: делить не на что.
 */
/**
 * Новая цена при изменении сразу для многих товаров.
 *
 * Три способа, как у него в «Ценах и скидках»: поставить одну цену всем,
 * поднять или опустить на проценты, поднять или опустить на рубли. Проценты
 * считаются от нынешней цены каждого товара, а не от общей: «плюс десять
 * процентов» на чай за 300 и за 3000 — это разные рубли, и так и надо.
 *
 * Ниже нуля цена не опускается: отрицательная цена — не скидка, а ошибка.
 */
export function repricedTo(
  price: Kopecks,
  change: { mode: 'set' | 'percent' | 'amount'; value: number },
): Kopecks {
  if (change.mode === 'set') return Math.max(0, Math.round(change.value)) as Kopecks;

  if (change.mode === 'percent') {
    // Проценты в сотых долях процента, как и везде у нас: 10% — это 1000.
    const next = Math.round((price * (10000 + change.value)) / 10000);
    return Math.max(0, next) as Kopecks;
  }

  return Math.max(0, price + Math.round(change.value)) as Kopecks;
}

export function markupBp(purchase: Kopecks, sale: Kopecks): Bp | null {
  if (purchase === 0) return null;
  return Math.round(((sale - purchase) / purchase) * 10000);
}

/**
 * Маржа — прибыль к выручке: какая доля цены остаётся магазину.
 * При нулевой цене не определена.
 */
export function marginBp(cost: Kopecks, sale: Kopecks): Bp | null {
  if (sale === 0) return null;
  return Math.round(((sale - cost) / sale) * 10000);
}

/** Цена продажи, дающая заданную наценку к цене закупки. */
export function priceFromMarkup(purchase: Kopecks, bp: Bp): Kopecks {
  return purchase + Math.round((purchase * bp) / 10000);
}

/**
 * НДС, уже сидящий в цене. В рознице цена на ценнике — с налогом,
 * поэтому налог из неё выделяется, а не начисляется сверху.
 */
export function vatInPrice(price: Kopecks, vatBp: Bp | null): Kopecks {
  if (!vatBp) return 0;
  return Math.round((price * vatBp) / (10000 + vatBp));
}

/** Ставки НДС, которые предлагает исходное приложение. */
export const VAT_RATES: { label: string; bp: Bp | null }[] = [
  { label: 'Без НДС', bp: null },
  { label: '0 %', bp: 0 },
  { label: '5 %', bp: 500 },
  { label: '7 %', bp: 700 },
  { label: '10 %', bp: 1000 },
  { label: '20 %', bp: 2000 },
];

/** Сегодняшняя дата в виде YYYY-MM-DD — в этом виде хранится срок годности. */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Дата через сколько-то дней, тем же форматом. */
export function dayShift(days: number, from: string = today()): string {
  const date = new Date(`${from}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** «2026-08-10» -> «10.08.2026». Пусто — прочерк. */
export function formatDate(value: string | null): string {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}

/** «10.08.2026», «10/08/2026», «2026-08-10» -> «2026-08-10». null, если не дата. */
export function parseDate(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) return trimmed;

  const human = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(trimmed);
  if (!human) return null;

  const [, day, month, year] = human;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
