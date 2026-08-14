import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  createCounterparty,
  formatPhone,
  listCounterparties,
  parseList,
} from '../../db/counterparties';
import { useCashierKeys } from './useCashierKeys';
import { formatMoneyWeb } from '../../domain/money';
import type { CounterpartyWithTotals } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { say } from '../../ui/alert';
import { WebIcon } from '../../ui/icons';
import { pos } from '../../ui/webTheme';

/**
 * Поиск покупателя на кассе.
 *
 * Раньше строка «Розничный покупатель» ничего не делала, а кнопка рядом
 * уводила в список клиентов. Между тем именно здесь клиента и находят: он
 * называет телефон, кассир набирает четыре цифры и выбирает нужного.
 *
 * Устройство его: окно прижато к верху экрана, в нём высокое поле поиска с
 * лупой, под ним строка «Создать клиента» — Enter заводит клиента с набранным
 * именем, — и список найденных. В строке списка имя, под ним телефоны, справа
 * личная скидка процентом и бонусный счёт.
 *
 * Ищем по имени, телефону, почте и дисконтной карте — ровно по тому, что
 * перечислено в подписи поля. Обещать в подписи одно, а искать по другому
 * нельзя: кассир проверить это не может, он просто решит, что клиента нет.
 */
export function CashierCustomer({
  visible,
  chosen,
  onClose,
  onPick,
}: {
  visible: boolean;
  /** Кто выбран сейчас; null — розничный покупатель. */
  chosen: CounterpartyWithTotals | null;
  onClose: () => void;
  onPick: (customer: CounterpartyWithTotals | null) => void;
}) {
  const { db, refresh } = useDatabase();
  const [search, setSearch] = useState('');
  const field = useRef<TextInput>(null);

  const found = useQuery(
    (database) => listCounterparties(database, { kind: 'customer', search }),
    [search],
  );

  useEffect(() => {
    if (!visible) {
      setSearch('');
      return;
    }
    const timer = setTimeout(() => field.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [visible]);

  /** Завести клиента прямо отсюда — с тем именем, что уже набрано. */
  function create() {
    const name = search.trim();
    if (name.length < 3) {
      say('Слишком короткое имя', 'Наберите хотя бы три знака — они станут именем клиента.');
      return;
    }

    // Если набрали телефон, он и есть телефон, а не имя: кассир чаще всего
    // набирает именно номер.
    const digits = name.replace(/\D/g, '');
    const isPhone = digits.length >= 6 && digits.length === name.replace(/[\s()+-]/g, '').length;

    const id = createCounterparty(db, {
      kind: 'customer',
      name: isPhone ? `Покупатель ${digits.slice(-4)}` : name,
      phones: isPhone ? [name] : [],
    });
    refresh();

    const created = listCounterparties(db, { kind: 'customer' }).find(
      (party) => party.id === id,
    );
    if (created) onPick(created);
    onClose();
  }

  useCashierKeys(visible, (event) => {
    if (event.key === 'Escape') onClose();
    if (event.key === 'Enter' && found.length === 0 && search.trim().length >= 3) {
      event.preventDefault();
      create();
    }
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть поиск покупателя"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.panel}>
          <View style={styles.searchBar}>
            <WebIcon.search size={22} color={pos.bar} />
            <TextInput
              ref={field}
              value={search}
              onChangeText={setSearch}
              placeholder="Поиск покупателя по имени, телефону, email и дисконтной карте"
              placeholderTextColor={pos.muted}
              accessibilityLabel="Поиск покупателя"
              style={styles.searchInput}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Закрыть"
              onPress={onClose}
              style={styles.close}
            >
              <Text style={styles.closeSign}>✕</Text>
            </Pressable>
          </View>

          <Pressable accessibilityRole="button" onPress={create} style={styles.create}>
            <Text style={styles.createPlus}>+</Text>
            <Text style={styles.createLabel}>
              {search.trim() ? `Создать клиента «${search.trim()}»` : 'Создать клиента'}
            </Text>
          </Pressable>

          <ScrollView style={styles.list}>
            {/* Розничный покупатель — тоже выбор, а не отсутствие выбора:
                им отменяют ранее выбранного клиента, не закрывая чек. */}
            <Row
              title="Розничный покупатель"
              subtitle="Без карточки и без скидки"
              active={chosen === null}
              onPress={() => {
                onPick(null);
                onClose();
              }}
            />

            {found.map((party) => (
              <Row
                key={party.id}
                title={party.name}
                subtitle={
                  parseList(party.phones).map(formatPhone).join(', ') ||
                  formatPhone(party.phone) ||
                  party.email ||
                  ''
                }
                right={
                  <>
                    {party.loyalty_type !== 'bonus' && party.discount_bp > 0 ? (
                      <Text style={styles.discount}>{party.discount_bp / 100} %</Text>
                    ) : null}
                    {party.bonus_balance > 0 ? (
                      <Text style={styles.bonus}>{formatMoneyWeb(party.bonus_balance)} ⛁</Text>
                    ) : null}
                  </>
                }
                active={chosen?.id === party.id}
                onPress={() => {
                  onPick(party);
                  onClose();
                }}
              />
            ))}

            {found.length === 0 && search.trim() ? (
              <Text style={styles.empty}>
                Клиент не найден. Проверьте номер или заведите нового — Enter.
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Row({
  title,
  subtitle,
  right,
  active,
  onPress,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={title}
      onPress={onPress}
      style={[styles.row, active && styles.rowActive]}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowRight}>{right}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center' },
  panel: {
    // Прижато к верху экрана, как у него: кассир смотрит вверх, а не в центр.
    marginTop: 40,
    width: 680,
    maxWidth: '96%',
    maxHeight: '85%',
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    overflow: 'hidden',
    zIndex: 1,
  },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    height: 70,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },
  searchInput: {
    flex: 1,
    fontFamily: pos.font,
    fontSize: 20,
    fontWeight: '700',
    color: pos.text,
  },
  close: { padding: 6 },
  closeSign: { fontSize: 20, color: pos.muted },

  create: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },
  createPlus: { fontFamily: pos.font, fontSize: 18, color: pos.bar },
  createLabel: { fontFamily: pos.font, fontSize: 15, color: pos.bar },

  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },
  rowActive: { backgroundColor: '#E8F4FD' },
  rowText: { flex: 1 },
  rowTitle: { fontFamily: pos.font, fontSize: 17, color: pos.text },
  rowSubtitle: { fontFamily: pos.font, fontSize: 13, color: pos.muted },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  discount: { fontFamily: pos.font, fontSize: 15, color: pos.muted },
  bonus: { fontFamily: pos.font, fontSize: 15, color: '#7B5FD3' },

  empty: { fontFamily: pos.font, fontSize: 15, color: pos.muted, padding: 24, textAlign: 'center' },
});
