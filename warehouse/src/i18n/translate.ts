import { DICTIONARY } from './dictionary';
import { DEFAULT_LANGUAGE, type LanguageCode } from './languages';

/**
 * Перевод строки на выбранный язык.
 *
 * Русский — язык ключей, для него словарь не нужен. Для остальных: нет
 * перевода — возвращается сам ключ, то есть русская строка. Это заметно и
 * честно; пустое место или `menu.home` на экране были бы хуже.
 */
export function translate(text: string, language: LanguageCode): string {
  if (language === DEFAULT_LANGUAGE) return text;
  return DICTIONARY[text]?.[language as Translated] ?? text;
}

/** Языки, для которых нужен словарь: все, кроме языка ключей. */
type Translated = Exclude<LanguageCode, typeof DEFAULT_LANGUAGE>;

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
  const total = Object.keys(DICTIONARY).length;
  if (language === DEFAULT_LANGUAGE) return { done: total, total };

  const done = Object.values(DICTIONARY).filter((row) => row[language as Translated]).length;
  return { done, total };
}
