/**
 * Деньги хранятся в копейках (целые числа).
 * Рубли как дробные числа не используются нигде: 0.1 + 0.2 !== 0.3, и на длинных
 * чеках это даёт расхождение с кассой.
 */

export type Kopecks = number;

const NBSP = '\u00A0'; // неразрывный пробел: «1 234,50 ₽» не переносится по строкам

/** "1 234,50" | "1234.5" | "1234" -> копейки. Возвращает null, если не число. */
export function parseMoney(input: string): Kopecks | null {
  const cleaned = input.replace(/[\s ₽]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;

  // Округляем к ближайшей копейке: Number("12.345") * 100 = 1234.4999...
  return Math.round(value * 100);
}

/** 123450 -> "1 234,50" */
export function formatMoney(kopecks: Kopecks): string {
  const negative = kopecks < 0;
  const abs = Math.abs(Math.round(kopecks));
  const rubles = Math.floor(abs / 100);
  const cents = abs % 100;

  const grouped = String(rubles).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${negative ? '-' : ''}${grouped},${String(cents).padStart(2, '0')}`;
}

/** 123450 -> "1 234,50 ₽" */
export function formatMoneyWithSign(kopecks: Kopecks): string {
  return `${formatMoney(kopecks)}${NBSP}₽`;
}

/**
 * 123450 -> "1,234.50" — как в веб-кабинете.
 *
 * Формат другой не по недосмотру: на экранах кабинета суммы записаны
 * по-английски («1,183.62», «104,878.84»), а на телефоне — по-русски
 * («1 183,62»). Повторяем то, что видит пользователь, поэтому функции две
 * и каждая живёт на своей половине приложения.
 */
export function formatMoneyWeb(kopecks: Kopecks): string {
  const negative = kopecks < 0;
  const abs = Math.abs(Math.round(kopecks));
  const rubles = Math.floor(abs / 100);
  const cents = abs % 100;

  const grouped = String(rubles).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${String(cents).padStart(2, '0')}`;
}
