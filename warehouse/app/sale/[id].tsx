import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getSale, refundSale, saleSubtotal } from '../../src/db/sales';
import { formatMoneyWithSign } from '../../src/domain/money';
import { formatQtyWithUnit, lineTotal } from '../../src/domain/qty';
import type { PaymentMethod } from '../../src/domain/types';
import { useDatabase, useQuery } from '../../src/state/DatabaseProvider';
import { Badge, Button, Card, Empty, Row } from '../../src/ui/components';
import { colors, spacing, text } from '../../src/ui/theme';

const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Наличные',
  card: 'Карта',
  transfer: 'Перевод',
};

export default function SaleScreen() {
  const router = useRouter();
  const { db, refresh } = useDatabase();
  const { id } = useLocalSearchParams<{ id: string }>();
  const saleId = Number(id);

  const sale = useQuery((database) => getSale(database, saleId), [saleId]);

  if (!sale) {
    return <Empty title="Чек не найден" />;
  }

  const subtotal = saleSubtotal(sale.items);
  const profit = sale.total - sale.cost_total;

  function confirmRefund() {
    Alert.alert(
      'Оформить возврат?',
      'Товар вернётся на склад, а чек перестанет учитываться в выручке.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Вернуть',
          style: 'destructive',
          onPress: () => {
            try {
              refundSale(db, saleId);
              refresh();
            } catch (error) {
              Alert.alert('Не удалось оформить возврат', String(error));
            }
          },
        },
      ],
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <View style={styles.header}>
          <View>
            <Text style={text.title}>Чек №{sale.id}</Text>
            <Text style={text.muted}>
              {new Date(sale.created_at).toLocaleString('ru-RU')} ·{' '}
              {PAYMENT_LABEL[sale.payment]}
            </Text>
          </View>
          {sale.refunded ? <Badge label="Возврат" tone="danger" /> : null}
        </View>
      </Card>

      <Card style={styles.itemsCard}>
        {sale.items.map((item) => (
          <Row
            key={item.id}
            left={
              <>
                <Text style={text.body}>{item.name}</Text>
                <Text style={text.muted}>
                  {formatMoneyWithSign(item.price)} × {formatQtyWithUnit(item.qty, item.unit)}
                </Text>
              </>
            }
            right={<Text style={text.amount}>{formatMoneyWithSign(lineTotal(item.price, item.qty))}</Text>}
          />
        ))}
      </Card>

      <Card>
        <SummaryRow label="Сумма" value={formatMoneyWithSign(subtotal)} />
        {sale.discount > 0 ? (
          <SummaryRow label="Скидка" value={`− ${formatMoneyWithSign(sale.discount)}`} />
        ) : null}
        <SummaryRow label="Оплачено" value={formatMoneyWithSign(sale.total)} big />
        <SummaryRow
          label="Прибыль"
          value={formatMoneyWithSign(profit)}
          tone={profit < 0 ? 'danger' : undefined}
        />
      </Card>

      {sale.refunded ? null : (
        <Button title="Оформить возврат" variant="danger" onPress={confirmRefund} />
      )}
      <Button title="Готово" variant="secondary" onPress={() => router.back()} />
    </ScrollView>
  );
}

function SummaryRow({
  label,
  value,
  big,
  tone,
}: {
  label: string;
  value: string;
  big?: boolean;
  tone?: 'danger';
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={big ? text.heading : text.muted}>{label}</Text>
      <Text style={[big ? text.title : text.mono, tone === 'danger' && { color: colors.danger }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  itemsCard: { padding: 0, overflow: 'hidden' },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
});
