/**
 * Языки интерфейса.
 *
 * Список не совпадает с исходным приложением, и это осознанно: у CloudShop
 * там азербайджанский, украинский и турецкий, а нам нужен армянский, которого
 * у него нет. Подписи языков — на самих языках, как принято в переключателях:
 * человек ищет знакомое слово, а не перевод его названия.
 */

export const LANGUAGES = [
  { code: 'ru', label: 'Русский' },
  { code: 'hy', label: 'Հայերեն' },
  { code: 'en', label: 'English' },
  { code: 'kk', label: 'Қазақ' },
  { code: 'ky', label: 'Кыргызча' },
  { code: 'uz', label: "O'zbek" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: LanguageCode = 'ru';

export function isLanguage(value: string | null | undefined): value is LanguageCode {
  return LANGUAGES.some((language) => language.code === value);
}

export function labelFor(code: LanguageCode): string {
  return LANGUAGES.find((language) => language.code === code)?.label ?? code;
}
