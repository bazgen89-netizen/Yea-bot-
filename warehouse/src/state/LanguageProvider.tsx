import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { DEFAULT_LANGUAGE, isLanguage, type LanguageCode } from '../i18n/languages';
import { translate, translatePath } from '../i18n/translate';
import { useDatabase } from './DatabaseProvider';

/**
 * Выбранный язык интерфейса.
 *
 * Хранится в `app_state`, а не в localStorage: то же приложение работает на
 * телефоне, где localStorage нет, а база есть на обеих половинах. Заодно выбор
 * попадает в резервную копию вместе со всем остальным.
 */

interface LanguageValue {
  language: LanguageCode;
  setLanguage: (code: LanguageCode) => void;
  /** Перевод строки. */
  t: (text: string) => string;
  /** Перевод составного заголовка «Раздел / подраздел». */
  tp: (text: string) => string;
}

const KEY = 'language';

const LanguageContext = createContext<LanguageValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { db } = useDatabase();

  const [language, setState] = useState<LanguageCode>(() => {
    const row = db.get<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [KEY]);
    return isLanguage(row?.value) ? row.value : DEFAULT_LANGUAGE;
  });

  const setLanguage = useCallback(
    (code: LanguageCode) => {
      db.run(
        `INSERT INTO app_state (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [KEY, code],
      );
      setState(code);
    },
    [db],
  );

  const value = useMemo<LanguageValue>(
    () => ({
      language,
      setLanguage,
      t: (text) => translate(text, language),
      tp: (text) => translatePath(text, language),
    }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage вызван вне LanguageProvider');
  return value;
}
