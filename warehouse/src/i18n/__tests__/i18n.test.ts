import { DICTIONARY } from '../dictionary';
import { POS_DICTIONARY } from '../posDictionary';
import { LANGUAGES, isLanguage, labelFor } from '../languages';
import { coverage, translate, translatePath } from '../translate';

describe('языки', () => {
  it('свой набор: армянский вместо турецкого, азербайджанского и украинского', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['ru', 'hy', 'en', 'kk', 'ky', 'uz']);
    expect(labelFor('kk')).toBe('Қазақ');
    expect(labelFor('hy')).toBe('Հայերեն');
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
    expect(translate('Клиенты', 'hy')).toBe('Հաճախորդներ');
  });

  it('неизвестную строку отдаёт по-русски, а не пустой', () => {
    expect(translate('Такой строки нет', 'en')).toBe('Такой строки нет');
  });

  it('не спотыкается о регистр и знак в конце', () => {
    // Одна и та же подпись встречается кнопкой заглавными и заголовком с
    // двоеточием — словарь на это заводить по три статьи не приходится.
    expect(translate('ВОЗВРАТ', 'en')).toBe('REFUND');
    expect(translate('Возврат:', 'en')).toBe('Refund:');
  });

  it('не съедает пробелы по краям', () => {
    // Цена набрана двумя кусками: «1 300,00» и « руб».
    expect(translate(' руб', 'en')).toBe(' RUB');
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

  it('в словаре кассы всегда есть английский', () => {
    const holes = Object.entries(POS_DICTIONARY)
      .filter(([, row]) => !row.en)
      .map(([key]) => key);

    expect(holes).toEqual([]);
  });

  it('считает покрытие по обоим словарям', () => {
    const total = Object.keys({ ...POS_DICTIONARY, ...DICTIONARY }).length;

    expect(coverage('ru')).toEqual({ done: total, total });
    // Английский полон, остальные языки — насколько хватило сверки с
    // CloudShop: наши собственные фразы там переведены не все.
    expect(coverage('en')).toEqual({ done: total, total });
    expect(coverage('hy').done).toBeGreaterThan(total * 0.8);
  });
});
