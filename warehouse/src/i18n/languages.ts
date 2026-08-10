/**
 * Языки интерфейса.
 *
 * Список и подписи — те же, что в исходном приложении: они лежат в его
 * собранном коде открытым текстом (`translateService.languages`), поэтому
 * ничего не пришлось выдумывать. Порядок тоже его.
 */

export const LANGUAGES = [
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
  { code: 'uk', label: 'Українська' },
  { code: 'az', label: 'Azərbaycan' },
  { code: 'kk', label: 'Қазақ' },
  { code: 'ky', label: 'Кыргызча' },
  { code: 'uz', label: "O'zbek" },
  { code: 'tr', label: 'Türkçe' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: LanguageCode = 'ru';

export function isLanguage(value: string | null | undefined): value is LanguageCode {
  return LANGUAGES.some((language) => language.code === value);
}

export function labelFor(code: LanguageCode): string {
  return LANGUAGES.find((language) => language.code === code)?.label ?? code;
}
