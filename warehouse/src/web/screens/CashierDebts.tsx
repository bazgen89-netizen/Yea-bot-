import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useCashierKeys } from './useCashierKeys';
import { formatPhone } from '../../db/counterparties';
import { debtSales, listDebtors, payDebt, type Debtor } from '../../db/debts';
import { debtAfter, debtTotal } from '../../domain/debt';
import { formatMoney, parseMoney } from '../../domain/money';
import type { PaymentMethod } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { say } from '../../ui/alert';
import { Scrollable } from '../Scrollable';
import { WebIcon } from '../../ui/icons';
import { pos } from '../../ui/webTheme';

/**
 * «Возврат долга» — раздел кассы.
 *
 * Долг берётся в кассе же: часть чека приняли отсрочкой. Здесь его гасят —
 * покупатель заносит деньги, полностью или частью.
 *
 * Два экрана, как у него: сначала **список должников** с поиском и общей
 * суммой, потом — **сам долг** одного покупателя: чеки, по которым он висит,
 * поле суммы, «Общий долг составит» и кнопка «Закрыть долг на сумму …».
 *
 * Разносятся деньги по чекам сами, от старого к новому: покупатель говорит
 * «за прошлый раз», а не называет номер чека.
 */
export function CashierDebts({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Debtor | null>(null);

  // Пока открыт долг одного покупателя, Esc закрывает его, а не весь список.
  useCashierKeys(visible && !picked, (event) => {
    if (event.key === 'Escape') onClose();
  });

  const debtors = useQuery((db) => listDebtors(db, search), [search]);
  const total = debtors.reduce((sum, debtor) => sum + debtor.debt, 0);

  // Погасили долг целиком — покупатель уходит из списка, и окно закрывается
  // само: держать открытым долг, которого больше нет, незачем.
  useEffect(() => {
    if (!picked) return;
    const still = debtors.find((debtor) => debtor.id === picked.id);
    if (!still) setPicked(null);
    else if (still.debt !== picked.debt) setPicked(still);
  }, [debtors, picked]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть список должников"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.listPanel}>
          <View style={styles.listHead}>
            <Text style={styles.listTitle}>Список должников</Text>

            <View style={styles.searchRow}>
              <WebIcon.search size={20} color={pos.muted} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Введите текст для поиска"
                placeholderTextColor={pos.muted}
                accessibilityLabel="Поиск должника"
                style={styles.search}
              />
            </View>
          </View>

          {/* Серая полоса со счётом и общей суммой: кассир смотрит сюда
              раньше, чем в список, — «сколько всего за людьми». */}
          <View style={styles.summary}>
            <Text style={styles.summaryFound}>Найдено {debtors.length}</Text>
            <Text style={styles.summaryTotal}>Общий долг: {formatMoney(total)} руб</Text>
          </View>

          <Scrollable style={styles.list}>
            {debtors.length === 0 ? (
              <Text style={styles.emptyText}>
                {search ? 'Никого не нашли' : 'Долгов нет — все рассчитались'}
              </Text>
            ) : null}

            {debtors.map((debtor) => (
              <Pressable
                key={debtor.id}
                accessibilityRole="button"
                accessibilityLabel={`Долг: ${debtor.name}`}
                onPress={() => setPicked(debtor)}
                style={(state) => [
                  styles.row,
                  (state as { hovered?: boolean }).hovered && styles.rowHover,
                ]}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials(debtor.name)}</Text>
                </View>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {debtor.name}
                </Text>
                <Text style={styles.rowValue}>{formatMoney(debtor.debt)} руб</Text>
              </Pressable>
            ))}
          </Scrollable>

          <View style={styles.listFoot}>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeRow}>
              <Text style={styles.closeLabel}>ЗАКРЫТЬ</Text>
              <View style={styles.key}>
                <Text style={styles.keyLabel}>ESC</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </View>

      <DebtWindow debtor={picked} onClose={() => setPicked(null)} />
    </Modal>
  );
}

/** «Евгений Т.» → «ЕТ»: две первые буквы имени и фамилии. */
function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.slice(0, 1).toUpperCase())
    .join('');
}

/** Долг одного покупателя: чеки, сумма и погашение. */
function DebtWindow({ debtor, onClose }: { debtor: Debtor | null; onClose: () => void }) {
  const { db, refresh } = useDatabase();
  const sales = useQuery((database) => (debtor ? debtSales(database, debtor.id) : []), [
    debtor?.id,
    debtor?.debt,
  ]);

  const total = debtTotal(sales);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');

  // Подставляется весь долг: чаще заносят его целиком, а часть — исключение.
  useEffect(() => {
    if (!debtor) return;
    setMethod('cash');
    setAmount(String(total / 100));
  }, [debtor?.id, total, debtor]);

  const paying = parseMoney(amount) ?? 0;
  const applied = Math.min(Math.max(0, paying), total);

  function close(): void {
    if (!debtor) return;
    if (applied <= 0) {
      say('Проверьте сумму', 'Сумма погашения — больше нуля.');
      return;
    }

    try {
      payDebt(db, { customerId: debtor.id, amount: applied, payment: method });
    } catch (error) {
      say('Долг не закрыт', String(error));
      return;
    }

    refresh();
    onClose();
  }

  useCashierKeys(Boolean(debtor), (event) => {
    if (event.key === 'Escape') onClose();
    if (event.key === 'Enter') {
      event.preventDefault();
      close();
    }
  });

  if (!debtor) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть долг покупателя"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.panel}>
          <View style={styles.head}>
            <Text style={styles.title}>{debtor.name}</Text>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeRow}>
              <Text style={styles.closeLabel}>ЗАКРЫТЬ</Text>
              <View style={styles.key}>
                <Text style={styles.keyLabel}>ESC</Text>
              </View>
            </Pressable>
          </View>

          <ScrollView style={styles.sales}>
            {sales.map((sale) => (
              <View key={sale.id} style={styles.saleRow}>
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle}>Продажа #{sale.id}</Text>
                  <Text style={styles.rowNote}>
                    {new Date(sale.created_at).toLocaleString('ru-RU')} · чек на{' '}
                    {formatMoney(sale.total)} руб
                  </Text>
                </View>
                <Text style={styles.rowValue}>{formatMoney(sale.left)} руб</Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Сумма</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              accessibilityLabel="Сумма погашения"
              style={styles.input}
            />
          </View>

          <View style={styles.methods}>
            {(
              [
                { id: 'cash', label: 'Наличные' },
                { id: 'card', label: 'Безналичные' },
              ] as const
            ).map((option) => (
              <Pressable
                key={option.id}
                accessibilityRole="button"
                accessibilityState={{ selected: method === option.id }}
                onPress={() => setMethod(option.id)}
                style={[styles.method, method === option.id && styles.methodOn]}
              >
                <Text style={[styles.methodLabel, method === option.id && styles.methodLabelOn]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.after}>
            <Text style={styles.afterLabel}>Общий долг составит:</Text>
            <Text style={styles.afterValue}>{formatMoney(debtAfter(total, applied))} руб</Text>
          </View>

          <Pressable accessibilityRole="button" onPress={close} style={styles.confirm}>
            <Text style={styles.confirmLabel}>
              ЗАКРЫТЬ ДОЛГ НА СУММУ {formatMoney(applied)} РУБ
            </Text>
            <View style={styles.confirmKey}>
              <Text style={styles.confirmKeyLabel}>ENTER</Text>
            </View>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Окно списка должников: заголовок, поиск, серая полоса с итогом, строки.
  listPanel: {
    width: 520,
    maxWidth: '94%',
    height: '72%',
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    overflow: 'hidden',
    zIndex: 1,
  },
  listHead: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 18 },
  listTitle: { fontFamily: pos.font, fontSize: 24, color: pos.text, marginBottom: 16 },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    height: 50,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 4,
  },
  search: { outlineWidth: 0, flex: 1, fontFamily: pos.font, fontSize: 17, color: pos.text },

  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    height: 48,
    backgroundColor: '#F5F7F9',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: pos.border,
  },
  summaryFound: { fontFamily: pos.font, fontSize: 15, fontWeight: '700', color: pos.text },
  summaryTotal: { fontFamily: pos.font, fontSize: 15, color: pos.text },

  list: { flex: 1, minHeight: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  rowHover: { backgroundColor: pos.bg },
  // Квадрат с двумя буквами — как у него: фотографий у покупателей нет,
  // а по одной букве в списке из десяти человек не различить.
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 4,
    backgroundColor: '#4B9FE1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: pos.font, fontSize: 19, color: '#FFFFFF' },
  rowMain: { flex: 1, gap: 3 },
  rowTitle: { flex: 1, fontFamily: pos.font, fontSize: 17, color: pos.text },
  rowNote: { fontFamily: pos.font, fontSize: 13, color: pos.muted },
  rowValue: { fontFamily: pos.font, fontSize: 17, color: pos.text, fontVariant: ['tabular-nums'] },

  listFoot: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 24,
    height: 60,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: pos.border,
  },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: {
    fontFamily: pos.font,
    fontSize: 16,
    color: pos.muted,
    textAlign: 'center',
    marginTop: 40,
  },

  modalRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    width: 620,
    maxWidth: '94%',
    maxHeight: '90%',
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    paddingTop: 22,
    zIndex: 1,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 26,
  },
  title: { fontFamily: pos.font, fontSize: 22, color: pos.text },
  closeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  closeLabel: { fontFamily: pos.font, fontSize: 13, color: pos.muted, letterSpacing: 0.6 },
  key: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 3,
  },
  keyLabel: { fontFamily: pos.font, fontSize: 11, color: pos.muted },

  sales: { maxHeight: 220, marginTop: 18 },
  saleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 26,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },

  field: { paddingHorizontal: 26, marginTop: 18, gap: 6 },
  fieldLabel: { fontFamily: pos.font, fontSize: 12, color: pos.muted },
  input: { outlineWidth: 0,
    height: 42,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
    fontFamily: pos.font,
    fontSize: 20,
    color: pos.text,
    fontVariant: ['tabular-nums'],
  },

  methods: { flexDirection: 'row', gap: 10, paddingHorizontal: 26, marginTop: 16 },
  method: {
    flex: 1,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 4,
  },
  methodOn: { borderColor: pos.bar, backgroundColor: '#E8F3FD' },
  methodLabel: { fontFamily: pos.font, fontSize: 15, color: pos.text },
  methodLabelOn: { color: pos.bar },

  after: { alignItems: 'center', paddingVertical: 18, gap: 4 },
  afterLabel: { fontFamily: pos.font, fontSize: 13, color: pos.muted },
  afterValue: {
    fontFamily: pos.font,
    fontSize: 30,
    fontWeight: '700',
    color: pos.text,
    fontVariant: ['tabular-nums'],
  },

  confirm: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: pos.accent,
  },
  confirmLabel: { fontFamily: pos.font, fontSize: 17, color: '#FFFFFF', letterSpacing: 0.6 },
  confirmKey: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 3,
  },
  confirmKeyLabel: { fontFamily: pos.font, fontSize: 11, color: '#FFFFFF' },
});
