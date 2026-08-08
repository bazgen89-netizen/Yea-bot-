import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Column, HeadRow, Row, ToolButton, Toolbar } from '../Table';
import { accountBalances, type AccountBalance } from '../../db/money';
import { formatMoneyWeb } from '../../domain/money';
import { useQuery } from '../../state/DatabaseProvider';
import { web, webText } from '../../ui/webTheme';

// Остаток — то, ради чего сюда заходят: ширины подобраны так, чтобы он
// помещался на экране, а не оказывался за горизонтальной прокруткой.
const COLUMNS: Column[] = [
  { key: 'name', title: 'Счёт', width: 260 },
  { key: 'sales', title: 'С продаж, руб', width: 170, numeric: true },
  { key: 'income', title: 'Приход, руб', width: 150, numeric: true },
  { key: 'expense', title: 'Расход, руб', width: 150, numeric: true },
  { key: 'transfers', title: 'Переводы, руб', width: 170, numeric: true },
  { key: 'balance', title: 'Остаток, руб', width: 170, numeric: true },
];

/**
 * «Компания / счета».
 *
 * Остаток не хранится, а складывается из чеков и денежных документов —
 * ровно как остаток товара складывается из движений.
 */
export function AccountsTable() {
  const router = useRouter();
  const accounts = useQuery((db) => accountBalances(db));
  const total = accounts.reduce((sum, account) => sum + account.balance, 0);

  return (
    <View style={styles.screen}>
      <Toolbar>
        <ToolButton
          label="Приход"
          tone="greenOutline"
          onPress={() => router.push('/money/new?type=income')}
        />
        <ToolButton
          label="Расход"
          tone="orangeOutline"
          onPress={() => router.push('/money/new?type=expense')}
        />
        <ToolButton
          label="Перевод"
          tone="blueOutline"
          onPress={() => router.push('/money/new?type=transfer')}
        />
        <ToolButton label="Движение денег" onPress={() => router.push('/money')} />
      </Toolbar>

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <HeadRow columns={COLUMNS} />

          <ScrollView>
            {accounts.map((account) => (
              <AccountRow key={account.name} account={account} />
            ))}

            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, { width: COLUMNS[0].width }]}>Всего</Text>
              {COLUMNS.slice(1, -1).map((column) => (
                <View key={column.key} style={{ width: column.width }} />
              ))}
              <Text style={[styles.totalValue, { width: COLUMNS[5].width }]}>
                {formatMoneyWeb(total)}
              </Text>
            </View>
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

function AccountRow({ account }: { account: AccountBalance }) {
  const [name, sales, income, expense, transfers, balance] = COLUMNS;
  const net = account.transferIn - account.transferOut;

  return (
    <Row>
      <Text style={[webText.link, { width: name.width }]} numberOfLines={1}>
        {account.name}
      </Text>
      <Text style={[webText.cellNumber, styles.right, { width: sales.width }]}>
        {formatMoneyWeb(account.fromSales)}
      </Text>
      <Text style={[webText.cellNumber, styles.right, { width: income.width }]}>
        {formatMoneyWeb(account.income)}
      </Text>
      <Text style={[webText.cellNumber, styles.right, { width: expense.width }]}>
        {formatMoneyWeb(account.expense)}
      </Text>
      <Text style={[webText.cellNumber, styles.right, { width: transfers.width }]}>
        {net === 0 ? '—' : formatMoneyWeb(net)}
      </Text>
      <Text
        style={[
          webText.cellNumber,
          styles.right,
          styles.bold,
          { width: balance.width },
          account.balance < 0 ? { color: web.danger } : null,
        ]}
      >
        {formatMoneyWeb(account.balance)}
      </Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  right: { textAlign: 'right' },
  bold: { fontWeight: '600' },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 18,
    borderTopWidth: 1,
    borderTopColor: web.border,
  },
  totalLabel: { fontSize: 16, color: web.text },
  totalValue: {
    fontSize: 18,
    color: web.text,
    textAlign: 'right',
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
