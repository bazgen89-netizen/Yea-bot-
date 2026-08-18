import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../Translated';

import { Drawer, DrawerButton } from '../Drawer';
import {
  archiveCounterparty,
  createCounterparty,
  formatPhone,
  getCounterparty,
  parseList,
  parsePairs,
  updateCounterparty,
  type PartyInput,
  type Requisite,
} from '../../db/counterparties';
import { listJournal } from '../../db/journal';
import { getSettings } from '../../db/settings';
import { formatMoneyWeb } from '../../domain/money';
import type { CounterpartyWithTotals, Id, PartyKind } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { confirm, say } from '../../ui/alert';
import { WebIcon } from '../../ui/icons';
import { FORM_BORDER, web, WEB_FONT } from '../../ui/webTheme';

/**
 * Карточка контрагента кабинета.
 *
 * Снята с `clients/card/_view.html` и `_form.html`. Устройство их:
 *
 * — **Физическое лицо или организация.** Переключатель наверху формы, и от
 *   него зависит половина полей: у человека пол и день рождения, у
 *   организации реквизиты, расчётный счёт и юридический адрес. Раньше
 *   карточка была одна на всех, и поставщику-ООО некуда было вписать ИНН.
 *
 * — **Лояльность двумя блоками.** «Скидка» с процентом и накопительной, либо
 *   «Бонусная система» — и рядом пересказ трёх ставок компании. Это не
 *   переключатель настроек, а выбор: клиенту либо считают процент, либо
 *   копят бонусы, но не то и другое сразу.
 *
 * — **Ярлыки над карточкой** вместо строк: «По умолчанию», «Накопительные
 *   скидки», «Скидка 5 %» или, у бонусного, «Кешбэк», «Бонусы», «Потрачено».
 *   По ним видно условие клиента, не читая карточку.
 *
 * — **Последние операции** тремя вкладками: движение товара, движение денег,
 *   история бонусов.
 */

const KIND_LABEL: Record<PartyKind, string> = {
  customer: 'Клиент',
  supplier: 'Поставщик',
  both: 'Клиент и поставщик',
};

type HistoryTab = 'documents' | 'money' | 'bonus';

const HISTORY_TABS: { value: HistoryTab; label: string }[] = [
  { value: 'documents', label: 'Движение товара' },
  { value: 'money', label: 'Движение денег' },
  { value: 'bonus', label: 'История бонусов' },
];

export function PartyCard({
  id,
  kind,
  onClose,
}: {
  /** null — заводим нового. */
  id: Id | null;
  kind: PartyKind;
  onClose: () => void;
}) {
  const { db, refresh } = useDatabase();
  const party = useQuery((database) => (id ? getCounterparty(database, id) : null), [id]);

  const [editing, setEditing] = useState(id === null);

  if (editing) {
    return (
      <PartyForm
        party={party}
        kind={kind}
        onClose={() => (id === null ? onClose() : setEditing(false))}
        onSaved={() => {
          refresh();
          if (id === null) onClose();
          else setEditing(false);
        }}
      />
    );
  }

  if (!party) return null;

  function remove() {
    if (!id) return;
    confirm(
      'Убрать из справочника?',
      'Карточка скроется из списка. История покупок сохранится — на неё ссылаются чеки.',
      'Убрать',
      () => {
        archiveCounterparty(db, id);
        refresh();
        onClose();
      },
    );
  }

  return (
    <Drawer
      visible
      size="l"
      onClose={onClose}
      actions={
        <>
          <DrawerButton label="Редактировать" tone="green" onPress={() => setEditing(true)} />
          <DrawerButton label="Удалить" tone="dangerOutline" onPress={remove} right />
        </>
      }
    >
      <PartyView party={party} />
    </Drawer>
  );
}

function PartyView({ party }: { party: CounterpartyWithTotals }) {
  const [tab, setTab] = useState<HistoryTab>('documents');

  const history = useQuery(
    (database) => listJournal(database, 100, { receiver: party.name }),
    [party.name],
  );
  const senderHistory = useQuery(
    (database) => listJournal(database, 100, { sender: party.name }),
    [party.name],
  );

  const phones = parseList(party.phones);
  const details = parsePairs(party.details);
  const bankDetails = parsePairs(party.bank_details);
  const bonus = party.loyalty_type === 'bonus';

  const rows = tab === 'documents' ? [...history, ...senderHistory] : [];

  return (
    <ScrollView contentContainerStyle={styles.view}>
      <View style={styles.viewHead}>
        <View style={styles.viewTitleBlock}>
          <Text style={styles.viewTitle}>{party.name}</Text>
          <Text style={styles.viewSub}>
            Создан {new Date(party.created_at).toLocaleDateString('ru-RU')}
          </Text>
        </View>
        <Text style={styles.viewKind}>{KIND_LABEL[party.kind]}</Text>
      </View>

      <View style={styles.labels}>
        {party.is_default === 1 ? <Label tone="teal">По умолчанию</Label> : null}
        {party.enable_savings === 1 ? <Label tone="pink">Накопительные скидки</Label> : null}
        {!bonus && party.discount_bp > 0 ? (
          <Label tone="yellow">Скидка {party.discount_bp / 100} %</Label>
        ) : null}
        {bonus ? (
          <>
            <Label tone="red">Кешбэк: {party.cashback_bp / 100} %</Label>
            <Label tone="purple">Бонусы: {formatMoneyWeb(party.bonus_balance)}</Label>
            <Label tone="blue">Потрачено бонусов: {formatMoneyWeb(party.bonus_spent)}</Label>
          </>
        ) : null}
        {party.discount_card ? <Label tone="blue">Карта {party.discount_card}</Label> : null}
      </View>

      <View style={styles.list}>
        {party.gender ? <Line icon="gear">{party.gender}</Line> : null}
        {party.birthday ? <Line icon="calendar">{party.birthday}</Line> : null}
        {party.note ? <Line icon="comment">{party.note}</Line> : null}
      </View>

      {phones.length || party.phone || party.email || party.address || party.legal_address ? (
        <>
          <Divider>Контакты</Divider>
          <View style={styles.list}>
            {(phones.length ? phones : [party.phone]).map((phone, index) =>
              phone ? (
                <Line key={index} icon="storefront">
                  {formatPhone(phone)}
                </Line>
              ) : null,
            )}
            {party.email ? <Line icon="comment">{party.email}</Line> : null}
            {party.address ? <Line icon="home">{party.address}</Line> : null}
            {party.legal_address ? <Line icon="home">{party.legal_address}</Line> : null}
          </View>
        </>
      ) : null}

      {details.length || bankDetails.length || party.account_number ? (
        <>
          <Divider>Реквизиты</Divider>
          <View style={styles.pairs}>
            {details.length ? (
              <View style={styles.pairColumn}>
                <Text style={styles.pairHead}>Реквизиты организации</Text>
                {details.map((item, index) => (
                  <Text key={index} style={styles.pairLine}>
                    {item.key}: {item.value}
                  </Text>
                ))}
              </View>
            ) : null}
            {bankDetails.length || party.account_number ? (
              <View style={styles.pairColumn}>
                <Text style={styles.pairHead}>Банковские реквизиты</Text>
                {party.account_number ? (
                  <Text style={styles.pairLine}>Номер счета: {party.account_number}</Text>
                ) : null}
                {bankDetails.map((item, index) => (
                  <Text key={index} style={styles.pairLine}>
                    {item.key}: {item.value}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        </>
      ) : null}

      <Divider>Статистика</Divider>
      <View style={styles.stats}>
        <Stat label="Покупки" value={formatMoneyWeb(party.purchases)} note={`${party.receipts} чеков`} />
        <Stat
          label="Возвраты"
          value={formatMoneyWeb(party.returns_sum)}
          note={`${party.returns} шт`}
        />
        <Stat label="Приход денег" value={formatMoneyWeb(party.debit_sum)} />
        <Stat label="Расход денег" value={formatMoneyWeb(party.credit_sum)} />
        {party.kind !== 'customer' ? (
          <Stat
            label="Закупки"
            value={formatMoneyWeb(party.purchases_sum)}
            note={`${party.purchases_count} документов`}
          />
        ) : null}
      </View>

      <Divider>Последние операции</Divider>
      <View style={styles.historyTabs}>
        {HISTORY_TABS.map((item) => (
          <Pressable
            key={item.value}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === item.value }}
            onPress={() => setTab(item.value)}
            style={[styles.historyTab, tab === item.value && styles.historyTabOn]}
          >
            <Text style={[styles.historyLabel, tab === item.value && styles.historyLabelOn]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'documents' ? (
        rows.length ? (
          rows.map((entry) => (
            <View key={`${entry.kind}${entry.id}`} style={styles.historyRow}>
              <Text style={styles.historyCell}>
                {new Date(entry.created_at).toLocaleDateString('ru-RU')}
              </Text>
              <Text style={[styles.historyCell, styles.historyName]} numberOfLines={1}>
                {entry.kind === 'sale' ? 'Продажа' : 'Документ'} #{entry.id}
              </Text>
              <Text style={styles.historyAmount}>{formatMoneyWeb(entry.amount)}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.empty}>Операций пока нет</Text>
        )
      ) : null}

      {tab === 'money' ? <Text style={styles.empty}>Денежных документов по нему нет</Text> : null}

      {tab === 'bonus' ? (
        <Text style={styles.empty}>
          {party.bonus_balance || party.bonus_spent
            ? `Начислено ${formatMoneyWeb(party.bonus_balance + party.bonus_spent)}, потрачено ${formatMoneyWeb(party.bonus_spent)}`
            : 'Бонусы по нему не начислялись'}
        </Text>
      ) : null}
    </ScrollView>
  );
}

/** Форма карточки — его поля и его порядок. */
function PartyForm({
  party,
  kind,
  onClose,
  onSaved,
}: {
  party: CounterpartyWithTotals | null;
  kind: PartyKind;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { db } = useDatabase();
  const settings = useQuery((database) => getSettings(database));

  const [draft, setDraft] = useState<PartyInput>(() =>
    party
      ? {
          kind: party.kind,
          name: party.name,
          email: party.email,
          note: party.note,
          discount_bp: party.discount_bp,
          birthday: party.birthday,
          gender: party.gender,
          address: party.address,
          party_type: party.party_type,
          is_default: party.is_default === 1,
          enable_savings: party.enable_savings === 1,
          phones: parseList(party.phones).length ? parseList(party.phones) : [party.phone ?? ''],
          discount_card: party.discount_card,
          loyalty_type: party.loyalty_type,
          cashback_bp: party.cashback_bp,
          details: parsePairs(party.details).length
            ? parsePairs(party.details)
            : [{ key: '', value: '' }],
          bank_details: parsePairs(party.bank_details).length
            ? parsePairs(party.bank_details)
            : [{ key: '', value: '' }],
          account_number: party.account_number,
          legal_address: party.legal_address,
        }
      : {
          kind,
          name: '',
          phones: [''],
          party_type: 'person',
          details: [{ key: '', value: '' }],
          bank_details: [{ key: '', value: '' }],
        },
  );

  const set = (patch: Partial<PartyInput>) => setDraft((current) => ({ ...current, ...patch }));
  const company = draft.party_type === 'company';

  function save() {
    if (!draft.name.trim()) {
      say('Нужно название', 'Без него карточку не сохранить.');
      return;
    }

    const percent = (draft.discount_bp ?? 0) / 100;
    if (percent < 0 || percent > 100) {
      say('Проверьте скидку', 'Скидка — число от 0 до 100.');
      return;
    }

    if (party) updateCounterparty(db, party.id, draft);
    else createCounterparty(db, draft);
    onSaved();
  }

  return (
    <Drawer
      visible
      size="l"
      nested={Boolean(party)}
      onClose={onClose}
      actions={<DrawerButton label="Сохранить" tone="green" onPress={save} />}
    >
      <ScrollView contentContainerStyle={styles.form}>
        <Text style={styles.formTitle}>
          {party ? 'Редактирование карточки' : `Создание: ${KIND_LABEL[kind].toLowerCase()}`}
        </Text>

        <Switcher
          value={draft.party_type ?? 'person'}
          options={[
            { value: 'person', label: 'Физическое лицо' },
            { value: 'company', label: 'Юридическое лицо' },
          ]}
          onChange={(party_type) => set({ party_type })}
        />

        <Toggle
          label="По умолчанию"
          on={Boolean(draft.is_default)}
          onChange={(is_default) => set({ is_default })}
        />

        <Field
          label="Наименование"
          required
          value={draft.name}
          onChange={(name) => set({ name })}
        />
        <Field
          label="Email"
          value={draft.email ?? ''}
          onChange={(email) => set({ email })}
        />

        <ListField
          label="Номер телефона"
          values={draft.phones ?? ['']}
          onChange={(phones) => set({ phones })}
        />

        <Text style={styles.blockTitle}>Система лояльности</Text>

        <View style={styles.loyalty}>
          <View style={styles.loyaltyBlock}>
            <Radio
              label="Скидка"
              on={draft.loyalty_type !== 'bonus'}
              onPress={() => set({ loyalty_type: 'discount' })}
            />
            <Field
              label="Скидка, %"
              value={draft.discount_bp ? String(draft.discount_bp / 100) : ''}
              onChange={(value) =>
                set({ discount_bp: Math.round((Number(value.replace(',', '.')) || 0) * 100) })
              }
            />
            <Toggle
              label="Накопительная скидка"
              on={Boolean(draft.enable_savings)}
              onChange={(enable_savings) => set({ enable_savings })}
            />
          </View>

          <View style={styles.loyaltyBlock}>
            <Radio
              label="Бонусная система"
              on={draft.loyalty_type === 'bonus'}
              onPress={() => set({ loyalty_type: 'bonus' })}
            />
            {/* Ставки не задаются здесь: они общие на компанию и лежат в
                «Лояльности». Здесь только видно, какие они. */}
            <Text style={styles.loyaltyLine}>
              • {settings.cashbackRateBp / 100} % от покупки на бонусный счет
            </Text>
            <Text style={styles.loyaltyLine}>
              • {settings.bonusLimitBp / 100} % чека можно оплатить бонусами
            </Text>
            <Text style={styles.loyaltyLine}>
              • 1 бонус = {formatMoneyWeb(settings.redemptionRateBp)} скидки в чеке
            </Text>
          </View>
        </View>

        <Field
          label="Дисконтная карта"
          value={draft.discount_card ?? ''}
          onChange={(discount_card) => set({ discount_card })}
        />

        {!company ? (
          <>
            <Field
              label="Дата рождения"
              value={draft.birthday ?? ''}
              onChange={(birthday) => set({ birthday })}
            />
            <View style={styles.field}>
              <Text style={styles.label}>Пол</Text>
              <Switcher
                value={draft.gender ?? ''}
                options={[
                  { value: 'Мужской', label: 'Мужской' },
                  { value: 'Женский', label: 'Женский' },
                ]}
                onChange={(gender) => set({ gender })}
              />
            </View>
          </>
        ) : null}

        {company ? (
          <>
            <Divider>Реквизиты</Divider>
            <PairsField
              label="Реквизиты организации"
              keyHint="Наименование реквизита (прим. ИНН)"
              valueHint="Номер реквизита (прим. 5702001741)"
              pairs={draft.details ?? []}
              onChange={(details) => set({ details })}
            />

            <Divider>Банковские реквизиты</Divider>
            <Field
              label="Номер счета"
              value={draft.account_number ?? ''}
              onChange={(account_number) => set({ account_number })}
            />
            <PairsField
              label="Ввод реквизитов вручную"
              keyHint="Наименование реквизита (прим. БИК)"
              valueHint="Номер реквизита (прим. 776353444)"
              pairs={draft.bank_details ?? []}
              onChange={(bank_details) => set({ bank_details })}
            />
          </>
        ) : null}

        <Divider>Адрес</Divider>
        {company ? (
          <Field
            label="Юридический"
            value={draft.legal_address ?? ''}
            onChange={(legal_address) => set({ legal_address })}
            multiline
          />
        ) : null}
        <Field
          label="Фактический"
          value={draft.address ?? ''}
          onChange={(address) => set({ address })}
          multiline
        />
        <Field
          label="Описание"
          value={draft.note ?? ''}
          onChange={(note) => set({ note })}
          multiline
        />
      </ScrollView>
    </Drawer>
  );
}

function Switcher({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.switcher}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="button"
          accessibilityState={{ selected: value === option.value }}
          onPress={() => onChange(option.value)}
          style={[styles.switch, value === option.value && styles.switchOn]}
        >
          <Text style={[styles.switchLabel, value === option.value && styles.switchLabelOn]}>
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Radio({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.radioRow}
    >
      <View style={[styles.radio, on && styles.radioOn]}>
        {on ? <View style={styles.radioDot} /> : null}
      </View>
      <Text style={styles.radioLabel}>{label}</Text>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        accessibilityLabel={label}
        style={[styles.input, multiline && styles.area]}
      />
    </View>
  );
}

function ListField({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const rows = values.length ? values : [''];

  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label} (
        <Text
          accessibilityRole="link"
          onPress={() => onChange([...rows, ''])}
          style={styles.addMore}
        >
          добавить еще
        </Text>
        )
      </Text>
      {rows.map((value, index) => (
        <View key={index} style={styles.row}>
          <TextInput
            value={value}
            onChangeText={(next) => onChange(rows.map((item, i) => (i === index ? next : item)))}
            accessibilityLabel={`${label} ${index + 1}`}
            style={[styles.input, styles.grow]}
          />
          {rows.length > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Убрать ${label.toLowerCase()} ${index + 1}`}
              onPress={() => onChange(rows.filter((_, i) => i !== index))}
              style={styles.removeButton}
            >
              <Text style={styles.removeSign}>✕</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function PairsField({
  label,
  keyHint,
  valueHint,
  pairs,
  onChange,
}: {
  label: string;
  keyHint: string;
  valueHint: string;
  pairs: Requisite[];
  onChange: (pairs: Requisite[]) => void;
}) {
  const rows = pairs.length ? pairs : [{ key: '', value: '' }];

  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label} (
        <Text
          accessibilityRole="link"
          onPress={() => onChange([...rows, { key: '', value: '' }])}
          style={styles.addMore}
        >
          добавить еще
        </Text>
        )
      </Text>
      {rows.map((pair, index) => (
        <View key={index} style={styles.row}>
          <TextInput
            value={pair.key}
            onChangeText={(key) =>
              onChange(rows.map((item, i) => (i === index ? { ...item, key } : item)))
            }
            placeholder={keyHint}
            placeholderTextColor={web.textMuted}
            accessibilityLabel={`${label}: наименование ${index + 1}`}
            style={[styles.input, styles.grow]}
          />
          <TextInput
            value={pair.value}
            onChangeText={(value) =>
              onChange(rows.map((item, i) => (i === index ? { ...item, value } : item)))
            }
            placeholder={valueHint}
            placeholderTextColor={web.textMuted}
            accessibilityLabel={`${label}: значение ${index + 1}`}
            style={[styles.input, styles.grow]}
          />
        </View>
      ))}
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

function Label({
  tone,
  children,
}: {
  tone: 'teal' | 'pink' | 'yellow' | 'red' | 'purple' | 'blue';
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.tag, TAG_TONE[tone]]}>
      <Text style={styles.tagText}>{children}</Text>
    </View>
  );
}

const TAG_TONE = {
  teal: { backgroundColor: '#00B5AD' },
  pink: { backgroundColor: '#E03997' },
  yellow: { backgroundColor: '#FBBD08' },
  red: { backgroundColor: '#DB2828' },
  purple: { backgroundColor: '#A333C8' },
  blue: { backgroundColor: '#2185D0' },
} as const;

function Line({ icon, children }: { icon: keyof typeof WebIcon; children: React.ReactNode }) {
  const Glyph = WebIcon[icon] as (p: { size?: number; color: string }) => React.ReactElement;
  return (
    <View style={styles.lineRow}>
      <Glyph size={14} color={web.textMuted} />
      <Text style={styles.lineText}>{children}</Text>
    </View>
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

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      {note ? <Text style={styles.statNote}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  view: { padding: 30, gap: 14 },
  viewHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  viewTitleBlock: { flex: 1, gap: 4 },
  viewTitle: { fontFamily: WEB_FONT, fontSize: 27, color: web.text },
  viewSub: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },
  viewKind: { fontFamily: WEB_FONT, fontSize: 20, color: web.textMuted },

  labels: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 4 },
  tagText: { fontFamily: WEB_FONT, fontSize: 12, color: '#FFFFFF', fontWeight: '700' },

  list: { gap: 8 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lineText: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },

  pairs: { flexDirection: 'row', gap: 40, flexWrap: 'wrap' },
  pairColumn: { gap: 4, minWidth: 240 },
  pairHead: { fontFamily: WEB_FONT, fontSize: 13, color: web.text, fontWeight: '700' },
  pairLine: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },

  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 30 },
  stat: { gap: 2, minWidth: 150 },
  statLabel: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted },
  statValue: {
    fontFamily: WEB_FONT,
    fontSize: 20,
    color: web.text,
    fontVariant: ['tabular-nums'],
  },
  statNote: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted },

  historyTabs: { flexDirection: 'row', alignSelf: 'center', borderRadius: 4, overflow: 'hidden' },
  historyTab: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    marginLeft: -1,
  },
  historyTabOn: { backgroundColor: '#E8F4FD', borderColor: web.link },
  historyLabel: { fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  historyLabelOn: { color: web.link },

  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: web.gridLine,
  },
  historyCell: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },
  historyName: { flex: 1, color: web.text },
  historyAmount: {
    fontFamily: WEB_FONT,
    fontSize: 13,
    color: web.text,
    fontVariant: ['tabular-nums'],
  },
  empty: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted, paddingVertical: 16 },

  form: { padding: 30, gap: 16 },
  formTitle: { fontFamily: WEB_FONT, fontSize: 27, color: web.text },
  blockTitle: { fontFamily: WEB_FONT, fontSize: 20, color: web.text, marginTop: 10 },
  field: { gap: 6 },
  label: { fontFamily: WEB_FONT, fontSize: 13, color: web.text, fontWeight: '700' },
  required: { color: web.danger },
  addMore: { color: web.link, fontWeight: '400' },
  input: {
    minHeight: 38,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 10,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
  },
  area: { minHeight: 66, paddingVertical: 8, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  removeButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
  },
  removeSign: { fontSize: 13, color: web.textMuted },

  switcher: { flexDirection: 'row', alignSelf: 'flex-start' },
  switch: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    marginLeft: -1,
  },
  switchOn: { backgroundColor: '#E8F4FD', borderColor: web.link },
  switchLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  switchLabelOn: { color: web.link },

  loyalty: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  loyaltyBlock: {
    flex: 1,
    minWidth: 260,
    gap: 10,
    padding: 16,
    backgroundColor: '#F8F8F9',
    borderRadius: 4,
  },
  loyaltyLine: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },

  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  radio: {
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: web.link },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: web.link },
  radioLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.text, fontWeight: '700' },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { width: 49, height: 21, borderRadius: 11, backgroundColor: '#D4D4D5', padding: 2 },
  trackOn: { backgroundColor: web.green },
  knob: { width: 17, height: 17, borderRadius: 9, backgroundColor: '#FFFFFF' },
  knobOn: { transform: [{ translateX: 30 }] },
  toggleLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: web.border },
  dividerText: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted },
});
