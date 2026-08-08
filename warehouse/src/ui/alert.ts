import { Alert, Platform } from 'react-native';

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

/** Сообщение, на которое нечего ответить, кроме «понятно». */
export function say(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    globalThis.alert?.(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
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
    if (globalThis.confirm?.(`${title}\n\n${message}`)) onConfirm();
    return;
  }

  Alert.alert(title, message, [
    { text: 'Отмена', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
