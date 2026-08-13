import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatMoneyWeb, parseMoney } from '../../domain/money';
import { cashOptions, change, enough } from '../../domain/payment';
import type { Kopecks } from '../../domain/money';
import type { PaymentMethod } from '../../domain/types';
import { pos } from '../../ui/webTheme';

/**
 * Окно оплаты чека — «Принять оплату».
 *
 * Собрано его экраном: сверху итог, ниже переключатель «Наличные /
 * Банковская карта», у наличных — поле внесённой суммы, ряд подсказок
 * «Варианты оплаты наличными» и строка «Сдача».
 *
 * До этого оплаты не было вовсе: кнопка «ПРОДАЖА» сразу проводила чек
 * наличными и молчала, если чего-то не хватало. Кассир не мог ни выбрать
 * способ оплаты, ни посчитать сдачу, а на любой ошибке чек просто пропадал.
 */
export function CashierPayment({
  visible,
  total,
  onClose,
  onPay,
  mode = 'sale',
}: {
  visible: boolean;
  total: Kopecks;
  onClose: () => void;
  onPay: (payment: PaymentMethod, tendered: Kopecks) => void;
  /**
   * Продажа или возврат.
   *
   * У возврата деньги идут в обратную сторону: сдачи не бывает, вносить
   * нечего, и вопрос здесь один — чем выдать, из кассы или на карту.
   */
  mode?: 'sale' | 'return';
}) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [tendered, setTendered] = useState('');

  const returning = mode === 'return';

  // По карте платят ровно столько, сколько в чеке: сдачи с карты не бывает.
  const given =
    returning || method !== 'cash'
      ? total
      : tendered.trim()
        ? (parseMoney(tendered) ?? 0)
        : total;
  const rest = change(given, total);
  const ready = enough(given, total);

  const finish = (amount: Kopecks) => {
    onPay(method, amount);
    setTendered('');
    setMethod('cash');
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть оплату"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.panel}>
          <Text style={styles.title}>{returning ? 'Выдать возврат' : 'Принять оплату'}</Text>

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Итог</Text>
            <Text style={styles.totalValue}>{formatMoneyWeb(total)} руб</Text>
          </View>

          <View style={styles.methods}>
            {(
              [
                ['cash', 'Наличные'],
                ['card', 'Банковская карта'],
              ] as [PaymentMethod, string][]
            ).map(([value, label]) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: method === value }}
                onPress={() => setMethod(value)}
                style={[styles.method, method === value && styles.methodOn]}
              >
                <Text style={[styles.methodLabel, method === value && styles.methodLabelOn]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          {returning ? (
            <Text style={styles.hint}>
              {method === 'cash'
                ? 'Выдайте покупателю деньги из кассы, затем подтвердите возврат.'
                : 'Верните оплату на карту через терминал, затем подтвердите возврат.'}
            </Text>
          ) : method === 'cash' ? (
            <>
              <Text style={styles.label}>Получено от покупателя</Text>
              <TextInput
                value={tendered}
                onChangeText={setTendered}
                placeholder={formatMoneyWeb(total)}
                placeholderTextColor={pos.muted}
                keyboardType="decimal-pad"
                style={styles.input}
              />

              <Text style={styles.label}>Варианты оплаты наличными</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.options}>
                  {cashOptions(total).map((option) => (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      onPress={() => finish(option)}
                      style={styles.option}
                    >
                      <Text style={styles.optionLabel}>{formatMoneyWeb(option)}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>

              <View style={styles.changeRow}>
                <Text style={styles.changeLabel}>Сдача</Text>
                <Text style={styles.changeValue}>{formatMoneyWeb(rest)} руб</Text>
              </View>
            </>
          ) : (
            <Text style={styles.hint}>
              Примите оплату через терминал, затем подтвердите чек.
            </Text>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !ready }}
            onPress={() => ready && finish(given)}
            style={[styles.confirm, !ready && styles.confirmOff]}
          >
            <Text style={styles.confirmLabel}>
              {returning
                ? `Вернуть ${formatMoneyWeb(total)} руб`
                : ready
                  ? `Оплатить ${formatMoneyWeb(total)} руб`
                  : 'Не хватает внесённого'}
            </Text>
          </Pressable>

          <Pressable accessibilityRole="button" onPress={onClose} style={styles.cancel}>
            <Text style={styles.cancelLabel}>{returning ? 'Отменить возврат' : 'Отменить чек'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  panel: {
    width: 520,
    maxWidth: '94%',
    maxHeight: '92%',
    padding: 26,
    gap: 12,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    zIndex: 1,
  },
  title: { fontFamily: pos.font, fontSize: 24, color: pos.text },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  totalLabel: { fontFamily: pos.font, fontSize: 16, color: pos.muted },
  totalValue: { fontFamily: pos.font, fontSize: 30, fontWeight: '700', color: pos.text },
  methods: { flexDirection: 'row', gap: 10, marginTop: 6 },
  method: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 13,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: pos.border,
  },
  methodOn: { backgroundColor: pos.bar, borderColor: pos.bar },
  methodLabel: { fontFamily: pos.font, fontSize: 16, color: pos.text },
  methodLabelOn: { color: '#FFFFFF' },
  label: { fontFamily: pos.font, fontSize: 14, color: pos.muted, marginTop: 8 },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 4,
    paddingHorizontal: 14,
    fontFamily: pos.font,
    fontSize: 22,
    color: pos.text,
  },
  options: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  option: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: pos.border,
  },
  optionLabel: { fontFamily: pos.font, fontSize: 17, color: pos.text },
  changeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 6,
  },
  changeLabel: { fontFamily: pos.font, fontSize: 16, color: pos.muted },
  changeValue: { fontFamily: pos.font, fontSize: 22, fontWeight: '700', color: pos.green },
  hint: { fontFamily: pos.font, fontSize: 15, color: pos.muted, lineHeight: 22, marginVertical: 14 },
  confirm: {
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 4,
    backgroundColor: pos.green,
    marginTop: 10,
  },
  confirmOff: { backgroundColor: pos.border },
  confirmLabel: { fontFamily: pos.font, fontSize: 18, color: '#FFFFFF' },
  cancel: { alignItems: 'center', paddingVertical: 10 },
  cancelLabel: { fontFamily: pos.font, fontSize: 15, color: pos.muted },
});
