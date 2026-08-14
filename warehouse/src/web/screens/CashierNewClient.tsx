import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useCashierKeys } from './useCashierKeys';
import { createCounterparty, listCounterparties } from '../../db/counterparties';
import { getSettings } from '../../db/settings';
import type { CounterpartyWithTotals } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { say } from '../../ui/alert';
import { WebIcon } from '../../ui/icons';
import { pos } from '../../ui/webTheme';

/**
 * «Создание клиента» — окно кассы, оранжевая кнопка справа вверху.
 *
 * Клиента заводят у прилавка, пока он стоит рядом: имя, телефон, и сразу —
 * что ему дать, скидку или бонусы. Поэтому окно устроено как их: обязательное
 * имя в оранжевой рамке, телефоны (их бывает несколько), почта, выбор
 * «Скидка / Бонусы», готовые проценты одной строкой и дисконтная карта.
 *
 * Раньше эта кнопка открывала список клиентов — то есть отвечала не на тот
 * вопрос: список нужен, чтобы найти, а тут нужно завести.
 */
export function CashierNewClient({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  /** Заведённого клиента сразу ставим в чек: за этим его и заводили. */
  onCreated: (customer: CounterpartyWithTotals) => void;
}) {
  const { db, refresh } = useDatabase();
  const settings = useQuery((database) => getSettings(database));

  const [name, setName] = useState('');
  const [phones, setPhones] = useState<string[]>(['']);
  const [email, setEmail] = useState('');
  const [loyalty, setLoyalty] = useState<'discount' | 'bonus'>('discount');
  const [discount, setDiscount] = useState(0);
  const [savings, setSavings] = useState(false);
  const [card, setCard] = useState('');
  const [birthday, setBirthday] = useState('');

  useEffect(() => {
    if (visible) return;
    setName('');
    setPhones(['']);
    setEmail('');
    setLoyalty('discount');
    setDiscount(0);
    setSavings(false);
    setCard('');
    setBirthday('');
  }, [visible]);

  function create(): void {
    if (name.trim().length < 2) {
      say('Нужно имя', 'Имя покупателя — обязательное поле.');
      return;
    }

    const clean = phones.map((phone) => phone.trim()).filter(Boolean);
    const id = createCounterparty(db, {
      kind: 'customer',
      name: name.trim(),
      phones: clean,
      email: email.trim() || null,
      loyalty_type: loyalty,
      discount_bp: loyalty === 'discount' ? discount : 0,
      enable_savings: savings,
      discount_card: card.trim() || null,
      birthday: birthday.trim() || null,
    });
    refresh();

    const created = listCounterparties(db, { kind: 'customer' }).find((party) => party.id === id);
    if (created) onCreated(created);
    onClose();
  }

  useCashierKeys(visible, (event) => {
    if (event.key === 'Escape') onClose();
    if (event.key === 'Enter') {
      event.preventDefault();
      create();
    }
  });

  const presets = settings.presetDiscounts.length ? settings.presetDiscounts : [300, 500, 700, 800, 1000];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть создание клиента"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />

        <View style={styles.panel}>
          <View style={styles.head}>
            <Text style={styles.title}>Создание клиента</Text>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeRow}>
              <Text style={styles.closeLabel}>ЗАКРЫТЬ</Text>
              <View style={styles.key}>
                <Text style={styles.keyLabel}>ESC</Text>
              </View>
            </Pressable>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {/* Имя обязательно, и рамка у него оранжевая — так у них помечено
                единственное поле, без которого клиента не завести. */}
            <View style={[styles.field, styles.fieldRequired]}>
              <View style={styles.fieldLabelBox}>
                <Text style={[styles.fieldLabel, styles.fieldLabelRequired]}>
                  Имя покупателя <Text style={styles.star}>*</Text>
                </Text>
              </View>
              <TextInput
                value={name}
                onChangeText={setName}
                accessibilityLabel="Имя покупателя"
                style={styles.input}
              />
              <WebIcon.parties size={22} color={pos.text} />
            </View>

            <View style={styles.phonesHead}>
              <Text style={styles.sectionLabel}>Телефон</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPhones((list) => [...list, ''])}
                style={styles.addPhone}
              >
                <Text style={styles.addPhonePlus}>+</Text>
                <Text style={styles.addPhoneLabel}>ДОБАВИТЬ НОМЕР ТЕЛЕФОНА</Text>
              </Pressable>
            </View>

            {phones.map((phone, index) => (
              <View key={index} style={styles.field}>
                <TextInput
                  value={phone}
                  onChangeText={(value) =>
                    setPhones((list) => list.map((item, i) => (i === index ? value : item)))
                  }
                  placeholder="Телефон"
                  placeholderTextColor={pos.muted}
                  keyboardType="phone-pad"
                  accessibilityLabel={`Телефон ${index + 1}`}
                  style={styles.input}
                />
                <WebIcon.phone size={20} color={pos.text} />
              </View>
            ))}

            <View style={styles.field}>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Email"
                placeholderTextColor={pos.muted}
                keyboardType="email-address"
                accessibilityLabel="Email"
                style={styles.input}
              />
              <Text style={styles.at}>@</Text>
            </View>

            {/* Скидка или бонусы — одно из двух: копить и то и другое значило
                бы давать одну и ту же выгоду дважды. */}
            <View style={styles.choice}>
              {(
                [
                  ['discount', 'Скидка'],
                  ['bonus', 'Бонусы'],
                ] as ['discount' | 'bonus', string][]
              ).map(([id, label]) => (
                <Pressable
                  key={id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: loyalty === id }}
                  onPress={() => setLoyalty(id)}
                  style={styles.choiceTile}
                >
                  <View style={[styles.radio, loyalty === id && styles.radioOn]}>
                    {loyalty === id ? <View style={styles.radioDot} /> : null}
                  </View>
                  <Text style={styles.choiceLabel}>{label}</Text>
                </Pressable>
              ))}
            </View>

            {loyalty === 'discount' ? (
              <View style={styles.box}>
                <Text style={styles.boxLabel}>Скидка</Text>
                <View style={styles.presets}>
                  {presets.map((preset) => (
                    <Pressable
                      key={preset}
                      accessibilityRole="button"
                      accessibilityState={{ selected: discount === preset }}
                      accessibilityLabel={`Скидка ${preset / 100} процентов`}
                      onPress={() => setDiscount(discount === preset ? 0 : preset)}
                      style={[styles.preset, discount === preset && styles.presetOn]}
                    >
                      <Text
                        style={[styles.presetLabel, discount === preset && styles.presetLabelOn]}
                      >
                        {preset / 100}%
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: savings }}
                  onPress={() => setSavings((was) => !was)}
                  style={styles.checkRow}
                >
                  <View style={[styles.check, savings && styles.checkOn]}>
                    {savings ? <Text style={styles.checkMark}>✓</Text> : null}
                  </View>
                  <Text style={styles.checkLabel}>Учитывать накопительные скидки</Text>
                </Pressable>
              </View>
            ) : (
              /* Правила бонусов — не текст в кассе, а настройки компании
                 («Лояльность / Бонусы»). Кассир должен видеть их такими,
                 какие они сейчас: обещать «3 %», когда в настройках 5,
                 хуже, чем не обещать ничего. */
              <View style={styles.info}>
                <WebIcon.info size={20} color={pos.bar} />
                <View style={styles.infoText}>
                  <Text style={styles.infoLine}>
                    {settings.cashbackRateBp / 100}% с покупки на бонусный счет
                  </Text>
                  <Text style={styles.infoLine}>
                    {settings.bonusLimitBp / 100}% чека можно оплатить бонусами
                  </Text>
                  <Text style={styles.infoLine}>
                    1 бонус = {settings.redemptionRateBp / 10000} руб скидки в чеке
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.field}>
              <TextInput
                value={card}
                onChangeText={setCard}
                placeholder="Дисконтная карта"
                placeholderTextColor={pos.muted}
                accessibilityLabel="Дисконтная карта"
                style={styles.input}
              />
              <WebIcon.billing size={20} color={pos.text} />
            </View>

            {/* День рождения — последняя строка: ради него и заводят карточку
                тем, кто заходит редко. */}
            <View style={styles.field}>
              <TextInput
                value={birthday}
                onChangeText={setBirthday}
                placeholder="Дата рождения"
                placeholderTextColor={pos.muted}
                accessibilityLabel="Дата рождения"
                style={styles.input}
              />
              <WebIcon.calendar size={20} color={pos.text} />
            </View>
          </ScrollView>

          <Pressable accessibilityRole="button" onPress={create} style={styles.create}>
            <Text style={styles.createLabel}>СОЗДАТЬ</Text>
            <View style={styles.createKey}>
              <Text style={styles.createKeyLabel}>ENTER</Text>
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
    width: 620,
    maxWidth: '94%',
    maxHeight: '92%',
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    overflow: 'hidden',
    zIndex: 1,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 26,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },
  title: { fontFamily: pos.font, fontSize: 24, color: pos.text },
  closeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  closeLabel: { fontFamily: pos.font, fontSize: 15, color: pos.muted, letterSpacing: 0.6 },
  key: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 3,
  },
  keyLabel: { fontFamily: pos.font, fontSize: 12, color: pos.muted },

  body: { flexGrow: 0 },
  bodyContent: { padding: 26, gap: 18 },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 62,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 6,
  },
  fieldRequired: { borderColor: pos.accent },
  fieldLabelBox: {
    position: 'absolute',
    top: -9,
    left: 12,
    paddingHorizontal: 6,
    backgroundColor: '#FFFFFF',
  },
  fieldLabel: { fontFamily: pos.font, fontSize: 13, color: pos.muted },
  fieldLabelRequired: { color: pos.accent },
  star: { color: pos.accent },
  input: {
    flex: 1,
    minWidth: 0,
    outlineWidth: 0,
    fontFamily: pos.font,
    fontSize: 18,
    color: pos.text,
  },
  at: { fontFamily: pos.font, fontSize: 22, color: pos.text },

  phonesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { fontFamily: pos.font, fontSize: 17, color: pos.muted },
  addPhone: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 6 },
  addPhonePlus: { fontFamily: pos.font, fontSize: 20, color: pos.bar },
  addPhoneLabel: { fontFamily: pos.font, fontSize: 15, color: pos.bar, letterSpacing: 0.4 },

  choice: { flexDirection: 'row', gap: 16 },
  choiceTile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    height: 62,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 6,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: pos.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: pos.bar },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: pos.bar },
  choiceLabel: { fontFamily: pos.font, fontSize: 18, color: pos.text },

  box: { padding: 18, borderWidth: 1, borderColor: pos.border, borderRadius: 6, gap: 14 },
  boxLabel: { fontFamily: pos.font, fontSize: 15, color: pos.muted },

  presets: { flexDirection: 'row', borderWidth: 1, borderColor: pos.accent, borderRadius: 4 },
  preset: {
    flex: 1,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: pos.accent,
  },
  presetOn: { backgroundColor: pos.accent },
  presetLabel: { fontFamily: pos.font, fontSize: 17, color: pos.accent },
  presetLabelOn: { color: '#FFFFFF' },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  check: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: pos.text,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: pos.bar, borderColor: pos.bar },
  checkMark: { fontFamily: pos.font, fontSize: 15, color: '#FFFFFF' },
  checkLabel: { fontFamily: pos.font, fontSize: 17, color: pos.text },

  // Голубая плашка с правилами бонусов — её же.
  info: {
    flexDirection: 'row',
    gap: 14,
    padding: 18,
    backgroundColor: '#E8F1FB',
    borderRadius: 6,
  },
  infoText: { flex: 1, gap: 4 },
  infoLine: { fontFamily: pos.font, fontSize: 16, color: pos.bar, lineHeight: 22 },

  create: {
    height: 66,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    backgroundColor: pos.accent,
  },
  createLabel: { fontFamily: pos.font, fontSize: 19, color: '#FFFFFF', letterSpacing: 0.8 },
  createKey: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: 3,
  },
  createKeyLabel: { fontFamily: pos.font, fontSize: 12, color: '#FFFFFF' },
});
