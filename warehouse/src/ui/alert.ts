import { Alert, Platform } from 'react-native';

import { DEFAULT_LANGUAGE, type LanguageCode } from '../i18n/languages';
import { translate } from '../i18n/translate';

/**
 * Сообщения пользователю.
 *
 * На телефоне это системные диалоги React Native. В браузере их нет: `Alert`
 * там ничего не показывает и молча возвращает управление — а значит «не хватает
 * остатка» и «не удалось провести документ» пропадали бы бесследно, и нажатие
 * на кнопку выглядело бы как поломка.
 *
 * Поэтому обращение к пользователю идёт через эти две функции, а не через
 * `Alert` напрямую.
 */

/**
 * Выбранный язык — отдельной переменной.
 *
 * Сообщения показывают не из разметки, а из обработчиков нажатий, где хука
 * `useLanguage` нет. Провайдер языка кладёт сюда выбор, а окна берут его
 * отсюда — иначе диалоги оставались бы русскими при английском интерфейсе.
 */
let current: LanguageCode = DEFAULT_LANGUAGE;

export function setAlertLanguage(language: LanguageCode): void {
  current = language;
}

const t = (text: string) => translate(text, current);

/** Сообщение, на которое нечего ответить, кроме «понятно». */
export function say(title: string, message?: string): void {
  const head = t(title);
  const body = message ? t(message) : undefined;

  if (Platform.OS === 'web') {
    globalThis.alert?.(body ? `${head}\n\n${body}` : head);
    return;
  }
  Alert.alert(head, body);
}

/**
 * Подтверждение необратимого действия: возврата чека, отправки в архив.
 *
 * `onConfirm` вызывается только при согласии. Отказ — это просто ничего.
 */
export function confirm(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void,
): void {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${t(title)}\n\n${t(message)}`)) onConfirm();
    return;
  }

  Alert.alert(t(title), t(message), [
    { text: t('Отмена'), style: 'cancel' },
    { text: t(confirmLabel), style: 'destructive', onPress: onConfirm },
  ]);
}
