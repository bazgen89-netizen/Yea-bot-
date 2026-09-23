import { useEffect } from 'react';

/**
 * Клавиши окон кассы: Enter соглашается, Esc закрывает, цифра выбирает пункт.
 *
 * Слушаем **на перехвате**, а не на всплытии. Кнопка, которой окно только что
 * открыли, остаётся в фокусе, и её собственный обработчик клавиш гасит событие
 * по дороге наверх — до окна оно уже не доходит. Из-за этого Enter в «Открытии
 * смены» молча ничего не делал, если окно открыли мышью: кассир видел подпись
 * ENTER на кнопке и нажимал в пустоту.
 *
 * Подписка снимается и ставится заново на каждой отрисовке — намеренно: внутри
 * обработчика лежат сегодняшние значения полей, а не те, что были при открытии.
 */
export function useCashierKeys(active: boolean, onKey: (event: KeyboardEvent) => void): void {
  useEffect(() => {
    if (!active) return;

    const handler = (event: KeyboardEvent) => onKey(event);
    globalThis.addEventListener?.('keydown', handler, true);
    return () => globalThis.removeEventListener?.('keydown', handler, true);
  });
}
