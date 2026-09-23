import { Stack } from 'expo-router';

import { ЧатИИ } from '../src/web/AiChat';

/**
 * ИИ-помощник на весь экран.
 *
 * На компьютере он обычно открывается панелью из шапки, а сюда попадают по
 * прямой ссылке. На телефоне это его единственный вид — строкой в «Меню».
 */
export default function AssistantScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'ИИ-помощник' }} />
      <ЧатИИ вид="экран" />
    </>
  );
}
