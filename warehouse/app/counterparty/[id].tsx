import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  archiveCounterparty,
  createCounterparty,
  formatPhone,
  getCounterparty,
  updateCounterparty,
  type PartyInput,
} from '../../src/db/counterparties';
import { formatMoney } from '../../src/domain/money';
import { pluralize } from '../../src/domain/plural';
import type { PartyKind } from '../../src/domain/types';
import { useDatabase, useQuery } from '../../src/state/DatabaseProvider';
import { Button, Card, Field, Stat } from '../../src/ui/components';
import { MenuIcon } from '../../src/ui/icons';
import { colors, radius, spacing, text } from '../../src/ui/theme';
import { confirm, say } from '../../src/ui/alert';

const KIND_LABEL: Record<PartyKind, string> = {
  customer: 'Клиент',
  supplier: 'Поставщик',
  both: 'Клиент и поставщик',
};

export default function CounterpartyScreen() {
  const router = useRouter();
  const { db, refresh } = useDatabase();
  const params = useLocalSearchParams<{ id: string; kind?: string }>();

  const isNew = params.id === 'new';
  const partyId = isNew ? null : Number(params.id);

  const party = useQuery(
    (database) => (partyId ? getCounterparty(database, partyId) : null),
    [partyId],
  );

  const [kind, setKind] = useState<PartyKind>(
    party?.kind ?? (params.kind === 'supplier' ? 'supplier' : 'customer'),
  );
  const [name, setName] = useState(party?.name ?? '');
  const [phone, setPhone] = useState(party?.phone ?? '');
  const [email, setEmail] = useState(party?.email ?? '');
  const [note, setNote] = useState(party?.note ?? '');
  const [discount, setDiscount] = useState(
    party?.discount_bp ? String(party.discount_bp / 100) : '',
  );

  function save() {
    if (!name.trim()) {
      say('Нужно имя', 'Без имени карточку не сохранить.');
      return;
    }

    // Скидка вводится в процентах, а хранится в сотых долях процента —
    // чтобы «12,5 %» не превращалось в число с плавающей точкой.
    const percent = discount.trim() ? Number(discount.replace(',', '.')) : 0;
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      say('Проверьте скидку', 'Скидка — число от 0 до 100.');
      return;
    }

    const input: PartyInput = {
      kind,
      name,
      phone,
      email,
      note,
      discount_bp: Math.round(percent * 100),
    };

    if (partyId) updateCounterparty(db, partyId, input);
    else createCounterparty(db, input);

    refresh();
    router.back();
  }

  function remove() {
    if (!partyId) return;

    confirm(
      'Убрать из справочника?',
      'Карточка скроется из списка. История покупок сохранится.',
      'Убрать',
      () => {
        archiveCounterparty(db, partyId);
        refresh();
        router.back();
      },
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: isNew ? 'Новая карточка' : name || 'Карточка' }} />

      {party ? (
        <Card style={styles.summary}>
          <View style={styles.summaryHead}>
            <View style={styles.avatar}>
              <Text style={styles.avatarLetter}>
                {party.name.trim().slice(0, 1).toUpperCase() || '?'}
              </Text>
            </View>
            <View style={styles.summaryTitles}>
              <Text style={text.heading} numberOfLines={2}>
                {party.name}
              </Text>
              <Text style={text.muted}>{KIND_LABEL[party.kind]}</Text>
            </View>

            {party.phone ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Позвонить"
                onPress={() => void Linking.openURL(`tel:${party.phone}`)}
                hitSlop={8}
                style={({ pressed }) => [styles.call, pressed && { opacity: 0.6 }]}
              >
                <MenuIcon.call color={colors.accent} />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.stats}>
            <Stat label="Покупок" value={formatMoney(party.purchases) + ' руб'} />
            <Stat label="Чеков" value={String(party.receipts)} />
          </View>

          {party.last_sale_at ? (
            <Text style={text.muted}>
              Последняя покупка: {party.last_sale_at.slice(0, 10).split('-').reverse().join('.')}
            </Text>
          ) : (
            <Text style={text.muted}>Покупок ещё не было</Text>
          )}
        </Card>
      ) : null}

      <Card>
        <Text style={[text.block, styles.blockTitle]}>Основное</Text>

        <View style={styles.kinds}>
          {(Object.keys(KIND_LABEL) as PartyKind[]).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: kind === value }}
              onPress={() => setKind(value)}
              style={({ pressed }) => [
                styles.kind,
                kind === value && styles.kindActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.kindLabel, kind === value && styles.kindLabelActive]}>
                {KIND_LABEL[value]}
              </Text>
            </Pressable>
          ))}
        </View>

        <Field label="Имя" value={name} onChangeText={setName} placeholder="Иван Петров" />
        <Field
          label="Телефон"
          value={phone}
          onChangeText={setPhone}
          placeholder="+7 (999) 123-45-67"
          keyboardType="phone-pad"
          hint={phone.trim() ? formatPhone(phone) : undefined}
        />
        <Field
          label="Почта"
          value={email}
          onChangeText={setEmail}
          placeholder="mail@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Field
          label="Личная скидка, %"
          value={discount}
          onChangeText={setDiscount}
          placeholder="0"
          keyboardType="decimal-pad"
        />
        <Field
          label="Заметка"
          value={note}
          onChangeText={setNote}
          placeholder="Что важно помнить"
          multiline
        />

        <Button title="Сохранить" onPress={save} />
      </Card>

      {party ? (
        <Card>
          <Text style={[text.block, styles.blockTitle]}>Ещё</Text>
          <Text style={[text.muted, styles.hint]}>
            {pluralize(party.receipts, 'чек', 'чека', 'чеков')} привязано к этой карточке.
          </Text>
          <Button title="Убрать из справочника" variant="danger" onPress={remove} />
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  summary: { gap: spacing.md },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summaryTitles: { flex: 1, gap: 2 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: colors.accent, fontSize: 20, fontWeight: '700' },
  call: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stats: { flexDirection: 'row', gap: spacing.md },
  blockTitle: { marginBottom: spacing.md },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  kind: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
  },
  kindActive: { backgroundColor: colors.accentSoft },
  kindLabel: { fontSize: 14, color: colors.textMuted },
  kindLabelActive: { color: colors.accent, fontWeight: '600' },
  hint: { marginBottom: spacing.md },
});
