import { Children, type ReactNode, type Ref } from 'react';
import {
  Text as RnText,
  TextInput as RnTextInput,
  type TextInputProps,
  type TextProps,
} from 'react-native';

import { useLanguage } from '../state/LanguageProvider';

/**
 * `Text` и `TextInput`, которые сами переводят свои подписи.
 *
 * Экранов больше полусотни, надписей — под тысячу. Обернуть каждую в `t('…')`
 * значило бы поставить тысячу скобок и забыть половину: язык переключался бы,
 * а меню кассы оставалось русским — ровно то, на что и жаловались.
 *
 * Поэтому перевод стоит там, где текст попадает на экран. Строка среди детей
 * `Text` — это подпись, её ищем в словаре; всё остальное — числа, суммы,
 * названия товаров — проходит насквозь, потому что незнакомая строка
 * возвращается словарём как есть.
 *
 * Экраны от этого не меняются: они по-прежнему пишут `<Text>Оплата</Text>`, а
 * импорт берут отсюда, а не из `react-native`.
 */

export function Text({ children, ...rest }: TextProps) {
  const { t } = useLanguage();
  return <RnText {...rest}>{walk(children, t)}</RnText>;
}

export function TextInput({
  placeholder,
  ...rest
}: TextInputProps & { ref?: Ref<RnTextInput> }) {
  const { t } = useLanguage();
  return <RnTextInput placeholder={placeholder ? t(placeholder) : placeholder} {...rest} />;
}

/**
 * Экраны держат ссылку на поле — `useRef<TextInput>(null)`, — поэтому имя
 * должно работать и как тип. Интерфейс с тем же именем к функции добавляется:
 * значение и тип живут в разных пространствах имён.
 */
export interface TextInput extends RnTextInput {}

/**
 * Строки среди детей переводятся, узлы — нет.
 *
 * Вложенный `<Text>` переведёт себя сам, когда до него дойдёт очередь
 * отрисовки: спускаться в чужие children отсюда не нужно и нельзя — там могут
 * быть не только буквы.
 */
function walk(node: ReactNode, t: (text: string) => string): ReactNode {
  if (typeof node === 'string') return t(node);
  if (Array.isArray(node)) return Children.map(node, (child) => walk(child, t));
  return node;
}
