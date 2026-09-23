import type { SqlDriver } from './driver';

/**
 * Чем отвечает помощник на этом устройстве.
 *
 * Два способа, и они не заменяют друг друга:
 *
 *   • **свой ключ** — вопрос уходит к модели прямо отсюда, минуя чей-либо
 *     сервер. Годится, когда программа стоит у себя и ключ свой: ничего
 *     поднимать не надо, работает сразу;
 *   • **через сервер магазина** — ключ лежит на сервере, и магазины,
 *     работающие по подписке, своего ключа не покупают вовсе.
 *
 * Ключ хранится в базе устройства, а не в файле программы. Разница важная:
 * файл Wayshop можно переслать кому угодно, и ключа в нём не будет — он
 * остаётся в браузере того, кто его вписал. Наружу он уходит только к самой
 * модели, и никуда больше.
 */

/**
 * Кому задаём вопрос. Разные конторы — разный разговор, дело одно.
 *
 * Сперва их было две — Клод и ДипСик, и ДипСик звался здесь `openai`: он
 * говорит на том же языке запросов, что и OpenAI. Вазген попросил добавить
 * GPT и Gemini — и имя `openai` для ДипСика стало путать, потому что теперь
 * есть и настоящий OpenAI. Сохранённое раньше `openai` читается как ДипСик:
 * у кого он был выбран, у того он и останется.
 */
export type AskKind = 'gemini' | 'deepseek' | 'gpt';

/**
 * Порядок на экране: Gemini первым и по умолчанию.
 *
 * Клода здесь больше нет — Вазген убрал: «это платная версия у нас, а там
 * будут люди пользоваться, надо бесплатную». Из троих оставшихся по-настоящему
 * бесплатный только Gemini: ключ Google AI Studio даёт вопросы даром, с
 * ограничением по числу в минуту. ДипСик платный, но стоит копейки; GPT
 * платный. Кто выбрал Клода раньше, откроет чат уже с Gemini.
 */
export const ASK_KINDS: AskKind[] = ['gemini', 'deepseek', 'gpt'];

export interface AskSettings {
  kind: AskKind;
  key: string;
  /** Пусто — берётся обычная для этой конторы. */
  model: string;
}

const KEY = 'assistant';

/*
 * Модели по умолчанию — сверены с их документацией в сентябре 2026, а не
 * взяты из памяти: у OpenAI сейчас `gpt-6-astra` / `gpt-6-sol` / `gpt-6-luna`
 * (берём среднюю — по уму и цене), у Gemini в примере совместимого адреса
 * стоит `gemini-3.8-flash`. Поле «Модель» на экране позволяет вписать любую.
 *
 * Gemini отвечает по тому же языку запросов, что OpenAI, — на отдельном
 * адресе `…/v1beta/openai/`. Поэтому все трое, кроме Клода, идут одной
 * дорогой, и различаются только адресом.
 */
const ПО_УМОЛЧАНИЮ: Record<AskKind, { url: string; model: string }> = {
  gpt: { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-6-sol' },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: 'gemini-3.8-flash',
  },
  deepseek: { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
};

/**
 * Прочесть сохранённое. Старое `openai` — это ДипСик; Клод убран, и кто его
 * выбирал — получает Gemini, а не поломку.
 */
function видИз(saved: unknown): AskKind {
  if (saved === 'openai') return 'deepseek';
  return ASK_KINDS.includes(saved as AskKind) ? (saved as AskKind) : 'gemini';
}

/**
 * Как настройки лежат в базе.
 *
 * Ключ и модель — у каждой конторы свои. Пока контора была одна, хватало
 * одного ключа; теперь их три, и переключаются они в чате одной кнопкой. С
 * общим ключом переключение отправило бы ключ Gemini в ДипСик — и человек
 * получил бы «модель не приняла ключ», не поняв почему.
 *
 * Прежняя запись вида `{ kind, key, model }` читается как ключ той конторы,
 * что была выбрана: вписанное раньше не теряется.
 */
interface Хранится {
  kind: AskKind;
  keys: Partial<Record<AskKind, string>>;
  models: Partial<Record<AskKind, string>>;
}

function прочесть(db: SqlDriver): Хранится {
  const row = db.get<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [KEY]);
  const пусто: Хранится = { kind: 'gemini', keys: {}, models: {} };
  if (!row) return пусто;

  try {
    const saved = JSON.parse(row.value) as Record<string, unknown>;
    const kind = видИз(saved.kind);

    // Прежний вид — один ключ на всё.
    if (!saved.keys || typeof saved.keys !== 'object') {
      return {
        kind,
        keys: typeof saved.key === 'string' && saved.key ? { [kind]: saved.key } : {},
        models: typeof saved.model === 'string' && saved.model ? { [kind]: saved.model } : {},
      };
    }

    return {
      kind,
      keys: saved.keys as Хранится['keys'],
      models: (saved.models ?? {}) as Хранится['models'],
    };
  } catch {
    return пусто;
  }
}

function записать(db: SqlDriver, что: Хранится): void {
  db.run(
    `INSERT INTO app_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [KEY, JSON.stringify(что)],
  );
}

export function getAskSettings(db: SqlDriver): AskSettings {
  const { kind, keys, models } = прочесть(db);
  return { kind, key: keys[kind] ?? '', model: models[kind] ?? '' };
}

/** Сохранить ключ и модель выбранной конторы и сделать её текущей. */
export function saveAskSettings(db: SqlDriver, settings: AskSettings): void {
  const было = прочесть(db);
  записать(db, {
    kind: settings.kind,
    keys: { ...было.keys, [settings.kind]: settings.key },
    models: { ...было.models, [settings.kind]: settings.model },
  });
}

/** Переключиться на другую контору, не трогая ключей. */
export function chooseAskKind(db: SqlDriver, kind: AskKind): void {
  const было = прочесть(db);
  записать(db, { ...было, kind });
}

/** Есть ли ключ у этой конторы — чтобы на кнопке было видно, готова ли она. */
export function hasAskKey(db: SqlDriver, kind: AskKind): boolean {
  return Boolean(прочесть(db).keys[kind]?.trim());
}

/** Адрес и название модели: своё, если задано, иначе обычное для конторы. */
export function askTarget(settings: AskSettings): { url: string; model: string } {
  const обычное = ПО_УМОЛЧАНИЮ[settings.kind];
  return { url: обычное.url, model: settings.model.trim() || обычное.model };
}

/** Как эту контору зовут по-человечески — для подписей на экране. */
export const ASK_NAMES: Record<AskKind, string> = {
  gpt: 'ChatGPT',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
};

/** Где взять ключ — ссылкой, чтобы не искать. */
export const ASK_KEY_PAGE: Record<AskKind, string> = {
  gpt: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/app/apikey',
  deepseek: 'https://platform.deepseek.com/api_keys',
};

/** Как выглядит начало ключа — подсказкой в пустом поле. */
export const ASK_KEY_HINT: Record<AskKind, string> = {
  gpt: 'sk-…',
  gemini: 'AIza…',
  deepseek: 'sk-…',
};

/** Модель по умолчанию — подсказкой в поле «Модель». */
export function askDefaultModel(kind: AskKind): string {
  return ПО_УМОЛЧАНИЮ[kind].model;
}
