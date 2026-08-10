import { DICTIONARY } from '../dictionary';
import { LANGUAGES, isLanguage, labelFor } from '../languages';
import { coverage, translate, translatePath } from '../translate';

describe('языки', () => {
  it('те же, что в исходном приложении', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['ru', 'en', 'uk', 'az', 'kk', 'ky', 'uz', 'tr']);
    expect(labelFor('kk')).toBe('Қазақ');
  });

  it('чужой код языком не считается', () => {
    expect(isLanguage('ru')).toBe(true);
    expect(isLanguage('de')).toBe(false);
    expect(isLanguage(null)).toBe(false);
  });
});

describe('перевод', () => {
  it('русский отдаётся как есть — это язык ключей', () => {
    expect(translate('Главная', 'ru')).toBe('Главная');
  });

  it('переводит известную строку', () => {
    expect(translate('Главная', 'en')).toBe('Home');
    expect(translate('Клиенты', 'tr')).toBe('Müşteriler');
  });

  it('неизвестную строку отдаёт по-русски, а не пустой', () => {
    expect(translate('Такой строки нет', 'en')).toBe('Такой строки нет');
  });

  it('составной заголовок переводит по частям', () => {
    expect(translatePath('Товары и услуги / справочник', 'en')).toBe(
      'Goods and services / catalogue',
    );
    // Непереведённая часть остаётся русской, а разделитель не теряется.
    expect(translatePath('Компания / чего-то нет', 'en')).toBe('Company / чего-то нет');
  });
});

describe('полнота словаря', () => {
  it('в каждой строке есть все языки, кроме русского', () => {
    const codes = LANGUAGES.map((l) => l.code).filter((code) => code !== 'ru');
    const holes: string[] = [];

    for (const [key, row] of Object.entries(DICTIONARY)) {
      for (const code of codes) {
        if (!(row as Record<string, string | undefined>)[code]) holes.push(`${key} → ${code}`);
      }
    }

    expect(holes).toEqual([]);
  });

  it('считает покрытие', () => {
    const total = Object.keys(DICTIONARY).length;
    expect(coverage('ru')).toEqual({ done: total, total });
    expect(coverage('en')).toEqual({ done: total, total });
  });
});
