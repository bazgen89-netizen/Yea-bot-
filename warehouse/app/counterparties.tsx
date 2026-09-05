import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatPhone, listCounterparties } from '../src/db/counterparties';
import { formatMoney } from '../src/domain/money';
import { pluralize } from '../src/domain/plural';
import type { CounterpartyWithTotals, PartyKind } from '../src/domain/types';
import { useQuery } from '../src/state/DatabaseProvider';
import { AppHeader, HeaderAction } from '../src/ui/AppHeader';
import { Icon } from '../src/ui/icons';
import { colors, radius, spacing, text } from '../src/ui/theme';
import { useDesktop } from '../src/ui/useDesktop';
import { PartiesTable } from '../src/web/screens/PartiesTable';

/**
 * Справочник контрагентов. Один экран на клиентов и поставщиков — списки
 * устроены одинаково, отличаются только заголовком и тем, кого показываем.
 */
export default function CounterpartiesScreen() {
  const params = useLocalSearchParams<{ kind?: string }>();
  const kind: PartyKind = params.kind === 'supplier' ? 'supplier' : 'customer';

  // На широком экране справочник показывается таблицей, как в кабинете.
  const desktop = useDesktop();
  if (desktop) return <PartiesTable kind={kind} />;

  return <PartiesList kind={kind} />;
}

function PartiesList({ kind }: { kind: PartyKind }) {
  const router = useRouter();

  const [search, setSearch] = useState('');

  const parties = useQuery(
    (db) => listCounterparties(db, { kind, search }),
    [kind, search],
  );

  const title = kind === 'supplier' ? 'Поставщики' : 'Клиенты';

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <AppHeader
        back
        title={title}
        subtitle={
          kind === 'supplier'
            ? pluralize(parties.length, 'поставщик', 'поставщика', 'поставщиков')
            : pluralize(parties.length, 'клиент', 'клиента', 'клиентов')
        }
        actions={
          <HeaderAction
            label="Добавить"
            onPress={() =>
              router.push({ pathname: '/counterparty/[id]', params: { id: 'new', kind } })
            }
          >
            <Icon.plus color="#FFFFFF" size={28} />
          </HeaderAction>
        }
      />

      <View style={styles.searchRow}>
        <Icon.search />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Имя или телефон"
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          clearButtonMode="while-editing"
          keyboardType="default"
        />
        <Icon.mic />
      </View>

      <FlatList
        data={parties}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <PartyRow party={item} />}
        // Список на несколько тысяч строк: рисуем окном, иначе первый показ
        // экрана заметно подвисает.
        initialNumToRender={20}
        windowSize={11}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={text.heading}>
              {search ? 'Ничего не нашлось' : `${title}: пока никого`}
            </Text>
            <Text style={[text.muted, styles.emptyHint]}>
              {search ? 'Попробуйте другое имя или номер' : 'Добавьте кнопкой + в шапке'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

function PartyRow({ party }: { party: CounterpartyWithTotals }) {
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({ pathname: '/counterparty/[id]', params: { id: String(party.id) } })
      }
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarLetter}>{initial(party.name)}</Text>
      </View>

      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {party.name}
        </Text>
        <Text style={styles.rowPhone} numberOfLines={1}>
          {formatPhone(party.phone) || party.email || 'Телефон не указан'}
        </Text>
      </View>

      <View style={styles.rowRight}>
        {party.receipts > 0 ? (
          <>
            <Text style={styles.rowSum}>{formatMoney(party.purchases)} руб</Text>
            <Text style={styles.rowCount}>
              {pluralize(party.receipts, 'покупка', 'покупки', 'покупок')}
            </Text>
          </>
        ) : (
          <Text style={styles.rowCount}>Без покупок</Text>
        )}
      </View>

      <Icon.chevron />
    </Pressable>
  );
}

/** Первая буква имени для кружка-аватара. */
function initial(name: string): string {
  const letter = name.trim().slice(0, 1).toUpperCase();
  return letter || '?';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  search: { flex: 1, fontSize: 17, color: colors.text, paddingVertical: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: colors.accent, fontSize: 18, fontWeight: '700' },
  rowBody: { flex: 1, gap: 2 },
  rowName: { fontSize: 17, fontWeight: '600', color: colors.text },
  rowPhone: { fontSize: 14, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  rowRight: { alignItems: 'flex-end', gap: 2 },
  rowSum: { fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
  rowCount: { fontSize: 12, color: colors.textMuted },
  empty: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm },
  emptyHint: { textAlign: 'center' },
});
