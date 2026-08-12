import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { getSettings, saveSettings, type CompanySettings } from '../src/db/settings';
import { formatMoneyWeb, parseMoney } from '../src/domain/money';
import { parsePercent } from '../src/domain/pricing';
import { useDatabase, useQuery } from '../src/state/DatabaseProvider';
import { say } from '../src/ui/alert';
import { FORM_BORDER, web, WEB_FONT } from '../src/ui/webTheme';
import { ToolButton } from '../src/web/Table';

/**
 * «Компания / Лояльность» — две вкладки его экрана.
 *
 * **Бонусная система**: курс начисления, курс списания, лимит оплаты,
 * стартовые бонусы и бонусы на день рождения. Формулировки его же — они
 * собраны из шаблона фразой, а не подписью к полю: «Каждые 100 ₽ в чеке =
 * 1 бонус на счет» читается сразу, а «Курс начисления: 100 / 1» — нет.
 *
 * **Скидки**: предустановленные скидки и правила накопительных — «Сумма
 * больше чем: … → Скидка …».
 *
 * Начисление бонусов на кассе ещё не сделано: это отдельная работа, и она
 * потребует трогать чек. Здесь заводятся сами правила, и они уже видны в
 * наборе колонок «Лояльность» у клиентов.
 */

type Tab = 'bonus' | 'discounts';

const TABS: { value: Tab; label: string }[] = [
  { value: 'bonus', label: 'Бонусная система' },
  { value: 'discounts', label: 'Скидки' },
];

export default function LoyaltyScreen() {
  const { db, refresh } = useDatabase();
  const saved = useQuery((database) => getSettings(database));

  const [tab, setTab] = useState<Tab>('bonus');
  const [draft, setDraft] = useState<CompanySettings>(saved);

  const set = (patch: Partial<CompanySettings>) =>
    setDraft((current) => ({ ...current, ...patch }));

  function save() {
    saveSettings(db, draft);
    refresh();
    say('Сохранено', 'Настройки лояльности обновлены.');
  }

  return (
    <View style={styles.screen}>
      <View style={styles.tabs}>
        {TABS.map((item) => (
          <Pressable
            key={item.value}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === item.value }}
            onPress={() => setTab(item.value)}
            style={[styles.tab, tab === item.value && styles.tabActive]}
          >
            <Text style={[styles.tabLabel, tab === item.value && styles.tabLabelActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {tab === 'bonus' ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Настройки программы</Text>

            <Toggle
              label={draft.bonusOn ? 'Бонусная программа активна' : 'Бонусная система не активна'}
              on={draft.bonusOn}
              onChange={(bonusOn) => set({ bonusOn })}
            />

            <Text style={styles.label}>Курс начисления</Text>
            <Phrase>
              <Text style={styles.phrase}>{draft.bonusPerRubles === 1 ? 'Каждый' : 'Каждые'}</Text>
              <Number
                value={draft.bonusPerRubles}
                onChange={(bonusPerRubles) => set({ bonusPerRubles })}
              />
              <Text style={styles.phrase}>₽ в чеке =</Text>
              <Number value={draft.bonusEarned} onChange={(bonusEarned) => set({ bonusEarned })} />
              <Text style={styles.phrase}>{plural(draft.bonusEarned)} на счет</Text>
            </Phrase>

            <Text style={styles.label}>Курс списания</Text>
            <Phrase>
              <Number value={draft.bonusSpend} onChange={(bonusSpend) => set({ bonusSpend })} />
              <Text style={styles.phrase}>{plural(draft.bonusSpend)} =</Text>
              <Number
                value={draft.bonusSpendRubles}
                onChange={(bonusSpendRubles) => set({ bonusSpendRubles })}
              />
              <Text style={styles.phrase}>₽ скидки в чеке</Text>
            </Phrase>

            <Text style={styles.label}>Лимит оплаты</Text>
            <Phrase>
              <Number
                value={draft.bonusLimitBp / 100}
                onChange={(value) => set({ bonusLimitBp: Math.round(value * 100) })}
              />
              <Text style={styles.phrase}>% чека можно оплатить бонусами</Text>
            </Phrase>

            <Text style={styles.label}>Стартовые бонусы</Text>
            <Money
              value={draft.bonusStart}
              onChange={(bonusStart) => set({ bonusStart })}
            />
            <Text style={styles.hint}>Поступят на счет нового покупателя</Text>

            <Text style={styles.label}>Бонусы на День рождения</Text>
            <Money
              value={draft.bonusBirthday}
              onChange={(bonusBirthday) => set({ bonusBirthday })}
            />
            <Text style={styles.hint}>Поступят на счет клиента в его День рождения</Text>

            <Text style={styles.note}>
              Правила заводятся здесь, но на кассе бонусы пока не начисляются и не списываются —
              это отдельная работа, и она трогает чек. Заведённые значения уже видны в наборе
              колонок «Лояльность» у клиентов.
            </Text>
          </View>
        ) : null}

        {tab === 'discounts' ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>Предустановленные скидки</Text>
            <Text style={styles.hint}>
              Из них кассир выбирает скидку в чеке. Пустой список означает, что скидку он вводит
              руками.
            </Text>

            <View style={styles.chips}>
              {draft.presetDiscounts.map((value, index) => (
                <View key={index} style={styles.chip}>
                  <Text style={styles.chipText}>{value / 100} %</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Убрать ${value / 100} %`}
                    onPress={() =>
                      set({ presetDiscounts: draft.presetDiscounts.filter((_, at) => at !== index) })
                    }
                  >
                    <Text style={styles.remove}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>

            <AddDiscount
              onAdd={(bp) => set({ presetDiscounts: [...draft.presetDiscounts, bp] })}
            />

            <Text style={[styles.blockTitle, styles.second]}>
              Правила накопительных скидок
            </Text>

            {draft.discountRules.map((rule, index) => (
              <View key={index} style={styles.rule}>
                <Text style={styles.phrase}>Сумма больше чем:</Text>
                <View style={styles.ruleField}>
                  <Money
                    value={rule.from}
                    onChange={(from) =>
                      set({ discountRules: replaceAt(draft.discountRules, index, { ...rule, from }) })
                    }
                  />
                </View>
                <Text style={styles.phrase}>Скидка</Text>
                <View style={styles.ruleField}>
                  <Number
                    value={rule.discount_bp / 100}
                    onChange={(value) =>
                      set({
                        discountRules: replaceAt(draft.discountRules, index, {
                          ...rule,
                          discount_bp: Math.round(value * 100),
                        }),
                      })
                    }
                  />
                </View>
                <Text style={styles.phrase}>%</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Убрать правило"
                  onPress={() =>
                    set({ discountRules: draft.discountRules.filter((_, at) => at !== index) })
                  }
                >
                  <Text style={styles.remove}>×</Text>
                </Pressable>
              </View>
            ))}

            <Text
              accessibilityRole="link"
              style={styles.addLink}
              onPress={() =>
                set({ discountRules: [...draft.discountRules, { from: 0, discount_bp: 0 }] })
              }
            >
              добавить еще
            </Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          <ToolButton label="Сохранить" tone="green" onPress={save} />
          <ToolButton label="Отменить" onPress={() => setDraft(saved)} />
        </View>
      </ScrollView>
    </View>
  );
}

/** Строка-фраза: числа стоят внутри предложения, а не под подписями. */
function Phrase({ children }: { children: React.ReactNode }) {
  return <View style={styles.phraseRow}>{children}</View>;
}

/** Небольшое числовое поле внутри фразы. */
function Number_({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value));

  return (
    <TextInput
      value={text}
      onChangeText={(next) => {
        setText(next);
        const parsed = parsePercent(next);
        if (parsed !== null) onChange(parsed / 100);
      }}
      keyboardType="decimal-pad"
      style={styles.number}
    />
  );
}
const Number = Number_;

/** Денежное поле: показывает рубли, хранит копейки. */
function Money({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(value ? formatMoneyWeb(value) : '');

  return (
    <TextInput
      value={text}
      onChangeText={(next) => {
        setText(next);
        const parsed = next.trim() ? parseMoney(next) : 0;
        if (parsed !== null) onChange(parsed);
      }}
      placeholder="0.00"
      placeholderTextColor={web.textMuted}
      keyboardType="decimal-pad"
      style={styles.money}
    />
  );
}

function AddDiscount({ onAdd }: { onAdd: (bp: number) => void }) {
  const [text, setText] = useState('');

  return (
    <View style={styles.addRow}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="например 5"
        placeholderTextColor={web.textMuted}
        keyboardType="decimal-pad"
        style={styles.number}
      />
      <Text style={styles.phrase}>%</Text>
      <ToolButton
        label="Добавить"
        onPress={() => {
          const bp = parsePercent(text);
          if (bp === null || bp <= 0) {
            say('Проверьте число', 'Скидка — число процентов, например 5.');
            return;
          }
          onAdd(bp);
          setText('');
        }}
      />
    </View>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      onPress={() => onChange(!on)}
      style={styles.toggleRow}
    >
      <View style={[styles.track, on && styles.trackOn]}>
        <View style={[styles.knob, on && styles.knobOn]} />
      </View>
      <Text style={styles.toggleLabel}>{label}</Text>
    </Pressable>
  );
}

function replaceAt<T>(list: T[], index: number, item: T): T[] {
  return list.map((current, at) => (at === index ? item : current));
}

/** «бонус / бонуса / бонусов» — так же, как в его фразе. */
function plural(value: number): string {
  const ten = value % 10;
  const hundred = value % 100;
  if (ten === 1 && hundred !== 11) return 'бонус';
  if (ten >= 2 && ten <= 4 && (hundred < 10 || hundred >= 20)) return 'бонуса';
  return 'бонусов';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  tabs: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 26,
    paddingTop: 16,
    borderBottomWidth: 1,
    borderBottomColor: web.border,
  },
  tab: { paddingHorizontal: 20, paddingVertical: 12 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: web.link },
  tabLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },
  tabLabelActive: { color: web.text },
  content: { padding: 26, paddingBottom: 60, maxWidth: 900 },
  block: { gap: 8 },
  blockTitle: { fontFamily: WEB_FONT, fontSize: 18, fontWeight: '700', color: web.text },
  second: { marginTop: 30 },
  label: { fontFamily: WEB_FONT, fontSize: 13, fontWeight: '700', color: web.text, marginTop: 14 },
  hint: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted, lineHeight: 17 },
  note: {
    fontFamily: WEB_FONT,
    fontSize: 13,
    color: web.textMuted,
    lineHeight: 19,
    marginTop: 24,
  },
  phraseRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  phrase: { fontFamily: WEB_FONT, fontSize: 15, color: web.text },
  number: {
    width: 90,
    height: 38,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 10,
    fontFamily: WEB_FONT,
    fontSize: 15,
    color: web.text,
    textAlign: 'right',
  },
  money: {
    width: 160,
    height: 38,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 10,
    fontFamily: WEB_FONT,
    fontSize: 15,
    color: web.text,
    textAlign: 'right',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 4,
    backgroundColor: '#E8E8E8',
  },
  chipText: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  remove: { fontFamily: WEB_FONT, fontSize: 18, color: web.textMuted },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  rule: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  ruleField: {},
  addLink: { fontFamily: WEB_FONT, fontSize: 14, color: web.link, marginTop: 12 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginVertical: 8 },
  track: { width: 49, height: 21, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.05)' },
  trackOn: { backgroundColor: web.link },
  knob: {
    width: 21,
    height: 21,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(34,36,38,0.15)',
  },
  knobOn: { marginLeft: 30 },
  toggleLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.text },
  actions: { flexDirection: 'row', gap: 10, marginTop: 34 },
});
