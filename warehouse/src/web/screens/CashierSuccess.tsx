import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useCashierKeys } from './useCashierKeys';
import { formatMoney, type Kopecks } from '../../domain/money';
import { pos } from '../../ui/webTheme';

/**
 * «Продажа прошла успешно» — окно после проведённого чека.
 *
 * Раньше на этом месте было короткое сообщение «Чек пробит. Сдача …». Оно
 * говорило меньше, чем нужно: у кассира на прилавке лежат деньги покупателя,
 * и он должен видеть **весь расчёт** — сколько было в чеке, сколько приняли
 * наличными, сколько картой, сколько ушло в отсрочку и сколько принято всего.
 * Сдача из этих чисел выводится, и когда они на виду, спорить не о чем.
 *
 * Поэтому сдача — самое крупное в окне, а строки над ней объясняют, откуда
 * она взялась. Пустые строки не показываем: «Безналичные 0» ничего не
 * добавляет, а место занимает и мешает найти нужное.
 */
export function CashierSuccess({
  visible,
  total,
  taken,
  changeDue,
  mode = 'sale',
  onClose,
}: {
  visible: boolean;
  /** Сумма чека, копейки. */
  total: Kopecks;
  /** Сколько чем приняли. */
  taken: { cash: Kopecks; card: Kopecks; credit: Kopecks };
  /** Сдача, копейки. Считает окно оплаты — здесь только показываем. */
  changeDue: Kopecks;
  /** У возврата деньги идут в обратную сторону: сдачи нет, есть выдача. */
  mode?: 'sale' | 'return';
  onClose: () => void;
}) {
  useCashierKeys(visible, (event) => {
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault();
      onClose();
    }
  });

  const accepted = taken.cash + taken.card + taken.credit;
  const returning = mode === 'return';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.panel}>
          <View style={styles.mark}>
            <Text style={styles.markSign}>✓</Text>
          </View>

          <Text style={styles.title}>
            {returning ? 'Возврат прошёл успешно' : 'Продажа прошла успешно'}
          </Text>

          <View style={styles.lines}>
            <Line label="Итог" value={total} />
            {taken.cash > 0 ? <Line label="Наличные" value={taken.cash} /> : null}
            {taken.card > 0 ? <Line label="Безналичные" value={taken.card} /> : null}
            {taken.credit > 0 ? <Line label="Отсрочка" value={taken.credit} /> : null}
            <Line label="Принято" value={accepted} strong />
          </View>

          <View style={styles.change}>
            <Text style={styles.changeLabel}>{returning ? 'ВЫДАНО:' : 'СДАЧА:'}</Text>
            <Text style={styles.changeValue}>
              {formatMoney(returning ? total : changeDue)} руб
            </Text>
          </View>

          <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
            <Text style={styles.closeLabel}>ЗАКРЫТЬ</Text>
            <View style={styles.key}>
              <Text style={styles.keyLabel}>ENTER</Text>
            </View>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Line({ label, value, strong }: { label: string; value: Kopecks; strong?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, strong && styles.lineStrong]}>{label}</Text>
      <Text style={[styles.lineValue, strong && styles.lineStrong]}>
        {formatMoney(value)} руб
      </Text>
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
    width: 460,
    maxWidth: '94%',
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    overflow: 'hidden',
    alignItems: 'stretch',
    paddingTop: 28,
    zIndex: 1,
  },

  // Зелёный круг с галочкой — единственный знак в окне: он читается раньше
  // текста и говорит главное, что чек прошёл.
  mark: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: pos.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markSign: { fontFamily: pos.font, fontSize: 36, lineHeight: 42, color: '#FFFFFF' },

  title: {
    fontFamily: pos.font,
    fontSize: 22,
    color: pos.text,
    textAlign: 'center',
    marginTop: 16,
  },

  lines: { paddingHorizontal: 32, marginTop: 22 },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
  },
  lineLabel: { fontFamily: pos.font, fontSize: 16, color: pos.muted },
  lineValue: {
    fontFamily: pos.font,
    fontSize: 16,
    color: pos.text,
    fontVariant: ['tabular-nums'],
  },
  lineStrong: { color: pos.text, fontWeight: '700' },

  // Сдача — то, ради чего окно и открыто: её называют вслух и отсчитывают.
  change: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 12,
    marginTop: 18,
    marginBottom: 26,
  },
  changeLabel: { fontFamily: pos.font, fontSize: 18, color: pos.muted, letterSpacing: 0.6 },
  changeValue: {
    fontFamily: pos.font,
    fontSize: 40,
    fontWeight: '700',
    color: pos.text,
    fontVariant: ['tabular-nums'],
  },

  close: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: pos.bar,
  },
  closeLabel: { fontFamily: pos.font, fontSize: 17, color: '#FFFFFF', letterSpacing: 0.8 },
  key: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 3,
  },
  keyLabel: { fontFamily: pos.font, fontSize: 11, color: '#FFFFFF' },
});
