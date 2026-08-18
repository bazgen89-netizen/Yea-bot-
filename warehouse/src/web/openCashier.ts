/**
 * Касса — отдельным окном.
 *
 * У него «Интерфейс кассира» открывается новым окном браузера, и это не
 * прихоть оформления: за прилавком касса стоит на весь экран, а кабинет
 * остаётся там, где был, — со своим списком товаров и открытым документом.
 * Возврат из кассы — закрыть окно, а не искать, куда делся кабинет.
 *
 * Как окно узнаёт, что открывать кассу: по метке `#cashier` в адресе. Путь
 * менять нельзя — страница может быть открыта файлом с диска, и адрес
 * `…/index.html/cashier` браузер просто не найдёт. Метка же после решётки
 * до сервера не доходит и переживает перезагрузку.
 */

export const CASHIER_HASH = '#cashier';

/**
 * Метку читаем один раз, при загрузке кода, — и запоминаем.
 *
 * Маршрутизатор переписывает адрес, как только берётся за дело, и метка из
 * него пропадает. Спросить её потом — значит спросить поздно.
 */
const CAME_AS_CASHIER = globalThis.location?.hash === CASHIER_HASH;

/** Это окно открыто как касса? */
export function startsInCashier(): boolean {
  return CAME_AS_CASHIER;
}

/**
 * Открыть кассу отдельным окном.
 *
 * Возвращает `false`, если окно открыть не удалось — так бывает, когда
 * браузер считает вызов всплывающим окном. Тогда вызывающий переходит в
 * кассу в этом же окне: лучше не так, как у него, чем никак.
 */
export function openCashierWindow(): boolean {
  const target = globalThis.location?.href;
  if (!target || typeof globalThis.open !== 'function') return false;

  const address = target.split('#')[0] + CASHIER_HASH;

  // Имя окна одно на все нажатия: второй раз откроется то же самое окно, а
  // не третье и четвёртое. Размер — почти весь экран, но не полноэкранный
  // режим: кассиру нужно видеть, что окон два.
  const width = Math.max(1024, Math.round((globalThis.screen?.availWidth ?? 1440) * 0.95));
  const height = Math.max(700, Math.round((globalThis.screen?.availHeight ?? 900) * 0.95));

  const opened = globalThis.open(
    address,
    'wayshop-cashier',
    `popup=yes,width=${width},height=${height},left=0,top=0`,
  );

  if (!opened) return false;

  opened.focus?.();
  return true;
}

/**
 * Страница открыта внутри чужой рамки?
 *
 * Так бывает у показа по ссылке: страница живёт в `iframe` с песочницей, а
 * песочница запрещает открывать окна. Знать это надо не ради красоты — иначе
 * на нажатие «Интерфейс кассира» ничего не происходит, и объяснить, почему,
 * нечем.
 */
export function insideFrame(): boolean {
  try {
    return globalThis.top !== globalThis.self;
  } catch {
    // Доступ к `top` из чужого источника запрещён — значит, рамка чужая.
    return true;
  }
}
