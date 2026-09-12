import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../Translated';

import { useCashierKeys } from './useCashierKeys';
import { Dropdown } from '../Dropdown';
import { lastClosingCash, listRegisters, openShift } from '../../db/shifts';
import { formatMoney, parseMoney } from '../../domain/money';
import type { Id } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { say } from '../../ui/alert';
import { pos } from '../../ui/webTheme';

/**
 * «Открытие смены» — окно кассы.
 *
 * Смена не открывается одним нажатием: у неё есть начало, и начало это —
 * **сверка денег в ящике**. Кассир выбирает кассу и подтверждает сумму, с
 * которой начинает; без неё в конце смены не с чем сравнивать пересчёт, и
 * расхождение показать было бы неоткуда.
 *
 * Сумма подставляется та, что осталась с прошлой смены этой кассы: ящик на
 * ночь не опустошают, и пересчитывать его заново кассир не должен — он его
 * сверяет.
 *
 * Управление клавишами его же: Esc закрывает, Enter открывает смену.
 */
export function CashierOpenShift({
  visible,
  onClose,
  onOpened,
}: {
  visible: boolean;
  onClose: () => void;
  onOpened: () => void;
}) {
  const { db, refresh } = useDatabase();
  const registers = useQuery((database) => listRegisters(database));

  // Свободные кассы: на занятой смена уже идёт, и открыть вторую нельзя.
  const free = registers.filter((register) => register.open_shift_id === null);

  const [registerId, setRegisterId] = useState<Id | null>(null);
  const [cash, setCash] = useState('');
  const [touched, setTouched] = useState(false);

  const chosen = free.find((register) => register.id === registerId) ?? free[0] ?? null;

  // Пока сумму не трогали, она следует за выбранной кассой: у каждой свой
  // ящик, и остаток в нём свой.
  useEffect(() => {
    if (!visible || !chosen || touched) return;
    setCash(String(lastClosingCash(db, chosen.id) / 100));
  }, [visible, chosen?.id, touched, db, chosen]);

  // Окно закрылось — следующее открытие начинается с чистого листа.
  useEffect(() => {
    if (!visible) {
      setTouched(false);
      setRegisterId(null);
    }
  }, [visible]);

  function start(): void {
    if (!chosen) {
      say('Нет свободной кассы', 'Смена уже открыта на всех кассах.');
      return;
    }

    const opening = parseMoney(cash);
    if (opening === null) {
      say('Проверьте сумму', 'Сумма денег в кассе — число.');
      return;
    }

    try {
      openShift(db, { registerId: chosen.id, openingCash: opening, cashier: 'waystea' });
    } catch (error) {
      say('Смена не открыта', String(error));
      return;
    }

    refresh();
    onOpened();
    onClose();
  }

  useCashierKeys(visible, (event) => {
    if (event.key === 'Escape') onClose();
    if (event.key === 'Enter') {
      event.preventDefault();
      start();
    }
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть окно открытия смены"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.panel}>
          <View style={styles.head}>
            <Text style={styles.title}>Открытие смены</Text>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeRow}>
              <Text style={styles.closeLabel}>ЗАКРЫТЬ</Text>
              <View style={styles.key}>
                <Text style={styles.keyLabel}>ESC</Text>
              </View>
            </Pressable>
          </View>

          <Text style={styles.section}>Сверка денег в кассе</Text>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Касса</Text>
            {free.length === 0 ? (
              <Text style={styles.empty}>Все кассы заняты — смена уже открыта.</Text>
            ) : (
              <Dropdown
                value={chosen ? String(chosen.id) : ''}
                options={free.map((register) => ({
                  value: String(register.id),
                  // Магазин приписывается только если его нет в названии
                  // кассы: «Касса — Рынок · Рынок» читается как ошибка.
                  label:
                    register.location_name && !register.name.includes(register.location_name)
                      ? `${register.name} · ${register.location_name}`
                      : register.name,
                }))}
                onChange={(value) => setRegisterId(Number(value))}
                variant="field"
                label="Касса"
              />
            )}
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Сумма денег в кассе</Text>
            <TextInput
              value={cash}
              onChangeText={(value) => {
                setTouched(true);
                setCash(value);
              }}
              keyboardType="decimal-pad"
              accessibilityLabel="Сумма денег в кассе"
              style={styles.input}
            />
            <Text style={styles.hint}>
              Осталось с прошлой смены:{' '}
              {formatMoney(chosen ? lastClosingCash(db, chosen.id) : 0)} руб
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: free.length === 0 }}
            onPress={start}
            style={[styles.confirm, free.length === 0 && styles.confirmOff]}
          >
            <Text style={styles.confirmLabel}>ОТКРЫТЬ СМЕНУ</Text>
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
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    width: 560,
    maxWidth: '94%',
    backgroundColor: pos.tile,
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
  title: { fontFamily: pos.font, fontSize: 19, color: pos.text },
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

  section: {
    fontFamily: pos.font,
    fontSize: 15,
    color: pos.text,
    paddingHorizontal: 26,
    marginTop: 26,
  },

  field: { paddingHorizontal: 26, marginTop: 18, gap: 6 },
  fieldLabel: { fontFamily: pos.font, fontSize: 12, color: pos.muted },
  input: { outlineWidth: 0,
    height: 42,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
    fontFamily: pos.font,
    fontSize: 18,
    color: pos.text,
    fontVariant: ['tabular-nums'],
  },
  hint: { fontFamily: pos.font, fontSize: 12, color: pos.muted },
  empty: { fontFamily: pos.font, fontSize: 13, color: pos.muted },

  confirm: {
    marginTop: 26,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: pos.accent,
  },
  confirmOff: { opacity: 0.5 },
  confirmLabel: { fontFamily: pos.font, fontSize: 15, color: '#FFFFFF', letterSpacing: 0.8 },
  confirmKey: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 3,
  },
  confirmKeyLabel: { fontFamily: pos.font, fontSize: 11, color: '#FFFFFF' },
});
