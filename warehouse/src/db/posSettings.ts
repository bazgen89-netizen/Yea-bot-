import type { SqlDriver } from './driver';

/**
 * Настройки кассы — те, что открывает «Меню → Настройки».
 *
 * Отдельно от настроек компании, и это не мелочь: там сведения об организации,
 * одни для всех, а здесь — как работает **эта** касса. Ширина чековой ленты,
 * порядок товаров на витрине, звук — у каждого рабочего места свои, и
 * складывать их в один объект с ИНН значило бы обещать, что они общие.
 *
 * Хранятся в `app_state` строкой JSON, как и настройки компании: набор полей
 * у такой формы меняется чаще, чем стоит переписывать таблицу.
 */
export interface PosSettings {
  /**
   * Оформление: `auto` — как в системе, `light`, `dark`.
   *
   * Тёмная тема пока не собрана, поэтому выбор запоминается, но применяется
   * только светлое. Показать переключатель, который врёт, было бы хуже, чем
   * не показать его вовсе, — поэтому в окне он подписан «пока только светлое».
   */
  theme: 'auto' | 'light' | 'dark';

  /** Звук при добавлении товара в чек. */
  sound: boolean;

  /** Печатать чек по умолчанию — с этим значением открывается окно оплаты. */
  printByDefault: boolean;
  /** Куда печатать: лист A4 или чековая лента. */
  printer: 'a4' | 'receipt';
  /** Ширина ленты, миллиметры. */
  tapeWidth: number;
  /** Размер шрифта в чеке, миллиметры — так у него, а не в пунктах. */
  tapeFont: number;
  /** Отступ по краям ленты, миллиметры. */
  tapeMargin: number;

  /** Показывать ли на витрине товары, которых нет на остатке. */
  showZeroStocks: boolean;

  /** Чем сортировать витрину. */
  sortBy: 'name' | 'price' | 'changed';
  sortAsc: boolean;
}

export const POS_DEFAULTS: PosSettings = {
  theme: 'light',
  sound: true,

  printByDefault: false,
  printer: 'receipt',
  // 80 мм — самая ходовая лента; 58 бывает у маленьких принтеров.
  tapeWidth: 80,
  tapeFont: 4,
  tapeMargin: 4,

  showZeroStocks: true,

  sortBy: 'name',
  sortAsc: true,
};

const KEY = 'pos_settings';

export function getPosSettings(db: SqlDriver): PosSettings {
  const row = db.get<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [KEY]);
  if (!row) return POS_DEFAULTS;

  try {
    // Незнакомые поля отбрасываются, недостающие берутся из значений по
    // умолчанию: сборка с новым полем не должна спотыкаться о старую запись.
    return { ...POS_DEFAULTS, ...(JSON.parse(row.value) as Partial<PosSettings>) };
  } catch {
    return POS_DEFAULTS;
  }
}

export function savePosSettings(db: SqlDriver, settings: PosSettings): void {
  db.run(
    `INSERT INTO app_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [KEY, JSON.stringify(settings)],
  );
}

/** «Установить настройки по умолчанию» — красная кнопка внизу окна. */
export function resetPosSettings(db: SqlDriver): void {
  savePosSettings(db, POS_DEFAULTS);
}
