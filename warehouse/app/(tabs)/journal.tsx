import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { listDocs, type DocSummary } from '../../src/db/stock';
import { listSales, type SaleSummary } from '../../src/db/sales';
import { formatMoneyWithSign } from '../../src/domain/money';
import { pluralize } from '../../src/domain/plural';
import { DOC_KIND_LABEL, docKind } from '../../src/domain/types';
import { useQuery } from '../../src/state/DatabaseProvider';
import { AppHeader } from '../../src/ui/AppHeader';
import { Badge, Button, Empty, Row } from '../../src/ui/components';
import { colors, radius, spacing, text } from '../../src/ui/theme';
import { useDesktop } from '../../src/ui/useDesktop';
import { JournalTable } from '../../src/web/screens/JournalTable';

type Tab = 'docs' | 'sales';


export default function DocsScreen() {
  // На широком экране журнал показывается таблицей, как в кабинете.
  const desktop = useDesktop();
  if (desktop) return <JournalTable />;

  return <JournalPhone />;
}

function JournalPhone() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('docs');

  const docs = useQuery((db) => listDocs(db, 100));
  const sales = useQuery((db) => listSales(db, 100));

  return (
    <View style={styles.screen}>
      <AppHeader title="Журнал" subtitle="Документы и продажи" />

      <View style={styles.tabs}>
        <TabChip label="Склад" active={tab === 'docs'} onPress={() => setTab('docs')} />
        <TabChip label="Продажи" active={tab === 'sales'} onPress={() => setTab('sales')} />
      </View>

      {tab === 'docs' ? (
        <FlatList
          data={docs}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <DocRow
              doc={item}
              onPress={() =>
                router.push({ pathname: '/doc/[id]', params: { id: String(item.id) } })
              }
            />
          )}
          ListEmptyComponent={
            <Empty
              title="Документов пока нет"
              hint="Оформите приход, чтобы товар появился на складе"
            />
          }
          contentContainerStyle={docs.length === 0 ? styles.emptyList : undefined}
        />
      ) : (
        <FlatList
          data={sales}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <SaleRow
              sale={item}
              onPress={() =>
                router.push({ pathname: '/sale/[id]', params: { id: String(item.id) } })
              }
            />
          )}
          ListEmptyComponent={<Empty title="Продаж пока не было" />}
          contentContainerStyle={sales.length === 0 ? styles.emptyList : undefined}
        />
      )}

      <View style={styles.footer}>
        <Button
          title="Приход"
          onPress={() => router.push('/doc/new?type=receipt')}
          style={styles.action}
        />
        <Button
          title="Списание"
          variant="secondary"
          onPress={() => router.push('/doc/new?type=writeoff')}
          style={styles.action}
        />
      </View>
    </View>
  );
}

function DocRow({ doc, onPress }: { doc: DocSummary; onPress: () => void }) {
  return (
    <Row
      onPress={onPress}
      left={
        <>
          <Text style={text.body}>
            {DOC_KIND_LABEL[docKind(doc)]} №{doc.id}
          </Text>
          <Text style={text.muted} numberOfLines={1}>
            {formatDate(doc.created_at)}
            {doc.counterparty ? ` · ${doc.counterparty}` : ''}
            {doc.note ? ` · ${doc.note}` : ''}
          </Text>
        </>
      }
      right={
        <>
          {doc.type === 'adjust' ? null : (
            <Text style={text.amount}>{formatMoneyWithSign(doc.amount)}</Text>
          )}
          <Text style={text.muted}>
            {pluralize(doc.positions, 'позиция', 'позиции', 'позиций')}
          </Text>
        </>
      }
    />
  );
}

function SaleRow({ sale, onPress }: { sale: SaleSummary; onPress: () => void }) {
  return (
    <Row
      onPress={onPress}
      left={
        <>
          <Text style={text.body}>Чек №{sale.id}</Text>
          <Text style={text.muted}>{formatDate(sale.created_at)}</Text>
        </>
      }
      right={
        <>
          <Text style={text.amount}>{formatMoneyWithSign(sale.total)}</Text>
          {sale.refunded ? (
            <Badge label="Возврат" tone="danger" />
          ) : (
            <Text style={text.muted}>
              {pluralize(sale.positions, 'позиция', 'позиции', 'позиций')}
            </Text>
          )}
        </>
      }
    />
  );
}

function TabChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { opacity: 0.7 }]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.bg,
  },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 14, color: colors.textMuted, fontWeight: '500' },
  chipTextActive: { color: colors.primaryText },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  action: { flex: 1 },
});
