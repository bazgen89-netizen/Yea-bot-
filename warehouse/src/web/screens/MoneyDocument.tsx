import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Drawer, DrawerButton } from '../Drawer';
import { Dropdown, type Option } from '../Dropdown';
import { Text, TextInput } from '../Translated';
import { listCounterparties } from '../../db/counterparties';
import {
  ACCOUNTS,
  CATEGORIES,
  deleteMoneyDoc,
  getMoneyDoc,
  updateMoneyDoc,
  type MoneySource,
} from '../../db/money';
import { updateSalePayment } from '../../db/sales';
import { formatMoneyWeb, parseMoney } from '../../domain/money';
import type { Id } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { confirm, say } from '../../ui/alert';
import { WebIcon } from '../../ui/icons';
import { FORM_BORDER, web, WEB_FONT } from '../../ui/webTheme';

/**
 * Ордер движения денег — панелью поверх списка, как у него.
 *
 * Он прислал снимок: адрес `card/money/m/money/show/…`, и в нём кусок
 * `/m/` — это их «панель». Список остаётся слева, закрыл крестиком и ты там
 * же, где был. Я открывал документ отдельной страницей, и список пропадал
 * вместе с отбором и местом прокрутки.
 *
 * Разметка — их `js/pages/orders/page/_view.html` и его снимок:
 * переключатель «Документ проведён» и дата с карандашом сверху, заголовок
 * «Просмотр ордера # 46150», строки «Касса» и «Смена», поля «Счёт» и
 * «Контрагент» в две колонки, «Категория платежа», «Сумма, руб» значением
 * вправо и «Комментарий». Подписи полей — полужирные, со звёздочкой у
 * обязательных. Итога внизу у них нет, и у меня он был лишним.
 */
export function MoneyDocumentDrawer({
  id,
  source = 'doc',
  onClose,
  nested,
}: {
  id: Id;
  source?: MoneySource;
  onClose: () => void;
  /** Открыт поверх другой панели — например, из чека по номеру оплаты. */
  nested?: boolean;
}) {
  return <Body id={id} source={source} onClose={onClose} nested={nested} />;
}

/** Тот же ордер отдельной страницей — для прямой ссылки на документ. */
export function MoneyDocument({ id, source = 'doc' }: { id: Id; source?: MoneySource }) {
  const router = useRouter();

  return (
    <Body
      id={id}
      source={source}
      onClose={() => (router.canGoBack() ? router.back() : router.replace('/money'))}
    />
  );
}

function Body({
  id,
  source,
  onClose,
  nested,
}: {
  id: Id;
  source: MoneySource;
  onClose: () => void;
  nested?: boolean;
}) {
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

  if (!doc) {
    return (
      <Drawer visible size="m" nested={nested} onClose={onClose}>
        <Text style={styles.empty}>Документ не найден</Text>
      </Drawer>
    );
  }

  const transfer = doc.type === 'transfer';
  /**
   * Приход по чеку — тоже ордер, и часть полей в нём правится.
   *
   * У них в этой форме недоступен «Счёт», когда деньги легли в кассу
   * (`disabled="id && account.type == 'register'"`). У нас к этому
   * добавляется сумма: приход по чеку отдельной записью не лежит, он и есть
   * итог чека, и менять его надо в самом чеке — иначе деньги разойдутся с
   * проданным товаром.
   */
  const own = doc.source === 'doc';

  const partyId = party ?? (doc.counterparty_id ? String(doc.counterparty_id) : '');

  function save() {
    if (!doc) return;

    if (!own) {
      updateSalePayment(db, id, {
        customerId: partyId ? Number(partyId) : null,
        note: note ?? doc.note,
      });
      refresh();
      onClose();
      return;
    }

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
        counterpartyId: partyId ? Number(partyId) : null,
        counterparty: partyId
          ? (parties.find((one) => String(one.id) === partyId)?.name ?? null)
          : null,
        category: category ?? doc.category,
        note: note ?? doc.note,
        createdAt: date ?? undefined,
      });
      refresh();
      onClose();
    } catch (error) {
      say('Не удалось сохранить', String(error));
    }
  }

  function remove() {
    if (!own) {
      confirm(
        'Удалить чек?',
        'Этот приход — сам чек. Удалять его надо в движении товара, там же вернётся товар.',
        'Открыть чек',
        () => {
          onClose();
          router.push({ pathname: '/sale/[id]', params: { id: String(doc?.sale_id ?? id) } });
        },
      );
      return;
    }

    confirm(
      'Удалить документ?',
      'Деньги по нему перестанут учитываться в кассе и в отчётах.',
      'Удалить',
      () => {
        deleteMoneyDoc(db, id);
        refresh();
        onClose();
      },
    );
  }

  const accountOptions: Option<string>[] = ACCOUNTS.map((name) => ({ value: name, label: name }));
  // Пустой контрагент у прихода — это покупатель с улицы, а у расхода
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
    <Drawer
      visible
      // Ширина — по его снимку: панель занимает примерно 840 точек, список
      // слева остаётся читаемым до колонки «Приход, руб».
      size="m"
      nested={nested}
      onClose={onClose}
      actions={
        <>
          <DrawerButton label="Сохранить" tone="green" onPress={save} />
          <DrawerButton label="Удалить" tone="dangerOutline" onPress={remove} right />
        </>
      }
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.stateRow}>
          {/* Состояние, а не выключатель: отложенных денежных документов у
              нас не бывает, и переключатель, который нельзя переключить,
              обещал бы то, чего нет. */}
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
              placeholder="2026-08-23 19:16"
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

        {/* «Просмотр ордера # 46150» — его заголовок, а не «Приход #». Тип
            документа виден по строке в списке и по категории платежа. */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>Просмотр ордера #</Text>
          <Text style={styles.number}>{doc.number ?? doc.id}</Text>
        </View>

        {doc.register || doc.shift_number ? (
          <View style={styles.refs}>
            {doc.register ? (
              <View style={styles.refRow}>
                <Text style={styles.refLabel}>Касса</Text>
                <Text
                  accessibilityRole="link"
                  style={styles.link}
                  onPress={() => router.push('/registers')}
                >
                  {doc.register}
                </Text>
              </View>
            ) : null}
            {doc.shift_number ? (
              <View style={styles.refRow}>
                <Text style={styles.refLabel}>Смена</Text>
                <Text
                  accessibilityRole="link"
                  style={styles.link}
                  onPress={() => router.push('/shifts')}
                >
                  #{doc.shift_number}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.fields}>
          <View style={styles.field}>
            <Label text={transfer ? 'Со счёта' : 'Счёт'} required />
            {own ? (
              <Dropdown
                value={account ?? doc.account}
                options={accountOptions}
                variant="field"
                label="Счёт"
                onChange={setAccount}
              />
            ) : (
              // Счёт у прихода по чеку не меняется — так же, как у него.
              <Text style={[styles.input, styles.locked]}>{doc.account}</Text>
            )}
          </View>

          <View style={styles.field}>
            <Label text={transfer ? 'На счёт' : 'Контрагент'} required />
            <Dropdown
              value={transfer ? (accountTo ?? doc.account_to ?? '') : partyId}
              options={transfer ? accountOptions : partyOptions}
              variant="field"
              label={transfer ? 'На счёт' : 'Контрагент'}
              onChange={transfer ? setAccountTo : setParty}
            />
          </View>
        </View>

        {!transfer ? (
          <View style={styles.wide}>
            <Label text="Категория платежа" required />
            {own ? (
              <Dropdown
                value={category ?? doc.category ?? ''}
                options={categoryOptions}
                variant="field"
                label="Категория платежа"
                onChange={setCategory}
              />
            ) : (
              <Text style={[styles.input, styles.locked]}>{doc.category}</Text>
            )}
          </View>
        ) : null}

        {/* «Привязать к документу» — их поле (`LINK_TO_A_DOCUMENT`) у
            прихода, рождённого чеком. */}
        {doc.sale_id ? (
          <View style={styles.wide}>
            <Label text="Привязать к документу" />
            <Text
              accessibilityRole="link"
              style={[styles.input, styles.linkField]}
              onPress={() => {
                onClose();
                router.push({ pathname: '/sale/[id]', params: { id: String(doc.sale_id) } });
              }}
            >
              Продажа #{doc.sale_number ?? doc.sale_id}
            </Text>
          </View>
        ) : null}

        <View style={styles.wide}>
          <Label text="Сумма, руб" required />
          {own ? (
            <TextInput
              value={amount ?? String(doc.amount / 100)}
              onChangeText={setAmount}
              accessibilityLabel="Сумма"
              style={[styles.input, styles.right]}
            />
          ) : (
            <Text style={[styles.input, styles.locked, styles.right]}>
              {formatMoneyWeb(doc.amount)}
            </Text>
          )}
        </View>

        <View style={styles.wide}>
          <Text style={styles.commentLabel}>Комментарий</Text>
          <TextInput
            value={note ?? doc.note ?? ''}
            onChangeText={setNote}
            multiline
            accessibilityLabel="Комментарий"
            style={[styles.input, styles.textarea]}
          />
        </View>
      </ScrollView>
    </Drawer>
  );
}

/** Подпись поля: полужирная, со звёздочкой у обязательных — как у него. */
function Label({ text, required }: { text: string; required?: boolean }) {
  return (
    <Text style={styles.fieldLabel}>
      {text}
      {required ? <Text style={styles.star}> *</Text> : null}
    </Text>
  );
}

/** «23 августа, 19:16» — так подписана дата документа у него. */
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
  content: { padding: 30, paddingBottom: 60 },
  empty: { fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted, padding: 40 },

  grow: { flex: 1 },

  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 26 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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

  refs: { marginTop: 18, marginBottom: 6, gap: 6 },
  refRow: { flexDirection: 'row', alignItems: 'center' },
  refLabel: { width: 170, fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted },
  link: { fontFamily: WEB_FONT, fontSize: 14, color: web.link },

  fields: { flexDirection: 'row', gap: 22, marginTop: 20 },
  field: { flex: 1, gap: 8 },
  wide: { gap: 8, marginTop: 20 },
  /** Подпись поля у него — полужирная и тёмная, а не серая. */
  fieldLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text, fontWeight: '700' },
  star: { color: web.danger, fontWeight: '700' },
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
    lineHeight: 40,
  },
  right: { textAlign: 'right' },
  /** Поле, которое здесь не правится: у него такое же — серым текстом. */
  locked: { color: web.textMuted },
  linkField: { color: web.link },
  textarea: { height: 150, paddingTop: 10, lineHeight: 20, textAlignVertical: 'top' },
});
