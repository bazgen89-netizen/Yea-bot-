import { Stack, useLocalSearchParams } from 'expo-router';

import { MoneyDocument } from '../../../src/web/screens/MoneyDocument';

/**
 * Денежный документ — страницей, как у него: `card/money/show/<id>`.
 *
 * Отдельного «просмотра» у него нет: страница документа — она же и форма,
 * поэтому и здесь всё правится на месте.
 */
export default function MoneyDocumentScreen() {
  const params = useLocalSearchParams<{ id: string; source?: string }>();

  return (
    <>
      <Stack.Screen options={{ title: 'Просмотр ордера' }} />
      <MoneyDocument
        id={Number(params.id)}
        source={params.source === 'sale' ? 'sale' : 'doc'}
      />
    </>
  );
}
