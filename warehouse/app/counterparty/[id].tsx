import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  archiveCounterparty,
  createCounterparty,
  formatPhone,
  getCounterparty,
  updateCounterparty,
  type PartyInput,
} from '../../src/db/counterparties';
import {
  bonusHistory,
  entryTitle,
  listJournal,
  listMoney,
  moneyTitle,
  type JournalEntry,
  type MoneyEntry,
} from '../../src/db/journal';
import { formatMoney } from '../../src/domain/money';
import { pluralize } from '../../src/domain/plural';
import type { CounterpartyWithTotals, PartyKind } from '../../src/domain/types';
import { useDatabase, useQuery } from '../../src/state/DatabaseProvider';
import { Button, Card, Field, Stat } from '../../src/ui/components';
import { MenuIcon } from '../../src/ui/icons';
import { colors, radius, spacing, text } from '../../src/ui/theme';
import { confirm, say } from '../../src/ui/alert';

const KIND_LABEL: Record<PartyKind, string> = {
  customer: 'Клиент',
  supplier: 'Поставщик',
  both: 'Клиент и поставщик',
};

/**
 * Карточка контрагента на телефоне.
 *
 * До этого здесь была одна форма правки: имя, телефон, почта, скидка. На
 * большом экране карточка давно показывает всё — покупки, деньги, бонусы, —
 * а с телефона тех же данных не было видно, и выходило, что перенесённые из
 * CloudShop бонусы и история «не перенеслись». Они переносились; их просто
 * негде было посмотреть.
 *
 * Поэтому экран разделён надвое: сперва карточка (только смотреть), правка —
 * по кнопке. Новая карточка открывается сразу формой: править там нечего.
 */
export default function CounterpartyScreen() {
  const params = useLocalSearchParams<{ id: string; kind?: string }>();
  const isNew = params.id === 'new';
  const partyId = isNew ? null : Number(params.id);

  const party = useQuery(
    (database) => (partyId ? getCounterparty(database, partyId) : null),
    [partyId],
  );

  const [editing, setEditing] = useState(isNew);

  if (isNew || editing) {
    return (
      <PartyForm
        party={party}
        kind={params.kind === 'supplier' ? 'supplier' : 'customer'}
        onDone={() => (isNew ? null : setEditing(false))}
      />
    );
  }

  return <PartyView party={party} onEdit={() => setEditing(true)} />;
}

type HistoryTab = 'documents' | 'money' | 'bonus';

const HISTORY_TABS: { value: HistoryTab; label: string }[] = [
  { value: 'documents', label: 'Покупки' },
  { value: 'money', label: 'Деньги' },
  { value: 'bonus', label: 'Бонусы' },
];

function PartyView({
  party,
  onEdit,
}: {
  party: CounterpartyWithTotals | null;
  onEdit: () => void;
}) {
  const router = useRouter();
  const { db, refresh } = useDatabase();
  const [tab, setTab] = useState<HistoryTab>('documents');

  // Каждая вкладка читает своё и только когда открыта: у клиента с восемью
  // десятками чеков лишний запрос на открытие карточки заметен на телефоне.
  const documents = useQuery(
    (database) =>
      party && tab === 'documents' ? listJournal(database, 50, { receiver: party.name }) : [],
    [tab, party?.name],
  );
  const money = useQuery(
    (database) =>
      party && tab === 'money' ? listMoney(database, 50, { counterparty: party.name }) : [],
    [tab, party?.name],
  );
  const bonusRows = useQuery(
    (database) => (party && tab === 'bonus' ? bonusHistory(database, party.id) : []),
    [tab, party?.id],
  );

  if (!party) return null;

  const bonus = party.loyalty_type === 'bonus';
  const phones = (party.phones ?? '')
    .split(/[,;\n]/)
    .map((one) => one.trim())
    .filter(Boolean);
  const numbers = phones.length ? phones : party.phone ? [party.phone] : [];

  function remove() {
    if (!party) return;

    confirm(
      'Убрать из справочника?',
      'Карточка скроется из списка. История покупок сохранится.',
      'Убрать',
      () => {
        archiveCounterparty(db, party.id);
        refresh();
        router.back();
      },
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: party.name || 'Карточка' }} />

      <Card style={styles.summary}>
        <View style={styles.summaryHead}>
          <View style={styles.avatar}>
            <Text style={styles.avatarLetter}>
              {party.name.trim().slice(0, 1).toUpperCase() || '?'}
            </Text>
          </View>
          <View style={styles.summaryTitles}>
            <Text style={text.heading} numberOfLines={2}>
              {party.name}
            </Text>
            <Text style={text.muted}>
              {KIND_LABEL[party.kind]} · с{' '}
              {new Date(party.created_at).toLocaleDateString('ru-RU')}
            </Text>
          </View>

          {numbers[0] ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Позвонить"
              onPress={() => void Linking.openURL(`tel:${numbers[0]}`)}
              hitSlop={8}
              style={({ pressed }) => [styles.call, pressed && { opacity: 0.6 }]}
            >
              <MenuIcon.call color={colors.accent} />
            </Pressable>
          ) : null}
        </View>

        {/* Ярлыки — те же, что в большой карточке: по ним сразу видно, на
            бонусах человек или на скидке, и сколько у него на счету. */}
        <View style={styles.labels}>
          {!bonus && party.discount_bp > 0 ? (
            <Label tone="warning">Скидка {party.discount_bp / 100} %</Label>
          ) : null}
          {bonus ? (
            <>
              <Label tone="accent">Бонусы: {formatMoney(party.bonus_balance)}</Label>
              {party.cashback_bp ? <Label>Кешбэк {party.cashback_bp / 100} %</Label> : null}
              {party.bonus_spent ? (
                <Label>Потрачено: {formatMoney(party.bonus_spent)}</Label>
              ) : null}
            </>
          ) : null}
          {party.discount_card ? <Label>Карта {party.discount_card}</Label> : null}
        </View>

        <View style={styles.stats}>
          <Stat label="Покупок" value={formatMoney(party.purchases) + ' руб'} />
          <Stat label="Чеков" value={String(party.receipts)} />
        </View>

        {party.last_sale_at ? (
          <Text style={text.muted}>
            Последняя покупка: {party.last_sale_at.slice(0, 10).split('-').reverse().join('.')}
          </Text>
        ) : (
          <Text style={text.muted}>Покупок ещё не было</Text>
        )}
      </Card>

      {numbers.length || party.email || party.address || party.birthday || party.gender ? (
        <Card>
          <Text style={[text.block, styles.blockTitle]}>Контакты</Text>
          {numbers.map((phone, index) => (
            <Text key={index} style={styles.line}>
              {formatPhone(phone)}
            </Text>
          ))}
          {party.email ? <Text style={styles.line}>{party.email}</Text> : null}
          {party.address ? <Text style={styles.line}>{party.address}</Text> : null}
          {party.birthday ? (
            <Text style={styles.line}>День рождения: {party.birthday}</Text>
          ) : null}
          {party.gender ? <Text style={styles.line}>{party.gender}</Text> : null}
          {party.note ? <Text style={styles.line}>{party.note}</Text> : null}
        </Card>
      ) : null}

      <Card>
        <Text style={[text.block, styles.blockTitle]}>Статистика</Text>
        <StatLine label="Кол-во продаж" value={String(party.receipts)} />
        <StatLine label="Сумма продаж" value={formatMoney(party.purchases)} />
        <StatLine
          label="Средний чек"
          value={formatMoney(party.receipts ? Math.round(party.purchases / party.receipts) : 0)}
          strong
        />
        <StatLine label="Возвратов" value={String(party.returns)} />
        <StatLine label="Сумма возвратов" value={formatMoney(party.returns_sum)} />
        <StatLine label="Долг по продажам" value={formatMoney(party.debt_sales)} strong />
      </Card>

      <Card>
        <View style={styles.tabs}>
          {HISTORY_TABS.map((item) => (
            <Pressable
              key={item.value}
              accessibilityRole="button"
              accessibilityState={{ selected: tab === item.value }}
              onPress={() => setTab(item.value)}
              style={[styles.tab, tab === item.value && styles.tabOn]}
            >
              <Text style={[styles.tabLabel, tab === item.value && styles.tabLabelOn]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === 'documents' ? <Documents rows={documents} /> : null}
        {tab === 'money' ? <Money rows={money} /> : null}
        {tab === 'bonus' ? <Bonuses party={party} rows={bonusRows} /> : null}
      </Card>

      <Card>
        <Text style={[text.block, styles.blockTitle]}>Ещё</Text>
        <Text style={[text.muted, styles.hint]}>
          {pluralize(party.receipts, 'чек', 'чека', 'чеков')} привязано к этой карточке.
        </Text>
        <Button title="Редактировать" onPress={onEdit} />
        <View style={{ height: spacing.sm }} />
        <Button title="Убрать из справочника" variant="danger" onPress={remove} />
      </Card>
    </ScrollView>
  );
}

function Documents({ rows }: { rows: JournalEntry[] }) {
  const router = useRouter();

  if (!rows.length) return <Text style={styles.empty}>Покупок пока нет</Text>;

  return (
    <View style={styles.opList}>
      {rows.map((entry) => (
        <Pressable
          key={`${entry.kind}${entry.id}`}
          accessibilityRole="button"
          onPress={() =>
            entry.kind === 'sale' ? router.push(`/sale/${entry.id}`) : router.push(`/doc/${entry.id}`)
          }
          style={({ pressed }) => [styles.op, pressed && { opacity: 0.7 }]}
        >
          <View style={styles.opHead}>
            <Text style={styles.opTitle}>{entryTitle(entry)}</Text>
            <Text style={styles.opAmount}>{formatMoney(entry.amount)} руб</Text>
          </View>
          {/* Магазин и автор часто одно и то же — учётная запись названа по
              магазину. Дважды подписывать одну строку незачем. */}
          <Text style={text.muted}>
            {[...new Set([entry.sender, when(entry.created_at), entry.author].filter(Boolean))].join(
              ' · ',
            )}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Money({ rows }: { rows: MoneyEntry[] }) {
  if (!rows.length) return <Text style={styles.empty}>Денежных документов по нему нет</Text>;

  return (
    <View style={styles.opList}>
      {rows.map((entry) => (
        <View key={`${entry.source}${entry.id}`} style={styles.op}>
          <View style={styles.opHead}>
            <Text style={styles.opTitle}>{moneyTitle(entry)}</Text>
            <Text style={styles.opAmount}>
              {formatMoney(entry.income || entry.expense)} руб
            </Text>
          </View>
          <Text style={text.muted}>
            {[entry.category ?? 'Оплата от клиента', entry.account, when(entry.created_at)]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Бонусы: сперва счёт, потом движение по нему.
 *
 * Счёт и накопления приходят из CloudShop карточкой клиента и есть у всех,
 * у кого они там есть. Построчное «начислено / списано» появляется в чеках
 * только с 2026 года — раньше CloudShop его в чек не писал, и придумывать
 * недостающие строки по ставке кешбэка нельзя: это были бы не его данные.
 */
function Bonuses({
  party,
  rows,
}: {
  party: CounterpartyWithTotals;
  rows: ReturnType<typeof bonusHistory>;
}) {
  return (
    <>
      <StatLine label="На счету" value={formatMoney(party.bonus_balance)} strong />
      <StatLine label="Потрачено" value={formatMoney(party.bonus_spent)} />
      {party.cashback_bp ? (
        <StatLine label="Возврат с покупки" value={`${party.cashback_bp / 100} %`} />
      ) : null}

      {rows.length ? (
        <View style={styles.opList}>
          {rows.map((row) => (
            <View key={row.id} style={styles.op}>
              <View style={styles.opHead}>
                <Text style={styles.opTitle}>
                  Продажа #{row.number ?? row.id} · {formatMoney(row.total)}
                </Text>
                <Text style={[styles.opAmount, row.earned ? styles.plus : styles.minus]}>
                  {row.earned ? `+${formatMoney(row.earned)}` : `−${formatMoney(row.used)}`}
                </Text>
              </View>
              <Text style={text.muted}>
                {[row.store, when(row.created_at), `остаток ${formatMoney(row.balance)}`]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>
          {party.bonus_balance || party.bonus_spent
            ? 'Счёт перенесён, а построчных начислений по нему в чеках CloudShop нет.'
            : 'Бонусы по нему не начислялись'}
        </Text>
      )}
    </>
  );
}

function StatLine({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.statLine}>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.statDots} />
      <Text style={[styles.statValue, strong && styles.statValueStrong]}>{value}</Text>
    </View>
  );
}

function Label({ children, tone }: { children: React.ReactNode; tone?: 'accent' | 'warning' }) {
  return (
    <View
      style={[
        styles.label,
        tone === 'accent' && { backgroundColor: colors.accentSoft },
        tone === 'warning' && { backgroundColor: colors.warningBg },
      ]}
    >
      <Text
        style={[
          styles.labelText,
          tone === 'accent' && { color: colors.accent },
          tone === 'warning' && { color: colors.warning },
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

/** «14.08.2026 в 19:35» — так дату подписывают в списках. */
function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return `${date.toLocaleDateString('ru-RU')} ${date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function PartyForm({
  party,
  kind: fallbackKind,
  onDone,
}: {
  party: CounterpartyWithTotals | null;
  kind: PartyKind;
  onDone: () => void;
}) {
  const router = useRouter();
  const { db, refresh } = useDatabase();

  const [kind, setKind] = useState<PartyKind>(party?.kind ?? fallbackKind);
  const [name, setName] = useState(party?.name ?? '');
  const [phone, setPhone] = useState(party?.phone ?? '');
  const [email, setEmail] = useState(party?.email ?? '');
  const [note, setNote] = useState(party?.note ?? '');
  const [birthday, setBirthday] = useState(party?.birthday ?? '');
  const [discount, setDiscount] = useState(
    party?.discount_bp ? String(party.discount_bp / 100) : '',
  );

  function save() {
    if (!name.trim()) {
      say('Нужно имя', 'Без имени карточку не сохранить.');
      return;
    }

    // Скидка вводится в процентах, а хранится в сотых долях процента —
    // чтобы «12,5 %» не превращалось в число с плавающей точкой.
    const percent = discount.trim() ? Number(discount.replace(',', '.')) : 0;
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      say('Проверьте скидку', 'Скидка — число от 0 до 100.');
      return;
    }

    const input: PartyInput = {
      kind,
      name,
      phone,
      email,
      note,
      birthday: birthday.trim() || null,
      discount_bp: Math.round(percent * 100),
    };

    if (party) updateCounterparty(db, party.id, input);
    else createCounterparty(db, input);

    refresh();
    if (party) onDone();
    else router.back();
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: party ? name || 'Карточка' : 'Новая карточка' }} />

      <Card>
        <Text style={[text.block, styles.blockTitle]}>Основное</Text>

        <View style={styles.kinds}>
          {(Object.keys(KIND_LABEL) as PartyKind[]).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: kind === value }}
              onPress={() => setKind(value)}
              style={({ pressed }) => [
                styles.kind,
                kind === value && styles.kindActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.kindLabel, kind === value && styles.kindLabelActive]}>
                {KIND_LABEL[value]}
              </Text>
            </Pressable>
          ))}
        </View>

        <Field label="Имя" value={name} onChangeText={setName} placeholder="Иван Петров" />
        <Field
          label="Телефон"
          value={phone}
          onChangeText={setPhone}
          placeholder="+7 (999) 123-45-67"
          keyboardType="phone-pad"
          hint={phone.trim() ? formatPhone(phone) : undefined}
        />
        <Field
          label="Почта"
          value={email}
          onChangeText={setEmail}
          placeholder="mail@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Field
          label="День рождения"
          value={birthday}
          onChangeText={setBirthday}
          placeholder="12.07.1990"
        />
        <Field
          label="Личная скидка, %"
          value={discount}
          onChangeText={setDiscount}
          placeholder="0"
          keyboardType="decimal-pad"
        />
        <Field
          label="Заметка"
          value={note}
          onChangeText={setNote}
          placeholder="Что важно помнить"
          multiline
        />

        <Button title="Сохранить" onPress={save} />
        {party ? (
          <>
            <View style={{ height: spacing.sm }} />
            <Button title="Отмена" variant="secondary" onPress={onDone} />
          </>
        ) : null}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  summary: { gap: spacing.md },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  summaryTitles: { flex: 1, gap: 2 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: colors.accent, fontSize: 20, fontWeight: '700' },
  call: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labels: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  label: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
  },
  labelText: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  stats: { flexDirection: 'row', gap: spacing.md },
  line: { fontSize: 15, color: colors.text, marginBottom: spacing.sm },
  blockTitle: { marginBottom: spacing.md },

  statLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: 10 },
  statLabel: { fontSize: 14, color: colors.textMuted, flexShrink: 1 },
  statDots: { flex: 1, borderBottomWidth: 1, borderStyle: 'dotted', borderColor: colors.border },
  statValue: { fontSize: 14, color: colors.text, fontVariant: ['tabular-nums'] },
  statValueStrong: { fontWeight: '700' },

  tabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
  },
  tabOn: { backgroundColor: colors.accentSoft },
  tabLabel: { fontSize: 14, color: colors.textMuted },
  tabLabelOn: { color: colors.accent, fontWeight: '600' },

  opList: { gap: spacing.sm, marginTop: spacing.sm },
  op: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    gap: spacing.xs,
  },
  opHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  opTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  opAmount: { fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  plus: { color: colors.success },
  minus: { color: colors.danger },
  empty: { fontSize: 14, color: colors.textMuted, paddingVertical: spacing.md },

  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  kind: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
  },
  kindActive: { backgroundColor: colors.accentSoft },
  kindLabel: { fontSize: 14, color: colors.textMuted },
  kindLabelActive: { color: colors.accent, fontWeight: '600' },
  hint: { marginBottom: spacing.md },
});
