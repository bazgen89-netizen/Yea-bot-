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
  /**
   * Телефоны и почты списками, а не по одному: у него под каждым полем
   * ссылка «добавить еще», и у компании с двумя точками телефонов два.
   */
  phones: string[];
  emails: string[];
  site: string;
  /**
   * Префикс штрихкода весового товара — две цифры, с которых начинается
   * штрихкод, напечатанный весами. По нему касса понимает, что в коде зашит
   * вес, а не количество.
   */
  pluPrefix: string;

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

  /**
   * Лояльность: бонусная программа.
   *
   * Все три ставки — проценты в сотых долях (500 = 5 %), потому что у него
   * это три поля с приписком «%», а не пары чисел. Подпись под полем
   * пересказывает ставку словами — «Каждые 100,00 в чеке = 5 бонусов на
   * счет», — но само значение одно.
   */
  bonusOn: boolean;
  /** Курс начисления: сколько процентов чека возвращается бонусами. */
  cashbackRateBp: number;
  /** Курс списания: сколько рублей скидки даёт один бонус, в процентах. */
  redemptionRateBp: number;
  /** Каким процентом чека можно платить бонусами. */
  bonusLimitBp: number;
  /** Бонусы новому покупателю и в день рождения — штуки, не деньги. */
  bonusStart: number;
  bonusBirthday: number;

  /**
   * Продажа товаров: разрешить продавать в минус.
   *
   * Обычно чек не проводится, если товара на складе меньше, чем в нём: это
   * защита от опечатки в количестве. Но остаток врёт чаще, чем кажется —
   * приход не успели провести, пересортица, товар лежит на прилавке, а в
   * программе его уже нет. Отказ в такую минуту означает очередь у кассы
   * и покупателя без покупки.
   *
   * Поэтому это настройка, а не правило: включили — касса проводит чек,
   * остаток уходит в минус и сам собой чинится, когда проведут приход.
   * Так же это устроено и у них: `ALLOW_NEGATIVE_SALES`.
   */
  negativeSale: boolean;

  /** Лояльность: скидки. */
  presetDiscounts: number[];
  discountRules: DiscountRule[];

  /** Интернет-витрина. */
  storefront: Storefront;
}

/**
 * Настройки интернет-витрины — четыре его вкладки одним объектом.
 *
 * Отдельной таблицей их держать не за чем: витрина одна на компанию, и все
 * её поля читаются и сохраняются вместе.
 */
export interface Storefront {
  /** Включена ли витрина. */
  on: boolean;

  /** Домен: поддомен у нас и свой домен. */
  subdomain: string;
  domain: string;

  /** Товары: из какого магазина, что делать с нулевыми остатками. */
  storeId: number | null;
  /** hide — прятать, show — показывать, order — показывать под заказ. */
  zeroStocks: 'hide' | 'show' | 'order';
  /** Категории, которые видны на витрине; пусто — все. */
  categories: string[];

  /** О магазине. */
  title: string;
  description: string;
  about: string;
  email: string;
  phone: string;
  address: string;

  /** Аналитика: счётчики и подтверждения. */
  ym: string;
  ga: string;
  ywm: string;
  gwm: string;
}

const DEFAULTS: CompanySettings = {
  name: 'WAYSTEA',
  country: 'Россия',
  currency: 'RUB',
  currencyView: 'руб',
  phones: [''],
  emails: ['waystea@gmail.com'],
  site: '',
  pluPrefix: '22',

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
  cashbackRateBp: 0,
  redemptionRateBp: 10000,
  bonusLimitBp: 0,
  bonusStart: 0,
  bonusBirthday: 0,

  negativeSale: false,

  presetDiscounts: [],
  discountRules: [],

  storefront: {
    on: false,
    subdomain: '',
    domain: '',
    storeId: null,
    zeroStocks: 'hide',
    categories: [],
    title: 'WAYSTEA',
    description: '',
    about: '',
    email: 'waystea@gmail.com',
    phone: '',
    address: '',
    ym: '',
    ga: '',
    ywm: '',
    gwm: '',
  },
};

const KEY = 'company_settings';

export function getSettings(db: SqlDriver): CompanySettings {
  const row = db.get<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [KEY]);
  if (!row) return DEFAULTS;

  try {
    // Незнакомые поля не мешают, недостающие берутся из умолчаний: настройки
    // переживают обновление приложения, в котором полей стало больше.
    const saved = JSON.parse(row.value) as Partial<CompanySettings>;
    // Вложенный объект надо слить отдельно: одним `...` он заменился бы
    // целиком, и у того, кто сохранился до появления новых полей витрины,
    // они оказались бы undefined.
    return {
      ...DEFAULTS,
      ...saved,
      storefront: { ...DEFAULTS.storefront, ...(saved.storefront ?? {}) },
    };
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
