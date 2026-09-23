import { useSyncExternalStore } from 'react';

/**
 * Открыт ли чат с ИИ.
 *
 * Чат — не страница, а панель поверх любой страницы: Вазген попросил «не
 * отдельную страницу, а чат». Открывает его кнопка в шапке, а рисует оболочка
 * кабинета — это два разных места, и связать их проще всего общим флажком.
 */
let открыт = false;
const слушатели = new Set<() => void>();

function сообщить() {
  for (const один of слушатели) один();
}

export function открытьЧат(): void {
  открыт = true;
  сообщить();
}

export function закрытьЧат(): void {
  открыт = false;
  сообщить();
}

export function переключитьЧат(): void {
  открыт = !открыт;
  сообщить();
}

export function useЧатОткрыт(): boolean {
  return useSyncExternalStore(
    (слушать) => {
      слушатели.add(слушать);
      return () => слушатели.delete(слушать);
    },
    () => открыт,
    () => false,
  );
}
