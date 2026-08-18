import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../Translated';

import { CashierTerminal } from './CashierTerminal';
import { usePosSettings } from '../../state/PosSettingsProvider';
import { useCashierKeys } from './useCashierKeys';
import { formatMoney, parseMoney } from '../../domain/money';
import { cashOptions, change } from '../../domain/payment';
import type { Kopecks } from '../../domain/money';
import type { CounterpartyWithTotals, PaymentMethod } from '../../domain/types';
import { formatPhone } from '../../db/counterparties';
import { pos } from '../../ui/webTheme';

/**
 * «Принять оплату» — окно кассы, двумя колонками.
 *
 * Слева **«Платежи»**: итог, сколько принято наличными, безналичными и в
 * отсрочку, строка «Принято», комментарий к продаже и переключатель «Печатать
 * чек». Справа **«Принять оплату»**: покупатель, три способа, сумма, варианты
 * оплаты наличными и синяя кнопка «ПРИНЯТЬ … РУБ» с подсказкой ENTER.
 *
 * Двумя колонками, а не одной, потому что **оплата бывает раздельной**: часть
 * наличными, часть картой, остаток в отсрочку. Правая колонка принимает один
 * платёж, левая копит принятое и показывает, сколько ещё осталось. Одной
 * колонкой это не выразить: пришлось бы либо запретить раздельную оплату,
 * либо каждый раз спрашивать «а сколько уже приняли».
 *
 * Отсрочка — долг покупателя: товар отдали, деньги не взяли. Поэтому её нельзя
 * оформить на розничного — долг некому записать.
 */

const METHODS: { id: PaymentMethod | 'credit'; label: string; sign: string }[] = [
  { id: 'cash', label: 'Наличные', sign: '₽' },
  { id: 'card', label: 'Безналичные', sign: '▭' },
  { id: 'credit', label: 'Отсрочка', sign: '◇' },
];

/** Сколько принято каждым способом. */
type Taken = Record<'cash' | 'card' | 'credit', Kopecks>;

const EMPTY: Taken = { cash: 0, card: 0, credit: 0 };

export function CashierPayment({
  visible,
  total,
  customer,
  onClose,
  onPay,
  mode = 'sale',
}: {
  visible: boolean;
  total: Kopecks;
  /** Покупатель чека; null — розничный. */
  customer?: CounterpartyWithTotals | null;
  onClose: () => void;
  /**
   * Чек проведён. `payment` — способ, которым принято больше живых денег: чек
   * хранит один способ, и делить его на три значило бы менять и отчёты,
   * и движение денег. `changeDue` — сдача, `debt` — сколько ушло в отсрочку,
   * то есть осталось за покупателем.
   *
   * Сдачу считает окно, а не касса: только здесь известно, сколько денег
   * положили на прилавок и каким способом. Раньше касса получала «внесено» и
   * вычитала из суммы чека сама — и после отсрочки объявляла сдачу с денег,
   * которых никто не приносил.
   */
  onPay: (
    payment: PaymentMethod,
    changeDue: Kopecks,
    note: string,
    debt: Kopecks,
    /** Сколько чем приняли — для окна «Продажа прошла успешно». */
    taken: { cash: Kopecks; card: Kopecks; credit: Kopecks },
  ) => void;
  /**
   * Продажа или возврат. У возврата деньги идут в обратную сторону: сдачи не
   * бывает, вносить нечего, и вопрос один — чем выдать.
   */
  mode?: 'sale' | 'return';
}) {
  const returning = mode === 'return';

  const [method, setMethod] = useState<'cash' | 'card' | 'credit'>('cash');
  const [amount, setAmount] = useState('');
  const [taken, setTaken] = useState<Taken>(EMPTY);
  const [note, setNote] = useState('');
  // «Печатать чек» открывается тем, что стоит в настройках кассы: у одних
  // печать нужна всегда, у других никогда, и спрашивать об этом каждый чек —
  // лишнее нажатие.
  const printDefault = usePosSettings().settings.printByDefault;
  const [printReceipt, setPrintReceipt] = useState(printDefault);
  /**
   * Ждём терминал.
   *
   * Безналичная оплата не заканчивается нажатием кнопки в программе: карту
   * ещё прикладывают, и до ответа терминала чек проводить нельзя.
   */
  const [terminal, setTerminal] = useState(false);

  const accepted = taken.cash + taken.card + taken.credit;
  const left = Math.max(0, total - accepted);

  // Окно открылось — начинаем с чистого листа и с суммы, которой не хватает.
  useEffect(() => {
    if (!visible) return;
    setMethod('cash');
    setTaken(EMPTY);
    setNote('');
    setTerminal(false);
    setPrintReceipt(printDefault);
    setAmount(String(total / 100));
  }, [visible, total, printDefault]);

  // Введённая сумма следует за остатком, пока её не трогали руками.
  useEffect(() => {
    if (!visible) return;
    setAmount(String(left / 100));
  }, [visible, left]);

  const entered = parseMoney(amount) ?? 0;
  // Наличными приносят больше, чем в чеке, — это сдача, а не переплата.
  const applied = method === 'cash' ? Math.min(entered, left) : Math.min(entered, left);
  const rest = method === 'cash' && !returning ? change(entered, left) : 0;

  /** Принять этот платёж. Хватило на весь чек — проводим. */
  function accept(fromTerminal = false) {
    if (method === 'credit' && !customer) return;
    if (applied <= 0 && left > 0) return;

    // Картой — сначала терминал: пока он не ответил, денег нет.
    if (method === 'card' && !returning && !fromTerminal) {
      setTerminal(true);
      return;
    }

    const next: Taken = { ...taken, [method]: taken[method] + applied };
    const total_ = next.cash + next.card + next.credit;

    if (total_ >= total) {
      // Чек хранит один способ оплаты — тот, которым приняли больше живых
      // денег. Отсрочка способом оплаты быть не может: по ней не приняли
      // ничего, она уходит отдельно, долгом покупателя.
      const winner: PaymentMethod = next.card > next.cash ? 'card' : 'cash';
      onPay(winner, rest, note, next.credit, next);
      return;
    }

    setTaken(next);
  }

  // Пока ждём терминал, клавиши слушает он: Enter там — «успешно».
  useCashierKeys(visible && !terminal, (event) => {
    if (event.key === 'Escape') onClose();
    if (event.key === 'Enter') {
      event.preventDefault();
      accept();
    }
  });

  // Ползунок «Печатать чек» ездит, а не перескакивает.
  const print = useRef(new Animated.Value(printReceipt ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(print, {
      toValue: printReceipt ? 1 : 0,
      duration: 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [printReceipt, print]);

  const creditBlocked = method === 'credit' && !customer;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <CashierTerminal
        visible={terminal}
        amount={applied}
        onClose={() => setTerminal(false)}
        onSuccess={() => {
          setTerminal(false);
          accept(true);
        }}
      />

      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть оплату"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.panel}>
          {/* Левая колонка — что уже принято. */}
          <ScrollView style={styles.left} contentContainerStyle={styles.leftContent}>
            <Text style={styles.title}>Платежи</Text>

            <Line label="Итог" value={formatMoney(total)} strong />
            <Line label="Наличные" value={formatMoney(taken.cash)} />
            <Line label="Безналичные" value={formatMoney(taken.card)} />
            <Line label="Отсрочка" value={formatMoney(taken.credit)} />
            <Line label="Принято" value={formatMoney(accepted)} strong />
            {left > 0 && accepted > 0 ? (
              <Line label="Осталось" value={formatMoney(left)} accent />
            ) : null}

            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={returning ? 'Комментарий к возврату' : 'Комментарий к продаже'}
              placeholderTextColor={pos.muted}
              multiline
              accessibilityLabel="Комментарий"
              style={styles.note}
            />

            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: printReceipt }}
              accessibilityLabel="Печатать чек"
              onPress={() => setPrintReceipt((on) => !on)}
              style={styles.printRow}
            >
              <Text style={styles.printLabel}>Печатать чек</Text>
              {/* Цвет дорожки — обычным стилем, а не разгоном: цвета кассы
                  заданы переменными CSS, а `Animated` умеет разгонять только
                  настоящие цвета и на `var(...)` спотыкается. Ездит кружок —
                  это и есть движение, которое видно. */}
              <Animated.View
                style={[styles.track, printReceipt ? styles.trackOn : null]}
              >
                <Animated.View
                  style={[
                    styles.knob,
                    {
                      transform: [
                        {
                          translateX: print.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, 24],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              </Animated.View>
            </Pressable>

            <Pressable accessibilityRole="button" onPress={onClose} style={styles.cancel}>
              <Text style={styles.cancelLabel}>
                {returning ? 'Отменить возврат' : 'Отменить чек'}
              </Text>
            </Pressable>
          </ScrollView>

          {/* Правая колонка — этот платёж. */}
          <ScrollView style={styles.right} contentContainerStyle={styles.rightContent}>
            <Text style={styles.title}>{returning ? 'Выдать возврат' : 'Принять оплату'}</Text>

            <View style={styles.customer}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials(customer?.name)}</Text>
              </View>
              <View style={styles.customerText}>
                <Text style={styles.customerName} numberOfLines={1}>
                  {customer?.name ?? 'Розничный покупатель'}
                </Text>
                {customer?.phone ? (
                  <Text style={styles.customerPhone}>{formatPhone(customer.phone)}</Text>
                ) : null}
              </View>
            </View>

            <View style={styles.methods}>
              {METHODS.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: method === item.id }}
                  accessibilityLabel={item.label}
                  onPress={() => setMethod(item.id as 'cash' | 'card' | 'credit')}
                  style={[styles.method, method === item.id && styles.methodOn]}
                >
                  <Text style={[styles.methodSign, method === item.id && styles.methodSignOn]}>
                    {item.sign}
                  </Text>
                  <Text style={[styles.methodLabel, method === item.id && styles.methodLabelOn]}>
                    {item.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Сумма</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              accessibilityLabel="Сумма оплаты"
              style={styles.amount}
            />

            {creditBlocked ? (
              <Text style={styles.warning}>
                Отсрочку не на кого записать: выберите покупателя в чеке.
              </Text>
            ) : null}

            {method === 'cash' && !returning ? (
              <>
                <Text style={styles.fieldLabel}>Варианты оплаты наличными</Text>
                <View style={styles.options}>
                  {cashOptions(left).map((option) => (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityLabel={`Принять ${formatMoney(option)}`}
                      onPress={() => setAmount(String(option / 100))}
                      style={styles.option}
                    >
                      <Text style={styles.optionLabel}>{formatMoney(option)}</Text>
                    </Pressable>
                  ))}
                </View>

                {rest > 0 ? (
                  <View style={styles.changeRow}>
                    <Text style={styles.changeLabel}>Сдача</Text>
                    <Text style={styles.changeValue}>{formatMoney(rest)} руб</Text>
                  </View>
                ) : null}
              </>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: creditBlocked }}
              onPress={() => accept()}
              style={[styles.confirm, creditBlocked && styles.confirmOff]}
            >
              <Text style={styles.confirmLabel}>
                {returning ? 'ВЕРНУТЬ' : 'ПРИНЯТЬ'} {formatMoney(applied)} РУБ
              </Text>
              <View style={styles.key}>
                <Text style={styles.keyLabel}>ENTER</Text>
              </View>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Line({
  label,
  value,
  strong,
  accent,
}: {
  label: string;
  value: string;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, strong && styles.lineStrong]}>{label}</Text>
      <Text style={[styles.lineValue, strong && styles.lineStrong, accent && styles.lineAccent]}>
        {value} руб
      </Text>
    </View>
  );
}

/** «Фирсов Алексей» → «ФА». */
function initials(name: string | undefined): string {
  if (!name) return '—';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.slice(0, 1).toUpperCase())
    .join('');
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    flexDirection: 'row',
    width: 900,
    maxWidth: '96%',
    maxHeight: '92%',
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    zIndex: 1,
  },

  left: { flex: 1, borderRightWidth: 1, borderRightColor: pos.border },
  leftContent: { padding: 26, gap: 10 },
  right: { flex: 1.1 },
  rightContent: { padding: 26, gap: 14 },

  title: { fontFamily: pos.font, fontSize: 20, color: pos.text, marginBottom: 8 },

  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },
  lineLabel: { fontFamily: pos.font, fontSize: 13, color: pos.muted },
  lineValue: {
    fontFamily: pos.font,
    fontSize: 13,
    color: pos.text,
    fontVariant: ['tabular-nums'],
  },
  lineStrong: { color: pos.text, fontWeight: '700' },
  lineAccent: { color: pos.accent },

  note: { outlineWidth: 0,
    minHeight: 70,
    marginTop: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 4,
    fontFamily: pos.font,
    fontSize: 13,
    color: pos.text,
    textAlignVertical: 'top',
  },
  printRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  printLabel: { fontFamily: pos.font, fontSize: 14, color: pos.text },
  trackOn: { backgroundColor: pos.bar },
  track: { width: 44, height: 20, borderRadius: 10, backgroundColor: '#D4D4D5', padding: 2 },
  knob: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#FFFFFF' },

  cancel: { marginTop: 16, alignItems: 'center', paddingVertical: 10 },
  cancelLabel: { fontFamily: pos.font, fontSize: 13, color: pos.muted },

  customer: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: pos.bar,
  },
  avatarText: { fontFamily: pos.font, fontSize: 13, color: '#FFFFFF', fontWeight: '700' },
  customerText: { flex: 1 },
  customerName: { fontFamily: pos.font, fontSize: 14, color: pos.text },
  customerPhone: { fontFamily: pos.font, fontSize: 13, color: pos.bar },

  methods: { flexDirection: 'row', gap: 10 },
  method: {
    flex: 1,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 4,
  },
  methodOn: { backgroundColor: pos.bar, borderColor: pos.bar },
  methodSign: { fontFamily: pos.font, fontSize: 16, color: pos.bar },
  methodSignOn: { color: '#FFFFFF' },
  methodLabel: { fontFamily: pos.font, fontSize: 12, color: pos.muted },
  methodLabelOn: { color: '#FFFFFF' },

  fieldLabel: { fontFamily: pos.font, fontSize: 13, color: pos.muted },
  amount: {
    height: 48,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: pos.accent,
    borderRadius: 4,
    fontFamily: pos.font,
    fontSize: 19,
    color: pos.text,
    fontVariant: ['tabular-nums'],
  },
  warning: { fontFamily: pos.font, fontSize: 13, color: pos.accent },

  options: { flexDirection: 'row', flexWrap: 'wrap' },
  option: {
    paddingHorizontal: 12,
    height: 36,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: pos.border,
    marginLeft: -1,
    marginTop: -1,
  },
  optionLabel: {
    fontFamily: pos.font,
    fontSize: 13,
    color: pos.text,
    fontVariant: ['tabular-nums'],
  },

  changeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  changeLabel: { fontFamily: pos.font, fontSize: 14, color: pos.muted },
  changeValue: {
    fontFamily: pos.font,
    fontSize: 16,
    color: pos.text,
    fontVariant: ['tabular-nums'],
  },

  confirm: {
    marginTop: 8,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    borderRadius: 4,
    backgroundColor: pos.bar,
  },
  confirmOff: { opacity: 0.5 },
  confirmLabel: { fontFamily: pos.font, fontSize: 15, color: '#FFFFFF', letterSpacing: 0.6 },
  key: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 3,
  },
  keyLabel: { fontFamily: pos.font, fontSize: 11, color: '#FFFFFF' },
});
