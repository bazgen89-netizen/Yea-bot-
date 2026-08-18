import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../Translated';
import { Scrollable } from '../Scrollable';
import { useCashierKeys } from './useCashierKeys';
import { deleteHeld, listHeld, type HeldReceipt } from '../../db/held';
import { formatMoney } from '../../domain/money';
import { formatQty } from '../../domain/qty';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { pos } from '../../ui/webTheme';

/**
 * «Очередь чеков» — отложенные чеки.
 *
 * Каждый показан так же, как лежал на кассе: чем был (продажа или возврат),
 * кому, когда, и построчно — что в нём. Иначе выбирать из очереди пришлось бы
 * наугад: чеки в ней похожи друг на друга, а отличаются одной позицией.
 *
 * Две кнопки: «Выбрать» возвращает чек на кассу и убирает его из очереди,
 * «Удалить» выбрасывает совсем.
 */
export function CashierQueue({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  /** Вернуть чек на кассу. Из очереди он при этом пропадает. */
  onPick: (receipt: HeldReceipt) => void;
}) {
  const { db, refresh } = useDatabase();
  const queue = useQuery((database) => listHeld(database));

  useCashierKeys(visible, (event) => {
    if (event.key === 'Escape') onClose();
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть очередь чеков"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.window}>
          <View style={styles.head}>
            <Text style={styles.title}>Очередь чеков</Text>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeRow}>
              <Text style={styles.close}>ЗАКРЫТЬ</Text>
              <View style={styles.key}>
                <Text style={styles.keyLabel}>ESC</Text>
              </View>
            </Pressable>
          </View>

          <Scrollable style={styles.body} contentContainerStyle={styles.bodyInner}>
            {queue.map((receipt) => (
              <View key={receipt.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.kind}>
                    {receipt.mode === 'return' ? 'Возврат' : 'Продажа'}
                  </Text>
                  <Text style={styles.customer}>
                    {receipt.customer_name ?? 'Розничный покупатель'}
                  </Text>
                  <Text style={styles.time}>{when(receipt.created_at)}</Text>
                </View>

                {receipt.lines.map((line) => (
                  <View key={line.product_id} style={styles.line}>
                    <Text style={styles.lineName} numberOfLines={2}>
                      {line.name}
                    </Text>
                    <Text style={styles.lineQty}>{formatQty(line.qty)}</Text>
                    <Text style={styles.linePrice}>{formatMoney(line.price)}</Text>
                  </View>
                ))}

                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      // Сначала убираем из очереди, потом кладём на кассу:
                      // иначе один и тот же чек мог бы оказаться в двух местах.
                      deleteHeld(db, receipt.id);
                      refresh();
                      onPick(receipt);
                      onClose();
                    }}
                    style={styles.pick}
                  >
                    <Text style={styles.pickLabel}>ВЫБРАТЬ</Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      deleteHeld(db, receipt.id);
                      refresh();
                    }}
                    style={styles.drop}
                  >
                    <Text style={styles.dropLabel}>УДАЛИТЬ</Text>
                  </Pressable>
                </View>
              </View>
            ))}

            {queue.length === 0 ? (
              <Text style={styles.empty}>
                Очередь пуста. Отложить чек можно тремя точками на кнопке продажи.
              </Text>
            ) : null}
          </Scrollable>
        </View>
      </View>
    </Modal>
  );
}

/** «18 авг. 14:41» — как у него: без года и без секунд. */
function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const day = date.getDate();
  const month = MONTHS[date.getMonth()];
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${day} ${month} ${time}`;
}

const MONTHS = [
  'янв.', 'фев.', 'мар.', 'апр.', 'мая', 'июн.',
  'июл.', 'авг.', 'сен.', 'окт.', 'ноя.', 'дек.',
];

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  window: {
    width: 640,
    maxWidth: '92%',
    maxHeight: '80%',
    backgroundColor: pos.tile,
    borderRadius: 4,
    shadowColor: pos.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },
  title: { flex: 1, fontFamily: pos.font, fontSize: 20, color: pos.text },
  closeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  close: { fontFamily: pos.font, fontSize: 14, color: pos.muted, letterSpacing: 0.4 },
  key: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 3,
  },
  keyLabel: { fontFamily: pos.font, fontSize: 11, color: pos.muted },

  body: { minHeight: 0 },
  bodyInner: { paddingBottom: 8 },

  card: { borderBottomWidth: 1, borderBottomColor: pos.border, paddingBottom: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, paddingBottom: 12 },
  kind: { fontFamily: pos.font, fontSize: 20, fontWeight: '700', color: pos.text },
  customer: { flex: 1, fontFamily: pos.font, fontSize: 14, color: pos.muted },
  time: { fontFamily: pos.font, fontSize: 14, color: pos.muted },

  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: pos.border,
  },
  lineName: { flex: 1, fontFamily: pos.font, fontSize: 14, color: pos.text },
  lineQty: { fontFamily: pos.font, fontSize: 14, color: pos.text, fontVariant: ['tabular-nums'] },
  linePrice: {
    width: 90,
    textAlign: 'right',
    fontFamily: pos.font,
    fontSize: 14,
    color: pos.text,
    fontVariant: ['tabular-nums'],
  },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 20, padding: 16, paddingLeft: 20 },
  pick: {
    height: 40,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: pos.bar,
    borderRadius: 3,
  },
  pickLabel: { fontFamily: pos.font, fontSize: 14, color: '#FFFFFF', letterSpacing: 0.4 },
  drop: { height: 40, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  dropLabel: { fontFamily: pos.font, fontSize: 14, color: pos.red, letterSpacing: 0.4 },

  empty: {
    fontFamily: pos.font,
    fontSize: 15,
    color: pos.muted,
    textAlign: 'center',
    padding: 40,
  },
});
