import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Dropdown, type Option } from '../Dropdown';
import { Text, TextInput } from '../Translated';
import { listCounterparties } from '../../db/counterparties';
import {
  ACCOUNTS,
  CATEGORIES,
  MONEY_TYPE_LABEL,
  deleteMoneyDoc,
  getMoneyDoc,
  updateMoneyDoc,
  type MoneySource,
} from '../../db/money';
import { formatMoneyWeb, parseMoney } from '../../domain/money';
import type { Id } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { confirm, say } from '../../ui/alert';
import { WebIcon } from '../../ui/icons';
import { FORM_BORDER, web, WEB_FONT } from '../../ui/webTheme';

/**
 * Денежный документ — страницей, как у него.
 *
 * В движении денег он кликает строку и попадает на `card/money/show/<id>`.
 * Отдельного «просмотра» там нет: страница документа — она же и форма, всё
 * правится на месте. Поэтому и здесь так же, а не «сначала посмотри, потом
 * нажми карандаш».
 *
 * Разметка — их, `js/pages/orders/page/_view.html` (отдаётся без входа):
 * дата с карандашом справа, переключатель «Документ проведён», заголовок
 * «Приход # <номер>» с правкой номера, строка «Касса · Смена», поля «Счёт» и
 * «Контрагент», «Категория платежа», «Сумма, руб» и «Комментарий».
 * У перевода те же поля называются «Со счёта» и «На счёт» — это тоже их
 * правило, не выдумка.
 *
 * Приход по чеку открывается такой же страницей — их таблица ведёт сюда
 * каждую строку. Только правится он не здесь: у такого документа стоит
 * «Привязка к документу», и менять сумму надо в самом чеке, иначе деньги
 * разойдутся с проданным товаром.
 */
export function MoneyDocument({ id, source = 'doc' }: { id: Id; source?: MoneySource }) {
  const router = useRouter();
  const { db, refresh } = useDatabase();
  const doc = useQuery((database) => getMoneyDoc(database, id, source), [id, source]);
  const parties = useQuery((database) => listCounterparties(database, {}));

  const [account, setAccount] = useState<string | null>(null);
  const [accountTo, setAccountTo] = useState<string | null>(null);
  const [party, setParty] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [amount, setAmount] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);

  if (!doc) return <Text style={styles.empty}>Документ не найден</Text>;

  const transfer = doc.type === 'transfer';
  /** Свой документ правится здесь; приход по чеку — только в чеке. */
  const own = doc.source === 'doc';

  function openSale() {
    router.push({ pathname: '/sale/[id]', params: { id: String(doc?.sale_id ?? id) } });
  }

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/money');
  }

  function save() {
    if (!doc) return;

    const sum = amount != null ? parseMoney(amount) : doc.amount;
    if (sum == null || sum <= 0) {
      say('Проверьте сумму', 'Сумма документа должна быть больше нуля.');
      return;
    }

    try {
      updateMoneyDoc(db, id, {
        amount: sum,
        account: account ?? doc.account,
        accountTo: transfer ? (accountTo ?? doc.account_to) : null,
        counterpartyId: party ? Number(party) : doc.counterparty_id,
        counterparty:
          party != null
            ? (parties.find((one) => String(one.id) === party)?.name ?? null)
            : doc.counterparty,
        category: category ?? doc.category,
        note: note ?? doc.note,
        createdAt: date ?? undefined,
      });
      refresh();
      back();
    } catch (error) {
      say('Не удалось сохранить', String(error));
    }
  }

  function remove() {
    confirm(
      'Удалить документ?',
      'Деньги по нему перестанут учитываться в кассе и в отчётах.',
      'Удалить',
      () => {
        deleteMoneyDoc(db, id);
        refresh();
        back();
      },
    );
  }

  const accountOptions: Option<string>[] = ACCOUNTS.map((name) => ({ value: name, label: name }));
  // Пустой контрагент у прихода — это покупатель с улицы, а у расхода —
  // просто никто: «розничный покупатель» в графе аренды выглядел бы так,
  // будто деньги заплатили ему.
  const partyOptions: Option<string>[] = [
    { value: '', label: doc.type === 'income' ? 'Розничный покупатель' : 'Не выбран' },
    ...parties.map((one) => ({ value: String(one.id), label: one.name })),
  ];
  const categoryOptions: Option<string>[] = (CATEGORIES[doc.type] ?? []).map((name) => ({
    value: name,
    label: name,
  }));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.bar}>
        {own ? (
          <Pressable accessibilityRole="button" onPress={save} style={[styles.button, styles.green]}>
            <Text style={styles.greenLabel}>Сохранить</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={openSale}
            style={[styles.button, styles.green]}
          >
            <Text style={styles.greenLabel}>Открыть чек</Text>
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (typeof globalThis.print === 'function') globalThis.print();
          }}
          style={styles.button}
        >
          <Text style={styles.buttonLabel}>Печать</Text>
          <WebIcon.caretDown size={12} color={web.text} />
        </Pressable>

        <View style={styles.grow} />

        {own ? (
          <Pressable
            accessibilityRole="button"
            onPress={remove}
            style={[styles.button, styles.danger]}
          >
            <Text style={styles.dangerLabel}>Удалить</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.stateRow}>
        {/* Состояние, а не выключатель: отложенных денежных документов у нас
            не бывает, и рисовать переключатель, который нельзя переключить,
            значит рисовать мёртвую кнопку. */}
        <View style={styles.toggleRow}>
          <WebIcon.done color={web.green} />
          <Text style={styles.stateLabel}>Документ проведён</Text>
        </View>

        <View style={styles.grow} />

        {date != null ? (
          <TextInput
            value={date}
            onChangeText={setDate}
            autoFocus
            placeholder="2026-08-23 18:15"
            placeholderTextColor={web.textMuted}
            accessibilityLabel="Дата документа"
            style={styles.dateInput}
          />
        ) : (
          <Text style={styles.date}>{when(doc.created_at)}</Text>
        )}

        {own ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Изменить дату документа"
            onPress={() => setDate((current) => (current == null ? edited(doc.created_at) : null))}
          >
            <WebIcon.pencil size={15} color={date != null ? web.link : web.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.titleRow}>
        <Text style={styles.title}>{MONEY_TYPE_LABEL[doc.type]} #</Text>
        <Text style={styles.number}>{doc.number ?? doc.id}</Text>
      </View>

      {/* Касса и смена — как у него строкой под заголовком. */}
      {doc.register || doc.shift_number ? (
        <View style={styles.refs}>
          {doc.register ? (
            <Text style={styles.refItem}>
              Касса{' '}
              <Text
                accessibilityRole="link"
                style={styles.link}
                onPress={() => router.push('/registers')}
              >
                {doc.register}
              </Text>
            </Text>
          ) : null}
          {doc.shift_number ? (
            <Text style={styles.refItem}>
              Смена{' '}
              <Text
                accessibilityRole="link"
                style={styles.link}
                onPress={() => router.push('/shifts')}
              >
                #{doc.shift_number}
              </Text>
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.fields}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{transfer ? 'Со счёта' : 'Счёт'}</Text>
          {own ? (
            <Dropdown
              value={account ?? doc.account}
              options={accountOptions}
              variant="field"
              label="Счёт"
              onChange={setAccount}
            />
          ) : (
            <Text
              accessibilityRole="link"
              style={[styles.input, styles.readonly, styles.link]}
              onPress={() => router.push('/accounts')}
            >
              {doc.account}
            </Text>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>{transfer ? 'На счёт' : 'Контрагент'}</Text>
          {own ? (
            <Dropdown
              value={
                transfer
                  ? (accountTo ?? doc.account_to ?? '')
                  : (party ?? (doc.counterparty_id ? String(doc.counterparty_id) : ''))
              }
              options={transfer ? accountOptions : partyOptions}
              variant="field"
              label={transfer ? 'На счёт' : 'Контрагент'}
              onChange={transfer ? setAccountTo : setParty}
            />
          ) : (
            <Text
              accessibilityRole={doc.counterparty_id ? 'link' : 'text'}
              style={[
                styles.input,
                styles.readonly,
                doc.counterparty_id ? styles.link : styles.readonlyText,
              ]}
              onPress={
                doc.counterparty_id
                  ? () =>
                      router.push({
                        pathname: '/counterparty/[id]',
                        params: { id: String(doc.counterparty_id) },
                      })
                  : undefined
              }
            >
              {doc.counterparty}
            </Text>
          )}
        </View>
      </View>

      {!transfer ? (
        <View style={styles.wide}>
          <Text style={styles.fieldLabel}>Категория платежа</Text>
          {own ? (
            <Dropdown
              value={category ?? doc.category ?? ''}
              options={categoryOptions}
              variant="field"
              label="Категория платежа"
              onChange={setCategory}
            />
          ) : (
            <Text style={[styles.input, styles.readonly, styles.readonlyText]}>{doc.category}</Text>
          )}
        </View>
      ) : null}

      {/* «Привязать к документу» — их поле (`LINK_TO_A_DOCUMENT`) у прихода,
          рождённого чеком. */}
      {doc.sale_id ? (
        <View style={styles.wide}>
          <Text style={styles.fieldLabel}>Привязать к документу</Text>
          <Text
            accessibilityRole="link"
            style={[styles.input, styles.readonly, styles.link]}
            onPress={openSale}
          >
            Продажа #{doc.sale_number ?? doc.sale_id}
          </Text>
        </View>
      ) : null}

      <View style={styles.wide}>
        <Text style={styles.fieldLabel}>Сумма, руб</Text>
        {own ? (
          <TextInput
            value={amount ?? String(doc.amount / 100)}
            onChangeText={setAmount}
            accessibilityLabel="Сумма"
            style={styles.input}
          />
        ) : (
          <Text style={[styles.input, styles.readonly, styles.readonlyText]}>
            {formatMoneyWeb(doc.amount)}
          </Text>
        )}
      </View>

      <View style={styles.wide}>
        <Text style={styles.commentLabel}>Комментарий</Text>
        {own ? (
          <TextInput
            value={note ?? doc.note ?? ''}
            onChangeText={setNote}
            multiline
            accessibilityLabel="Комментарий"
            style={[styles.input, styles.textarea]}
          />
        ) : (
          <Text style={[styles.input, styles.textarea, styles.readonly, styles.readonlyText]}>
            {doc.note ?? ''}
          </Text>
        )}
      </View>

      <View style={styles.totals}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Итог:</Text>
          <Text style={styles.totalValue}>
            {formatMoneyWeb(amount != null ? (parseMoney(amount) ?? doc.amount) : doc.amount)} руб
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

/** «23 августа, 18:15» — так подписана дата документа у него. */
function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  const pad = (value: number) => String(value).padStart(2, '0');

  return `${date.getDate()} ${months[date.getMonth()]}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Та же дата, но так, чтобы её можно было поправить руками. */
function edited(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  content: { padding: 24, paddingBottom: 60, maxWidth: 980 },
  empty: { fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted, padding: 40 },

  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  grow: { flex: 1 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    paddingHorizontal: 22,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(34,36,38,0.15)',
    backgroundColor: '#FFFFFF',
  },
  buttonLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.text },
  green: { backgroundColor: web.green, borderColor: web.green },
  greenLabel: { fontFamily: WEB_FONT, fontSize: 15, color: '#FFFFFF' },
  danger: { borderColor: web.danger },
  dangerLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.danger },

  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: FORM_BORDER,
    marginBottom: 20,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { width: 44, height: 22, borderRadius: 11, backgroundColor: '#D6DAE0', padding: 2 },
  trackOn: { backgroundColor: web.link },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFFFFF' },
  knobOn: { marginLeft: 22 },
  stateLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.text },
  date: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted },
  dateInput: {
    height: 32,
    width: 180,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 10,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
    backgroundColor: '#FFFFFF',
  },

  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  title: { fontFamily: WEB_FONT, fontSize: 30, color: web.text },
  number: {
    fontFamily: WEB_FONT,
    fontSize: 30,
    color: web.text,
    borderBottomWidth: 1,
    borderBottomColor: FORM_BORDER,
    minWidth: 120,
  },

  refs: { flexDirection: 'row', gap: 28, marginTop: 16, marginBottom: 4 },
  refItem: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted },
  link: { color: web.link },

  fields: { flexDirection: 'row', gap: 22, marginTop: 22 },
  field: { flex: 1, gap: 8 },
  wide: { gap: 8, marginTop: 20 },
  fieldLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted },
  commentLabel: { fontFamily: WEB_FONT, fontSize: 17, color: web.textMuted },
  input: {
    height: 42,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 14,
    fontFamily: WEB_FONT,
    fontSize: 15,
    color: web.text,
    backgroundColor: '#FFFFFF',
  },
  textarea: { height: 90, paddingTop: 10, textAlignVertical: 'top' },
  /** Значение, которое здесь не правится: правка — в самом чеке. */
  readonly: { backgroundColor: '#F7F8FA', lineHeight: 40 },
  readonlyText: { color: web.text },

  totals: { marginTop: 28 },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    borderBottomWidth: 1,
    borderBottomColor: FORM_BORDER,
    borderStyle: 'dashed',
    paddingBottom: 8,
  },
  totalLabel: { flex: 1, fontFamily: WEB_FONT, fontSize: 22, color: web.text },
  totalValue: { fontFamily: WEB_FONT, fontSize: 22, color: web.text },
});
