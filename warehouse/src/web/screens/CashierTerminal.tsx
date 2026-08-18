import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Translated';

import { useCashierKeys } from './useCashierKeys';
import { formatMoney, type Kopecks } from '../../domain/money';
import { pos } from '../../ui/webTheme';

/**
 * «Примите оплату через терминал» — окно кассы при безналичной оплате.
 *
 * Между нажатием «Принять» и проведённым чеком есть шаг, которого раньше не
 * было: покупатель прикладывает карту к терминалу, и это занимает время.
 * Касса всё это время должна показывать **сумму**, чтобы её видели оба —
 * и кассир, и покупатель, — и ждать ответа терминала.
 *
 * Терминал у нас не подключён, поэтому ответ подтверждает кассир кнопкой
 * «УСПЕШНО». Это честнее, чем проводить чек сразу: деньги приходят не в тот
 * миг, когда нажали кнопку в программе.
 */
export function CashierTerminal({
  visible,
  amount,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  /** Сколько просим у терминала, копейки. */
  amount: Kopecks;
  onClose: () => void;
  onSuccess: () => void;
}) {
  useCashierKeys(visible, (event) => {
    if (event.key === 'Escape') onClose();
    if (event.key === 'Enter') {
      event.preventDefault();
      onSuccess();
    }
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть оплату через терминал"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.panel}>
          <View style={styles.head}>
            <Text style={styles.title}>Примите оплату через терминал</Text>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeRow}>
              <Text style={styles.closeLabel}>ЗАКРЫТЬ</Text>
              <View style={styles.key}>
                <Text style={styles.keyLabel}>ESC</Text>
              </View>
            </Pressable>
          </View>

          <Text style={styles.amount}>{formatMoney(amount)} руб</Text>

          <Terminal />

          <Pressable accessibilityRole="button" onPress={onSuccess} style={styles.done}>
            <Text style={styles.doneLabel}>УСПЕШНО</Text>
            <View style={styles.doneKey}>
              <Text style={styles.doneKeyLabel}>ENTER</Text>
            </View>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Сам терминал — нарисован фигурами, а не взят из шрифта.
 *
 * Значка платёжного терминала в наборах эмодзи нет вовсе, и подставлять
 * вместо него карту или телефон значило бы показать не тот прибор.
 */
function Terminal() {
  return (
    <View style={styles.device}>
      <View style={styles.screen} />
      <View style={styles.keys}>
        {Array.from({ length: 12 }, (_, index) => (
          <View
            key={index}
            style={[
              styles.button,
              index % 3 === 2 && styles.buttonWarm,
              index >= 9 && styles.buttonCool,
            ]}
          />
        ))}
      </View>
      <View style={styles.card} />
    </View>
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
    width: 520,
    maxWidth: '94%',
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    overflow: 'hidden',
    zIndex: 1,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 18,
  },
  title: { fontFamily: pos.font, fontSize: 17, color: pos.text },
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

  // Сумма — самое крупное в окне: её читают с двух сторон прилавка.
  amount: {
    fontFamily: pos.font,
    fontSize: 36,
    fontWeight: '700',
    color: pos.text,
    textAlign: 'center',
    marginTop: 18,
    fontVariant: ['tabular-nums'],
  },

  device: {
    alignSelf: 'center',
    width: 92,
    marginVertical: 34,
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#8E9AA6',
  },
  screen: { height: 26, borderRadius: 3, backgroundColor: '#BFE3F2' },
  keys: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  button: { width: 22, height: 12, borderRadius: 2, backgroundColor: '#E4E8EC' },
  buttonWarm: { backgroundColor: '#E8A33D' },
  buttonCool: { backgroundColor: '#6FA8DC' },
  card: {
    width: 46,
    height: 30,
    marginTop: 10,
    marginLeft: -14,
    borderRadius: 3,
    backgroundColor: '#4C9BE8',
  },

  done: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: pos.accent,
  },
  doneLabel: { fontFamily: pos.font, fontSize: 15, color: '#FFFFFF', letterSpacing: 0.8 },
  doneKey: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 3,
  },
  doneKeyLabel: { fontFamily: pos.font, fontSize: 11, color: '#FFFFFF' },
});
