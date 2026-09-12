import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../Translated';

import { useCashierKeys } from './useCashierKeys';
import { getSettings } from '../../db/settings';
import { discountFromPercent, percentFromDiscount } from '../../domain/cart';
import { formatMoney, parseMoney, type Kopecks } from '../../domain/money';
import { useQuery } from '../../state/DatabaseProvider';
import { pos } from '../../ui/webTheme';

/**
 * «Размер скидки» — окно кассы.
 *
 * Скидку называют двумя способами: «десять процентов» и «скинь семьдесят
 * рублей». Поэтому у него в окне переключатель **% / РУБ**, и кассир вводит
 * то, что услышал, а не считает в уме. Хранится при этом одна величина —
 * сумма в копейках; процент от неё производен, и вернуться от одного к
 * другому можно в любой момент.
 *
 * Ряд быстрых процентов под полем — предустановленные скидки компании
 * («Лояльность / Скидки»). Не выдуманные пять чисел: их заводят под свою
 * торговлю, и на кассе жмут именно их.
 *
 * Сумма справа сверху — сколько это в деньгах при текущем чеке. Она и есть
 * ответ на вопрос «а сколько скинули»: процент сам по себе на него не
 * отвечает.
 */
export function CashierDiscount({
  visible,
  subtotal,
  discount,
  onClose,
  onApply,
}: {
  visible: boolean;
  /** Сумма чека до скидки, копейки. */
  subtotal: Kopecks;
  /** Текущая скидка, копейки. */
  discount: Kopecks;
  onClose: () => void;
  /**
   * Скидка суммой и, если её задали процентом, сам процент.
   *
   * Процент нужен, чтобы скидка держалась при доборе чека: «десять процентов»
   * на чек из одной позиции и на чек из трёх — это разные деньги, а обещали
   * покупателю проценты.
   */
  onApply: (discount: Kopecks, percent: number | null) => void;
}) {
  const settings = useQuery((database) => getSettings(database));

  const [mode, setMode] = useState<'percent' | 'money'>('percent');
  const [value, setValue] = useState('');

  // Окно открылось — показываем то, что уже стоит в чеке.
  useEffect(() => {
    if (!visible) return;
    setMode('percent');
    setValue(discount > 0 ? String(percentFromDiscount(subtotal, discount)) : '');
  }, [visible, discount, subtotal]);

  /** Сколько это в копейках при текущем чеке. */
  const asMoney = (): Kopecks => {
    if (mode === 'money') return Math.min(parseMoney(value) ?? 0, subtotal);
    const percent = Number(value.replace(',', '.')) || 0;
    return discountFromPercent(subtotal, percent);
  };

  const money = asMoney();

  const apply = () => {
    onApply(money, mode === 'percent' ? Number(value.replace(',', '.')) || 0 : null);
    onClose();
  };

  /** Переключение % ↔ РУБ пересчитывает набранное, а не стирает его. */
  const switchTo = (next: 'percent' | 'money') => {
    if (next === mode) return;
    const current = asMoney();
    setMode(next);
    setValue(
      next === 'money'
        ? String(current / 100)
        : String(percentFromDiscount(subtotal, current)),
    );
  };

  // Быстрые проценты — предустановленные скидки компании.
  const presets = settings.presetDiscounts.length
    ? settings.presetDiscounts
    : // Пока их не завели, ряд пуст: подсовывать выдуманные проценты вместо
      // настроенных значило бы обещать скидку, которой в компании нет.
      [];

  useCashierKeys(visible, (event) => {
    if (event.key === 'Escape') onClose();
    if (event.key === 'Enter') {
      event.preventDefault();
      apply();
    }
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть скидку"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.panel}>
          <View style={styles.head}>
            <Text style={styles.title}>Размер скидки</Text>
            <Text style={styles.amount}>{formatMoney(money)} руб</Text>
          </View>

          <View style={styles.modes}>
            {(
              [
                ['percent', '%'],
                ['money', 'РУБ'],
              ] as ['percent' | 'money', string][]
            ).map(([id, label]) => (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityState={{ selected: mode === id }}
                accessibilityLabel={id === 'percent' ? 'Скидка в процентах' : 'Скидка в рублях'}
                onPress={() => switchTo(id)}
                style={[styles.mode, mode === id && styles.modeOn]}
              >
                <Text style={[styles.modeLabel, mode === id && styles.modeLabelOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.inputRow}>
            <TextInput
              value={value}
              onChangeText={setValue}
              keyboardType="decimal-pad"
              accessibilityLabel="Размер скидки"
              style={styles.input}
            />
            <Text style={styles.unit}>{mode === 'percent' ? '%' : 'руб'}</Text>
          </View>

          {presets.length > 0 ? (
            <View style={styles.presets}>
              {presets.map((preset) => (
                <Pressable
                  key={preset}
                  accessibilityRole="button"
                  accessibilityLabel={`Скидка ${preset / 100} процентов`}
                  onPress={() => {
                    setMode('percent');
                    setValue(String(preset / 100));
                  }}
                  style={styles.preset}
                >
                  <Text style={styles.presetLabel}>{preset / 100}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.hint}>
              Готовые скидки заводятся в «Компания / Лояльность / Скидки».
            </Text>
          )}

          <Pressable
            accessibilityRole="button"
            onPress={apply}
            style={styles.done}
          >
            <Text style={styles.doneLabel}>ГОТОВО</Text>
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
    width: 420,
    maxWidth: '94%',
    backgroundColor: pos.tile,
    borderRadius: 6,
    paddingTop: 20,
    overflow: 'hidden',
    zIndex: 1,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
  },
  title: { fontFamily: pos.font, fontSize: 18, color: pos.text },
  amount: { fontFamily: pos.font, fontSize: 15, color: pos.muted, fontVariant: ['tabular-nums'] },

  modes: { flexDirection: 'row', marginTop: 16, marginHorizontal: 22 },
  mode: {
    flex: 1,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: pos.border,
    marginLeft: -1,
  },
  modeOn: { backgroundColor: pos.accent, borderColor: pos.accent },
  modeLabel: { fontFamily: pos.font, fontSize: 14, color: pos.muted },
  modeLabelOn: { color: '#FFFFFF', fontWeight: '700' },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 22,
    marginTop: 16,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },
  input: { outlineWidth: 0,
    flex: 1,
    height: 46,
    fontFamily: pos.font,
    fontSize: 19,
    color: pos.text,
    fontVariant: ['tabular-nums'],
  },
  unit: { fontFamily: pos.font, fontSize: 15, color: pos.muted },

  presets: { flexDirection: 'row', marginHorizontal: 22, marginTop: 14 },
  preset: {
    flex: 1,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: pos.border,
    marginLeft: -1,
  },
  presetLabel: { fontFamily: pos.font, fontSize: 14, color: pos.text },
  hint: {
    fontFamily: pos.font,
    fontSize: 13,
    color: pos.muted,
    marginHorizontal: 22,
    marginTop: 14,
  },

  done: {
    marginTop: 22,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: pos.bar,
  },
  doneLabel: { fontFamily: pos.font, fontSize: 15, color: '#FFFFFF', letterSpacing: 0.8 },
});
