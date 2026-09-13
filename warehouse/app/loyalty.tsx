import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { bonusStats } from '../src/db/counterparties';
import { getSettings, saveSettings, type CompanySettings } from '../src/db/settings';
import { formatMoneyWeb, parseMoney } from '../src/domain/money';
import { useDatabase, useQuery } from '../src/state/DatabaseProvider';
import { say } from '../src/ui/alert';
import { FORM_BORDER, web, WEB_FONT } from '../src/ui/webTheme';

/**
 * «Компания / Лояльность» — две его вкладки, «Бонусная система» и «Скидки».
 *
 * Снято с `company/loyalty/bonus/index.html` и `discounts.html`. Устройство
 * оттуда же и важно целиком:
 *
 * — **Ставки — проценты.** Одно поле с приписком «%», а под ним строка,
 *   пересказывающая ставку словами: «Каждые 100,00 в чеке = 5 бонусов на
 *   счет». Раньше здесь стояла сама фраза с двумя полями внутри — читалось
 *   похоже, но значений было два там, где у него одно, и перенести настройки
 *   один в один стало бы нечем.
 *
 * — **Сверху два счётчика** — сгенерированный кешбэк и потраченные бонусы.
 *   Это не украшение: по ним видно, работает программа или заведена и забыта.
 *
 * — **Скидок ровно пять**, и накопительных правил тоже пять. Не список с
 *   «добавить ещё»: на кассе скидку выбирают из ряда кнопок, и ряд этот
 *   помещается на экран только пока их пять.
 *
 * Начисление бонусов на кассе ещё не сделано — здесь заводятся правила.
 */

type Tab = 'bonus' | 'discounts';

const TABS: { value: Tab; label: string }[] = [
  { value: 'bonus', label: 'Бонусная система' },
  { value: 'discounts', label: 'Скидки' },
];

/** Сколько строк в каждом списке скидок — у него ровно столько. */
const SLOTS = 5;

export default function LoyaltyScreen() {
  const { db, refresh } = useDatabase();
  const saved = useQuery((database) => getSettings(database));
  const stats = useQuery((database) => bonusStats(database));

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
          <BonusTab
            draft={draft}
            set={set}
            generated={stats.generated}
            spent={stats.spent}
            onSave={save}
          />
        ) : (
          <DiscountsTab draft={draft} set={set} onSave={save} />
        )}
      </ScrollView>
    </View>
  );
}

function BonusTab({
  draft,
  set,
  generated,
  spent,
  onSave,
}: {
  draft: CompanySettings;
  set: (patch: Partial<CompanySettings>) => void;
  generated: number;
  spent: number;
  onSave: () => void;
}) {
  const cashback = draft.cashbackRateBp / 100;
  const redemption = draft.redemptionRateBp / 100;
  const limit = draft.bonusLimitBp / 100;

  return (
    <>
      <View style={styles.stats}>
        <Stat label="Сгенерированный кешбэк" value={formatMoneyWeb(generated)} />
        <Stat label="Потрачено бонусов" value={formatMoneyWeb(spent)} />
      </View>

      <Text style={styles.blockTitle}>Настройки программы</Text>

      <Toggle
        label={draft.bonusOn ? 'Бонусная программа активна' : 'Бонусная система не активна'}
        on={draft.bonusOn}
        onChange={(bonusOn) => set({ bonusOn })}
      />

      <Percent
        label="Курс начисления"
        value={cashback}
        onChange={(value) => set({ cashbackRateBp: Math.round(value * 100) })}
        // «Каждые 100,00 в чеке = 5 бонусов на счет» — их строка целиком,
        // включая сотню, от которой считается процент.
        hint={`${cashback === 1 ? 'Каждый' : 'Каждые'} ${formatMoneyWeb(10000)} в чеке = ${trim(cashback)} ${plural(cashback)} на счет`}
      />

      <Percent
        label="Курс списания"
        value={redemption}
        onChange={(value) => set({ redemptionRateBp: Math.round(value * 100) })}
        // Один бонус — это рубль на счету. При курсе 100 % он даёт рубль
        // скидки; раньше подпись обещала сотню — ошибка в сто раз, и
        // заметить её можно было только начав списывать бонусы на кассе.
        hint={`1 бонус = ${formatMoneyWeb(Math.round(draft.redemptionRateBp / 100))} скидки в чеке`}
      />

      <Percent
        label="Лимит оплаты"
        value={limit}
        onChange={(value) => set({ bonusLimitBp: Math.round(value * 100) })}
        hint={`${trim(limit)}% чека можно оплатить бонусами`}
      />

      <Percent
        label="Стартовые бонусы"
        unit="⛁"
        value={draft.bonusStart}
        onChange={(bonusStart) => set({ bonusStart })}
        hint="Поступят на счет нового покупателя"
      />

      <Percent
        label="Бонусы на День рождения"
        unit="⛁"
        value={draft.bonusBirthday}
        onChange={(bonusBirthday) => set({ bonusBirthday })}
        hint="Поступят на счет клиента в его День рождения"
      />

      <SaveButton onPress={onSave} />
    </>
  );
}

function DiscountsTab({
  draft,
  set,
  onSave,
}: {
  draft: CompanySettings;
  set: (patch: Partial<CompanySettings>) => void;
  onSave: () => void;
}) {
  /** Пять ячеек: заполненные значениями, остальные пустые. */
  const presets: (number | null)[] = Array.from(
    { length: SLOTS },
    (_, i) => draft.presetDiscounts[i] ?? null,
  );
  const rules = Array.from(
    { length: SLOTS },
    (_, i) => draft.discountRules[i] ?? { from: 0, discount_bp: 0 },
  );

  const setPreset = (index: number, value: number | null) => {
    const next = [...presets];
    next[index] = value;
    set({ presetDiscounts: next.filter((item): item is number => item !== null) });
  };

  const setRule = (index: number, patch: { from?: number; discount_bp?: number }) => {
    const next = rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule));
    // Пустые правила не сохраняются: строка без суммы и без скидки — это
    // незаполненная ячейка, а не правило «с нуля рублей скидка ноль».
    set({ discountRules: next.filter((rule) => rule.from > 0 || rule.discount_bp > 0) });
  };

  return (
    <>
      <Text style={styles.label}>Предустановленные скидки</Text>
      <View style={styles.presetRow}>
        {presets.map((value, index) => (
          <View key={index} style={styles.presetCell}>
            <TextInput
              value={value === null ? '' : String(value / 100)}
              onChangeText={(text) => {
                const parsed = Number(text.replace(',', '.'));
                setPreset(index, text.trim() === '' ? null : Math.round(parsed * 100));
              }}
              placeholder="%"
              placeholderTextColor={web.textMuted}
              accessibilityLabel={`Скидка ${index + 1}`}
              style={styles.input}
            />
          </View>
        ))}
      </View>

      <Divider>правила накопительных скидок</Divider>

      {rules.map((rule, index) => (
        <View key={index} style={styles.ruleRow}>
          <View style={styles.ruleCell}>
            {index === 0 ? <Text style={styles.label}>Сумма больше чем:</Text> : null}
            <TextInput
              value={rule.from ? String(rule.from / 100) : ''}
              onChangeText={(text) => setRule(index, { from: parseMoney(text) ?? 0 })}
              placeholder="Сумма"
              placeholderTextColor={web.textMuted}
              accessibilityLabel={`Сумма правила ${index + 1}`}
              style={styles.input}
            />
          </View>
          <View style={styles.ruleCell}>
            {index === 0 ? <Text style={styles.label}>Скидка, %</Text> : null}
            <TextInput
              value={rule.discount_bp ? String(rule.discount_bp / 100) : ''}
              onChangeText={(text) =>
                setRule(index, {
                  discount_bp: Math.round((Number(text.replace(',', '.')) || 0) * 100),
                })
              }
              placeholder="Скидка"
              placeholderTextColor={web.textMuted}
              accessibilityLabel={`Скидка правила ${index + 1}`}
              style={styles.input}
            />
          </View>
        </View>
      ))}

      <SaveButton onPress={onSave} />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

/** Поле со ставкой и строкой-пояснением под ним. */
function Percent({
  label,
  value,
  onChange,
  hint,
  unit = '%',
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint: string;
  unit?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          value={value ? String(value) : ''}
          onChangeText={(text) => onChange(Number(text.replace(',', '.')) || 0)}
          accessibilityLabel={label}
          style={[styles.input, styles.numeric]}
        />
        <View style={styles.unit}>
          <Text style={styles.unitText}>{unit}</Text>
        </View>
      </View>
      <Text style={styles.hint}>{hint}</Text>
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

function Divider({ children }: { children: string }) {
  return (
    <View style={styles.dividerRow}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerText}>{children}</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

function SaveButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.save}>
      <Text style={styles.saveLabel}>Сохранить</Text>
    </Pressable>
  );
}

/** «5», а не «5.0»: в подписи дробный ноль только мешает. */
function trim(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function plural(count: number): string {
  const n = Math.floor(Math.abs(count)) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) return 'бонусов';
  if (last === 1) return 'бонус';
  if (last >= 2 && last <= 4) return 'бонуса';
  return 'бонусов';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  tabs: {
    flexDirection: 'row',
    gap: 24,
    paddingHorizontal: 30,
    paddingTop: 18,
    borderBottomWidth: 1,
    borderBottomColor: web.border,
  },
  tab: { paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: web.link },
  tabLabel: { fontFamily: WEB_FONT, fontSize: 18, color: web.textMuted },
  tabLabelActive: { color: web.link },

  content: { padding: 30, gap: 18, maxWidth: 720, width: '100%' },

  stats: { flexDirection: 'row', gap: 40 },
  stat: { gap: 4 },
  statLabel: { fontFamily: WEB_FONT, fontSize: 13, color: web.text, fontWeight: '700' },
  statValue: { fontFamily: WEB_FONT, fontSize: 28, color: web.text },

  blockTitle: { fontFamily: WEB_FONT, fontSize: 22, color: web.text, marginTop: 18 },
  field: { gap: 6 },
  label: { fontFamily: WEB_FONT, fontSize: 13, color: web.text, fontWeight: '700' },
  hint: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },

  inputRow: { flexDirection: 'row', alignItems: 'stretch', maxWidth: 220 },
  input: {
    flex: 1,
    height: 38,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 10,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
  },
  numeric: { textAlign: 'right', borderTopRightRadius: 0, borderBottomRightRadius: 0 },
  unit: {
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: '#E8E8E8',
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: FORM_BORDER,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  unitText: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { width: 49, height: 21, borderRadius: 11, backgroundColor: '#D4D4D5', padding: 2 },
  trackOn: { backgroundColor: web.green },
  knob: { width: 17, height: 17, borderRadius: 9, backgroundColor: '#FFFFFF' },
  knobOn: { transform: [{ translateX: 30 }] },
  toggleLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },

  presetRow: { flexDirection: 'row', gap: 10 },
  presetCell: { flex: 1 },
  ruleRow: { flexDirection: 'row', gap: 14 },
  ruleCell: { flex: 1, gap: 6 },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginVertical: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: web.border },
  dividerText: {
    fontFamily: WEB_FONT,
    fontSize: 12,
    color: web.textMuted,
    textTransform: 'uppercase',
  },

  save: {
    alignSelf: 'flex-start',
    marginTop: 20,
    paddingHorizontal: 24,
    height: 42,
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: web.green,
  },
  saveLabel: { fontFamily: WEB_FONT, fontSize: 16, color: '#FFFFFF' },
});
