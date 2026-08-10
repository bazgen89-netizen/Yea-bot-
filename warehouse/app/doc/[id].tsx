import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { cancelDoc, getDoc } from '../../src/db/stock';
import { formatMoneyWithSign } from '../../src/domain/money';
import { formatQtyWithUnit } from '../../src/domain/qty';
import { pluralize } from '../../src/domain/plural';
import { DOC_KIND_LABEL, docKind } from '../../src/domain/types';
import { useDatabase, useQuery } from '../../src/state/DatabaseProvider';
import { Button, Card, Empty, Row } from '../../src/ui/components';
import { colors, spacing, text } from '../../src/ui/theme';
import { confirm, say } from '../../src/ui/alert';

/**
 * Просмотр складского документа.
 *
 * До сих пор в журнал можно было смотреть, но не заглянуть внутрь: строка
 * знала сумму и число позиций, а какие это позиции — нет. Между тем именно
 * за этим в журнал и заходят: «откуда взялась закупка на сорок тысяч».
 */
export default function DocScreen() {
  const router = useRouter();
  const { db, refresh } = useDatabase();
  const { id } = useLocalSearchParams<{ id: string }>();
  const docId = Number(id);

  const doc = useQuery((database) => getDoc(database, docId), [docId]);

  if (!doc) {
    return <Empty title="Документ не найден" hint="Возможно, его отменили" />;
  }

  const kind = docKind(doc);
  const title = DOC_KIND_LABEL[kind];

  function confirmCancel() {
    confirm(
      'Отменить документ?',
      'Товар вернётся к тому остатку, который был до него. Отменённый документ исчезнет из журнала.',
      'Отменить документ',
      () => {
        try {
          cancelDoc(db, docId);
          refresh();
          router.back();
        } catch (error) {
          say('Не удалось отменить', String(error));
        }
      },
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: `${title} №${doc.id}` }} />

      <Card>
        <Text style={text.title}>
          {title} №{doc.id}
        </Text>
        <Text style={text.muted}>{new Date(doc.created_at).toLocaleString('ru-RU')}</Text>

        {doc.counterparty ? <Line label="Контрагент" value={doc.counterparty} /> : null}
        {doc.location_name ? (
          <Line
            label={kind === 'transfer' ? 'Откуда' : 'Магазин'}
            value={doc.location_name}
          />
        ) : null}
        {doc.location_to_name ? <Line label="Куда" value={doc.location_to_name} /> : null}
        {doc.note ? <Line label="Комментарий" value={doc.note} /> : null}
      </Card>

      <Card style={styles.lines}>
        <Text style={[text.heading, styles.linesTitle]}>
          {pluralize(doc.positions_list.length, 'позиция', 'позиции', 'позиций')}
        </Text>

        {doc.positions_list.map((position) => (
          <Row
            key={position.product_id}
            onPress={() =>
              router.push({
                pathname: '/product/[id]',
                params: { id: String(position.product_id) },
              })
            }
            left={
              <>
                <Text style={text.body}>{position.name}</Text>
                <Text style={text.muted}>
                  {formatQtyWithUnit(position.qty, position.unit)} ×{' '}
                  {formatMoneyWithSign(position.price)}
                </Text>
              </>
            }
            right={<Text style={text.amount}>{formatMoneyWithSign(position.sum)}</Text>}
          />
        ))}

        {doc.positions_list.length === 0 ? (
          <Text style={[text.muted, styles.empty]}>
            Позиций нет — документ только выравнивал остаток
          </Text>
        ) : null}

        <View style={styles.total}>
          <Text style={text.heading}>Итого</Text>
          <Text style={text.title}>{formatMoneyWithSign(doc.amount)}</Text>
        </View>
      </Card>

      <Button title="Отменить документ" variant="danger" onPress={confirmCancel} />
    </ScrollView>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={text.muted}>{label}</Text>
      <Text style={text.body}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  lines: { padding: 0, paddingTop: spacing.lg, overflow: 'hidden' },
  linesTitle: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  empty: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  total: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
