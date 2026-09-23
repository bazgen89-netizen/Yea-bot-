import { DICTIONARY, type Translations } from './dictionary';
import { POS_DICTIONARY } from './posDictionary';
import { DEFAULT_LANGUAGE, type LanguageCode } from './languages';

/** Языки, для которых нужен словарь: все, кроме языка ключей. */
// Именно 'ru', а не `typeof DEFAULT_LANGUAGE`: у константы тип «любой язык»,
// и вычитание давало бы пустое множество — словарь оказывался бы недоступен.
type Translated = Exclude<LanguageCode, 'ru'>;

/**
 * Полный словарь: каркас кабинета плюс подписи кассы, сверенные с CloudShop.
 * Первый важнее — он писался под наши экраны.
 */
const ALL: Record<string, Translations> = { ...POS_DICTIONARY, ...DICTIONARY };

/**
 * Тот же словарь, но по «спрямлённому» ключу: без регистра, без лишних
 * пробелов, без ё и без знака в конце.
 *
 * Одна и та же подпись встречается на экранах то заголовком, то кнопкой
 * заглавными, то с двоеточием: «Возврат», «ВОЗВРАТ», «Возврат:». Заводить на
 * это три статьи словаря — значит забыть четвёртую.
 */
const LOOSE = new Map<string, Translations>();
for (const [key, row] of Object.entries(ALL)) {
  const loose = simplify(key);
  if (!LOOSE.has(loose)) LOOSE.set(loose, row);
}

function simplify(text: string): string {
  return text.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').replace(/[:.!?]+$/, '');
}

/**
 * Перевод строки на выбранный язык.
 *
 * Русский — язык ключей, для него словарь не нужен. Для остальных: нет
 * перевода — возвращается сам ключ, то есть русская строка. Это заметно и
 * честно; пустое место или `menu.home` на экране были бы хуже.
 */
export function translate(text: string, language: LanguageCode): string {
  if (language === DEFAULT_LANGUAGE) return text;

  const exact = ALL[text]?.[language as Translated];
  if (exact) return exact;

  // Числа, суммы и названия товаров в словарь не заглядывают: без русских
  // букв там искать нечего, а поиск идёт на каждую надпись экрана.
  if (!/[А-Яа-яЁё]/.test(text)) return text;

  const loose = LOOSE.get(simplify(text))?.[language as Translated];
  if (!loose) return text;

  // Регистр, хвостовой знак и пробелы по краям — от исходной строки. Пробелы
  // здесь не мелочь: цена набирается двумя кусками, «1 300,00» и « руб», и
  // потерянный пробел склеивал их в «1 300,00RUB».
  const [, before, body, after] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) as RegExpExecArray;
  const tail = body.match(/[:.!?]+$/)?.[0] ?? '';
  const upper = body === body.toUpperCase() && /[А-ЯЁ]/.test(body);
  return before + (upper ? loose.toUpperCase() : loose) + tail + after;
}

/**
 * Перевод составного заголовка: «Товары и услуги / справочник».
 *
 * Части переводятся по отдельности — так словарь остаётся коротким, а сочетания
 * не приходится заводить по одному на каждый раздел.
 */
export function translatePath(text: string, language: LanguageCode): string {
  if (language === DEFAULT_LANGUAGE) return text;
  return text
    .split(' / ')
    .map((part) => translate(part, language))
    .join(' / ');
}

/** Сколько строк словаря переведено на язык — для раздела «Данные». */
export function coverage(language: LanguageCode): { done: number; total: number } {
  const total = Object.keys(ALL).length;
  if (language === DEFAULT_LANGUAGE) return { done: total, total };

  const done = Object.values(ALL).filter((row) => row[language as Translated]).length;
  return { done, total };
}
