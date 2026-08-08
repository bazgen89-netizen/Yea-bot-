import type { SqlDriver } from './driver';

/**
 * Настройки компании.
 *
 * Лежат в `app_state` — той же таблице «ключ — значение», что и отметки о
 * загруженных данных. Заводить под них отдельную таблицу с колонкой на каждое
 * поле значило бы писать миграцию всякий раз, когда в реквизитах появляется
 * ещё одна строка.
 */

export interface CompanySettings {
  /** Основные. */
  name: string;
  phone: string;
  email: string;
  site: string;
  /** Реквизиты. */
  legalName: string;
  inn: string;
  kpp: string;
  address: string;
  bank: string;
  account: string;
  /** Налоги. */
  taxSystem: string;
  vat: string;
  /** Email-отчёт. */
  reportEmail: string;
  reportTime: string;
}

const DEFAULTS: CompanySettings = {
  name: 'WAYSTEA',
  phone: '',
  email: 'waystea@gmail.com',
  site: '',
  legalName: '',
  inn: '',
  kpp: '',
  address: '',
  bank: '',
  account: '',
  taxSystem: 'УСН «Доходы»',
  vat: 'Без НДС',
  reportEmail: 'waystea@gmail.com',
  reportTime: '21:00',
};

const KEY = 'company_settings';

export function getSettings(db: SqlDriver): CompanySettings {
  const row = db.get<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [KEY]);
  if (!row) return DEFAULTS;

  try {
    // Незнакомые поля не мешают, недостающие берутся из умолчаний: настройки
    // переживают обновление приложения, в котором полей стало больше.
    return { ...DEFAULTS, ...(JSON.parse(row.value) as Partial<CompanySettings>) };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(db: SqlDriver, settings: CompanySettings): void {
  db.run(
    `INSERT INTO app_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [KEY, JSON.stringify(settings)],
  );
}

export const TAX_SYSTEMS = [
  'УСН «Доходы»',
  'УСН «Доходы минус расходы»',
  'Патент',
  'ОСНО',
  'НПД',
] as const;

export const VAT_RATES = ['Без НДС', '0 %', '5 %', '7 %', '10 %', '20 %'] as const;
