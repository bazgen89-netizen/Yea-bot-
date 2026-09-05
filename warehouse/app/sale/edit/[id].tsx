import { Stack, useLocalSearchParams } from 'expo-router';

import { SaleEdit } from '../../../src/web/screens/SaleEdit';

/**
 * Правка чека — отдельной страницей, как у него: адрес
 * `card/doc/show/<id>`, заголовок «Документы / редактирование документа».
 *
 * Это не просмотр с полями вместо текста: у него это другой экран, со своей
 * полосой действий, переключателем «Документ проведён» и таблицей на
 * двенадцать колонок.
 */
export default function SaleEditScreen() {
  const params = useLocalSearchParams<{ id: string }>();

  return (
    <>
      <Stack.Screen options={{ title: 'Документы / редактирование документа' }} />
      <SaleEdit id={Number(params.id)} />
    </>
  );
}
