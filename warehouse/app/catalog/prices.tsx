import { Stack } from 'expo-router';

import { PriceEditor } from '../../src/web/screens/PriceEditor';

export default function PriceEditorScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Редактор цен' }} />
      <PriceEditor />
    </>
  );
}
