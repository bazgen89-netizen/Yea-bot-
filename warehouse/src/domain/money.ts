/**
 * Деньги хранятся в копейках (целые числа).
 * Рубли как дробные числа не используются нигде: 0.1 + 0.2 !== 0.3, и на длинных
 * чеках это даёт расхождение с кассой.
 */

export type Kopecks = number;

const NBSP = '\u00A0'; // неразрывный пробел: «1 234,50 ₽» не переносится по строкам

/**
 * "1 234,50" | "1,234.50" | "1234.5" | "1234" -> копейки.
 * Возвращает null, если не число.
 *
 * Разделитель тысяч приходится разбирать всерьёз. Экраны кабинета пишут
 * суммы по-английски — «1,250.00», — и эта же строка кладётся в поле ввода
 * цены. Раньше запятая в ней читалась как дробная часть, выходило
 * «1.250.00», и цена от тысячи и выше не читалась вовсе: открыть карточку
 * товара за 1 250 ₽ и нажать «Сохранить», ничего не меняя, значило
 * потерять цену. Правило простое: если разделителей два вида, дробный —
 * тот, что правее; если один и за ним ровно три цифры до конца, это тысячи.
 */
export function parseMoney(input: string): Kopecks | null {
  const value = parseDecimal(input.replace(/₽/g, ''));
  if (value === null) return null;

  // Округляем к ближайшей копейке: Number("12.345") * 100 = 1234.4999...
  return Math.round(value * 100);
}

/**
 * Число из того, что напечатал человек или показал экран.
 *
 * Общее и для денег, и для количеств: правила разбора у них одни, а два
 * набора этих правил рано или поздно разойдутся — и сумма чека перестанет
 * сходиться с количеством в нём.
 *
 * Возвращает `null`, если это не число.
 */
export function parseDecimal(input: string): number | null {
  const cleaned = input.replace(/[\s\u00A0]/g, '');
  if (cleaned === '') return null;
  if (!/^-?[\d.,]*$/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // Оба знака: дробный — правый, второй разделяет тысячи.
    const group = lastComma > lastDot ? '.' : ',';
    normalized = cleaned.split(group).join('').replace(',', '.');
  } else if (/^-?\d{1,3}([.,]\d{3}){2,}$/.test(cleaned)) {
    // «1.250.000» — это миллион с четвертью: столько групп подряд бывает
    // только у разделителя тысяч. Один разделитель с тремя цифрами
    // («12.345») трогать нельзя — это дробная часть, которую мы округляем.
    normalized = cleaned.replace(/[.,]/g, '');
  } else {
    normalized = cleaned.replace(',', '.');
  }

  if (!/^-?\d*\.?\d*$/.test(normalized)) return null;

  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
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
