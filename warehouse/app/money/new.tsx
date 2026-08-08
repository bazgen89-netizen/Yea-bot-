import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { listLocations } from '../../src/db/locations';
import {
  ACCOUNTS,
  CATEGORIES,
  MONEY_TYPE_LABEL,
  createMoneyDoc,
  type MoneyType,
} from '../../src/db/money';
import { formatMoneyWithSign, parseMoney } from '../../src/domain/money';
import type { Id } from '../../src/domain/types';
import { useDatabase, useQuery } from '../../src/state/DatabaseProvider';
import { Button, Card, Choice, Field } from '../../src/ui/components';
import { colors, spacing, text } from '../../src/ui/theme';
import { say } from '../../src/ui/alert';

/**
 * Приход, расход и перевод — деньги, которые не приносит чек.
 *
 * Один экран на три вида по той же причине, что и у складского документа:
 * различаются они подписью суммы и тем, есть ли второй счёт.
 */

function typeFromParams(value?: string): MoneyType {
  if (value === 'expense' || value === 'transfer') return value;
  return 'income';
}

export default function NewMoneyDocScreen() {
  const router = useRouter();
  const { db, refresh } = useDatabase();
  const params = useLocalSearchParams<{ type?: string }>();

  const type = typeFromParams(params.type);
  const isTransfer = type === 'transfer';

  const locations = useQuery((database) => listLocations(database));
  const shops = locations.map((location) => ({ value: location.id, label: location.name }));
  const accounts = ACCOUNTS.map((name) => ({ value: name, label: name }));
  const categories = CATEGORIES[type].map((name) => ({ value: name, label: name }));

  const [amount, setAmount] = useState('');
  const [account, setAccount] = useState<string>(ACCOUNTS[0]);
  const [accountTo, setAccountTo] = useState<string | null>(null);
  const [category, setCategory] = useState<string>(CATEGORIES[type][0]);
  const [counterparty, setCounterparty] = useState('');
  const [note, setNote] = useState('');
  const [shop, setShop] = useState<Id | null>(null);

  const parsed = parseMoney(amount);
  const locationId = shop ?? (shops.length === 1 ? shops[0].value : null);

  function save() {
    if (parsed === null || parsed <= 0) {
      say('Проверьте сумму', 'Сумма должна быть числом больше нуля.');
      return;
    }

    try {
      createMoneyDoc(db, {
        type,
        amount: parsed,
        account,
        accountTo,
        counterparty,
        category,
        note,
        locationId,
      });
      refresh();
      router.back();
    } catch (error) {
      say('Не удалось сохранить документ', String(error));
    }
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: MONEY_TYPE_LABEL[type] }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card>
          <Field
            label="Сумма"
            value={amount}
            onChangeText={setAmount}
            placeholder="0,00"
            keyboardType="decimal-pad"
            autoFocus
            hint={parsed !== null && parsed > 0 ? formatMoneyWithSign(parsed) : undefined}
          />

          <Choice
            label={isTransfer ? 'Списать со счёта' : 'Счёт'}
            value={account}
            options={accounts}
            onChange={setAccount}
          />

          {isTransfer ? (
            <Choice
              label="Зачислить на счёт"
              value={accountTo}
              options={accounts.filter((option) => option.value !== account)}
              onChange={setAccountTo}
            />
          ) : null}

          {shops.length > 1 ? (
            <Choice label="Магазин" value={locationId} options={shops} onChange={setShop} />
          ) : null}

          <Choice
            label="Категория платежа"
            value={category}
            options={categories}
            onChange={setCategory}
          />

          {isTransfer ? null : (
            <Field
              label="Контрагент"
              value={counterparty}
              onChangeText={setCounterparty}
              placeholder={type === 'income' ? 'От кого' : 'Кому'}
            />
          )}

          <Field
            label="Комментарий"
            value={note}
            onChangeText={setNote}
            placeholder="За что"
          />
        </Card>

        <Text style={text.muted}>
          {isTransfer
            ? 'Перевод не меняет общую сумму денег — он переносит её между счетами.'
            : 'Приход по чеку заводить не нужно: он появляется в движении денег сам.'}
        </Text>
      </ScrollView>

      <View style={styles.panel}>
        <Button title="Сохранить" onPress={save} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  // Ширина ограничена по той же причине, что и у складского документа:
  // поле суммы во всю ширину кабинета читается хуже, а не лучше.
  content: { padding: spacing.md, gap: spacing.md, maxWidth: 720, width: '100%' },
  panel: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
