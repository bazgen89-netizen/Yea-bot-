import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useCashierKeys } from './useCashierKeys';
import { closeShift, shiftReport } from '../../db/shifts';
import { formatMoneyWeb, parseMoney } from '../../domain/money';
import type { Id } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { say } from '../../ui/alert';
import { pos } from '../../ui/webTheme';

/**
 * «Закрытие смены» — окно кассы.
 *
 * Зеркало «Открытия смены»: смена началась со сверки денег в ящике и ею же
 * заканчивается. Кассир пересчитывает ящик и вводит, сколько в нём вышло; из
 * разницы с ожидаемым и получается расхождение, ради которого смену вообще
 * закрывают, а не просто перестают продавать.
 *
 * Спрашивается это **после** подтверждения — «Вы действительно хотите закрыть
 * смену?». Порядок важен: закрытие необратимо, и понять, что закрываешь смену,
 * кассир должен до того, как начал считать деньги.
 *
 * Сумма подставляется ожидаемая — та, что должна быть в ящике по чекам. Это
 * подсказка, а не ответ: если ящик сошёлся, кассиру нечего вводить, а если
 * нет — он видит, от чего отклоняется.
 */
export function CashierCloseShift({
  shiftId,
  visible,
  onClose,
}: {
  shiftId: Id | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { db, refresh } = useDatabase();
  const report = useQuery(
    (database) => (shiftId ? shiftReport(database, shiftId) : null),
    [shiftId],
  );

  const [cash, setCash] = useState('');
  const [touched, setTouched] = useState(false);

  // Пока сумму не трогали, она следует за ожидаемой: касса пересчитала её
  // сама, и переписывать одно и то же кассир не должен.
  useEffect(() => {
    if (!visible || !report || touched) return;
    setCash(String(report.expectedCash / 100));
  }, [visible, report, touched]);

  useEffect(() => {
    if (!visible) setTouched(false);
  }, [visible]);

  function finish(): void {
    if (!report) return;

    const counted = parseMoney(cash);
    if (counted === null) {
      say('Проверьте сумму', 'Сумма денег в кассе — число.');
      return;
    }

    let z;
    try {
      z = closeShift(db, report.shift.id, counted);
    } catch (error) {
      say('Смена не закрыта', String(error));
      return;
    }

    refresh();
    onClose();
    say(
      `Z-отчёт по смене №${z.shift.id}`,
      [
        `Чеков: ${z.receipts}`,
        `Выручка: ${formatMoneyWeb(z.revenue)} руб`,
        `Ожидалось в кассе: ${formatMoneyWeb(z.expectedCash)} руб`,
        `Пересчитано: ${formatMoneyWeb(counted)} руб`,
        `Расхождение: ${formatMoneyWeb(z.difference ?? 0)} руб`,
      ].join('\n'),
    );
  }

  useCashierKeys(visible, (event) => {
    if (event.key === 'Escape') onClose();
    if (event.key === 'Enter') {
      event.preventDefault();
      finish();
    }
  });

  if (!report) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть окно закрытия смены"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.panel}>
          <View style={styles.head}>
            <Text style={styles.title}>Закрытие смены</Text>
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
            <Text style={styles.value}>
              {report.location_name && !report.register_name.includes(report.location_name)
                ? `${report.register_name} · ${report.location_name}`
                : report.register_name}
            </Text>
            <Text style={styles.hint}>
              Смена №{report.shift.id}, чеков {report.receipts} на{' '}
              {formatMoneyWeb(report.revenue)} руб
            </Text>
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
              Ожидается по чекам: {formatMoneyWeb(report.expectedCash)} руб
            </Text>
          </View>

          <Pressable accessibilityRole="button" onPress={finish} style={styles.confirm}>
            <Text style={styles.confirmLabel}>ЗАКРЫТЬ СМЕНУ</Text>
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

  section: { fontFamily: pos.font, fontSize: 17, color: pos.text, paddingHorizontal: 26, marginTop: 26 },

  field: { paddingHorizontal: 26, marginTop: 18, gap: 6 },
  fieldLabel: { fontFamily: pos.font, fontSize: 12, color: pos.muted },
  value: { fontFamily: pos.font, fontSize: 18, color: pos.text },
  input: { outlineWidth: 0,
    height: 42,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
    fontFamily: pos.font,
    fontSize: 20,
    color: pos.text,
    fontVariant: ['tabular-nums'],
  },
  hint: { fontFamily: pos.font, fontSize: 12, color: pos.muted },

  // Закрытие красное, а не оранжевое: это конец смены, и перепутать его с
  // открытием нельзя — у него в меню этот пункт единственный красный.
  confirm: {
    marginTop: 26,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: '#D32F2F',
  },
  confirmLabel: { fontFamily: pos.font, fontSize: 17, color: '#FFFFFF', letterSpacing: 0.8 },
  confirmKey: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 3,
  },
  confirmKeyLabel: { fontFamily: pos.font, fontSize: 11, color: '#FFFFFF' },
});
