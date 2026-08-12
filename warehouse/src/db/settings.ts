import type { SqlDriver } from './driver';

/**
 * Настройки компании.
 *
 * Лежат в `app_state` — той же таблице «ключ — значение», что и отметки о
 * загруженных данных. Заводить под них отдельную таблицу с колонкой на каждое
 * поле значило бы писать миграцию всякий раз, когда в реквизитах появляется
 * ещё одна строка.
 */

/** Строка реквизита: «ИНН → 5702001741». */
export interface Requisite {
  key: string;
  value: string;
}

/** Налог компании: как он называется, его код и ставка. */
export interface Tax {
  name: string;
  code: string;
  /** Ставка в сотых долях процента: 2000 = 20 %. */
  rate_bp: number;
}

/**
 * Правило накопительной скидки: с какой суммы покупок какая скидка.
 * Обе величины целые — сумма в копейках, скидка в сотых долях процента.
 */
export interface DiscountRule {
  from: number;
  discount_bp: number;
}

export interface CompanySettings {
  /** Настройки компании. */
  name: string;
  country: string;
  currency: string;
  /** Как показывать валюту: «руб», «₽», «RUB». */
  currencyView: string;
  phone: string;
  email: string;
  site: string;

  /**
   * Реквизиты.
   *
   * Часть полей отдельными строками, часть — списком «название → номер».
   * Список нужен потому, что набор реквизитов у разных форм собственности
   * разный: у ИП нет КПП, у бюджетников есть ОКТМО и КБК. Фиксировать их
   * колонками значило бы переписывать экран под каждую новую строку.
   */
  legalName: string;
  legalFullName: string;
  legalAddress: string;
  actualAddress: string;
  taxNumber: string;
  requisites: Requisite[];
  directorTitle: string;
  directorName: string;
  accountantName: string;
  vatPayer: boolean;

  /** Налоги — список, как у него, а не одна ставка на всю компанию. */
  taxes: Tax[];
  /** Система налогообложения по умолчанию и ставка для новых товаров. */
  taxSystem: string;
  vat: string;

  /** Email-отчёт. */
  reportOn: boolean;
  reportEmail: string;
  reportTime: string;
  timezone: string;

  /** Лояльность: бонусная программа. */
  bonusOn: boolean;
  /** Курс начисления: сколько рублей чека дают сколько бонусов. */
  bonusPerRubles: number;
  bonusEarned: number;
  /** Курс списания: сколько бонусов равны скольким рублям скидки. */
  bonusSpend: number;
  bonusSpendRubles: number;
  /** Каким процентом чека можно платить бонусами. */
  bonusLimitBp: number;
  /** Бонусы новому покупателю и в день рождения, копейки. */
  bonusStart: number;
  bonusBirthday: number;

  /** Лояльность: скидки. */
  presetDiscounts: number[];
  discountRules: DiscountRule[];
}

const DEFAULTS: CompanySettings = {
  name: 'WAYSTEA',
  country: 'Россия',
  currency: 'RUB',
  currencyView: 'руб',
  phone: '',
  email: 'waystea@gmail.com',
  site: '',

  legalName: '',
  legalFullName: '',
  legalAddress: '',
  actualAddress: '',
  taxNumber: '',
  requisites: [],
  directorTitle: '',
  directorName: '',
  accountantName: '',
  vatPayer: false,

  taxes: [],
  taxSystem: 'УСН «Доходы»',
  vat: 'Без НДС',

  reportOn: false,
  reportEmail: 'waystea@gmail.com',
  reportTime: '21:00',
  timezone: 'Europe/Moscow',

  bonusOn: false,
  // «Каждые 100 ₽ в чеке = 1 бонус на счет» — их формулировка и их же
  // значения по умолчанию.
  bonusPerRubles: 100,
  bonusEarned: 1,
  bonusSpend: 1,
  bonusSpendRubles: 1,
  bonusLimitBp: 5000,
  bonusStart: 0,
  bonusBirthday: 0,

  presetDiscounts: [],
  discountRules: [],
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
