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

/** Кому задаём вопрос. Разные конторы — разный разговор, дело одно. */
export type AskKind = 'claude' | 'openai';

export interface AskSettings {
  kind: AskKind;
  key: string;
  /** Пусто — берётся обычная для этой конторы. */
  model: string;
}

const KEY = 'assistant';

const ПО_УМОЛЧАНИЮ: Record<AskKind, { url: string; model: string }> = {
  claude: { url: 'https://api.anthropic.com/v1/messages', model: 'claude-opus-5' },
  openai: { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' },
};

export function getAskSettings(db: SqlDriver): AskSettings {
  const row = db.get<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [KEY]);
  if (!row) return { kind: 'claude', key: '', model: '' };

  try {
    const saved = JSON.parse(row.value) as Partial<AskSettings>;
    return {
      kind: saved.kind === 'openai' ? 'openai' : 'claude',
      key: typeof saved.key === 'string' ? saved.key : '',
      model: typeof saved.model === 'string' ? saved.model : '',
    };
  } catch {
    return { kind: 'claude', key: '', model: '' };
  }
}

export function saveAskSettings(db: SqlDriver, settings: AskSettings): void {
  db.run(
    `INSERT INTO app_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [KEY, JSON.stringify(settings)],
  );
}

/** Адрес и название модели: своё, если задано, иначе обычное для конторы. */
export function askTarget(settings: AskSettings): { url: string; model: string } {
  const обычное = ПО_УМОЛЧАНИЮ[settings.kind];
  return { url: обычное.url, model: settings.model.trim() || обычное.model };
}

/** Как эту контору зовут по-человечески — для подписей на экране. */
export const ASK_NAMES: Record<AskKind, string> = {
  claude: 'Клод (Anthropic)',
  openai: 'ДипСик',
};
