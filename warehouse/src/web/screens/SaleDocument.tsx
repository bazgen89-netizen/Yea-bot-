import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Drawer } from '../Drawer';
import { Text, TextInput } from '../Translated';
import { getSale, refundSale } from '../../db/sales';
import { SALE_ACCOUNT } from '../../db/money';
import { formatMoneyWeb } from '../../domain/money';
import { formatQty } from '../../domain/qty';
import type { Id } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { confirm, say } from '../../ui/alert';
import { WebIcon } from '../../ui/icons';
import { FORM_BORDER, web, WEB_FONT } from '../../ui/webTheme';

/**
 * Просмотр чека — как у него страница документа.
 *
 * Шапка отвечает на «что это и чьё»: магазин, клиент, автор, касса, смена
 * слева; скидка, сумма, оплачено, налог справа. Ниже — чем платили и что
 * купили, двумя таблицами.
 *
 * Раньше здесь была карточка телефона: номер, дата, список строк. На широком
 * экране она отвечала на четверть вопросов — ни магазина, ни автора, ни того,
 * какой скидкой сложилась цена.
 */
export function SaleDocument({ id }: { id: Id }) {
  const router = useRouter();

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/journal');
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Body id={id} onClose={back} />
    </ScrollView>
  );
}

/**
 * Тот же документ, но панелью поверх журнала — как открывается у него.
 *
 * Он кликает документ в «Движении товара», и журнал остаётся слева: закрыл
 * панель — и ты там же, где был, не надо заново искать строку. У нас документ
 * открывался отдельной страницей, и журнал уезжал целиком.
 */
export function SaleDocumentDrawer({ id, onClose }: { id: Id; onClose: () => void }) {
  return (
    <Drawer visible size="xl" onClose={onClose} actions={<Actions id={id} onClose={onClose} />}>
      <View style={styles.content}>
        <Body id={id} onClose={onClose} bare />
      </View>
    </Drawer>
  );
}

/**
 * Кнопки полосы действий — его набор.
 *
 * Правка, печать и выгрузка приглушены: правка проведённого чека, печать
 * чека и выгрузка документа файлом ещё не сделаны, и кнопка, которая делает
 * вид, что работает, хуже приглушённой. Возврат — работает.
 */
function Actions({ id, onClose }: { id: Id; onClose: () => void }) {
  const { db, refresh } = useDatabase();
  const sale = useQuery((database) => getSale(database, id), [id]);

  function askRefund() {
    confirm(
      'Оформить возврат?',
      'Товар вернётся на склад, а чек перестанет учитываться в выручке.',
      'Вернуть',
      () => {
        try {
          refundSale(db, id);
          refresh();
          onClose();
        } catch (error) {
          say('Не удалось оформить возврат', String(error));
        }
      },
    );
  }

  return (
    <>
      <Tool label="Редактировать" tone="green" soon />
      <Tool label="Напечатать" icon={<WebIcon.printer size={17} color={web.textMuted} />} soon />
      <Tool label="Выгрузить" icon={<WebIcon.download size={17} color={web.textMuted} />} soon />
      <Tool
        label="Возврат"
        icon={<WebIcon.history size={17} color={sale?.refunded ? web.textMuted : web.text} />}
        soon={Boolean(sale?.refunded)}
        onPress={askRefund}
      />
      <Tool label="Удалить" tone="dangerOutline" right soon />
    </>
  );
}

function Tool({
  label,
  icon,
  tone = 'plain',
  soon,
  right,
  onPress,
}: {
  label: string;
  icon?: React.ReactNode;
  tone?: 'plain' | 'green' | 'dangerOutline';
  /** Ещё не сделано: кнопка видна, но приглушена и не нажимается. */
  soon?: boolean;
  right?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: soon }}
      disabled={soon || !onPress}
      onPress={onPress}
      style={[
        styles.tool,
        tone === 'green' && styles.toolGreen,
        tone === 'dangerOutline' && styles.toolDanger,
        right && styles.toolRight,
        soon && styles.toolSoon,
      ]}
    >
      {icon}
      {/* У кнопок с одним значком подписи в кабинете нет — она нужна тем,
          кто слушает экран, поэтому остаётся невидимой подписью. */}
      {icon ? null : (
        <Text
          style={[
            styles.toolLabel,
            tone === 'green' && styles.toolLabelGreen,
            tone === 'dangerOutline' && styles.toolLabelDanger,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function Body({ id, onClose, bare }: { id: Id; onClose: () => void; bare?: boolean }) {
  const { db, refresh } = useDatabase();
  const sale = useQuery((database) => getSale(database, id), [id]);
  const [search, setSearch] = useState('');

  if (!sale) return <Text style={styles.empty}>Документ не найден</Text>;

  const subtotal = sale.items.reduce(
    (sum, item) => sum + Math.round((item.qty * item.price) / 1000),
    0,
  );
  // Скидка в процентах от того, что было до неё: у него в шапке стоит и
  // процент, и рубли — «17% (170.10 руб)».
  const percent = subtotal ? Math.round((sale.discount / subtotal) * 1000) / 10 : 0;
  const account = SALE_ACCOUNT[sale.payment] ?? 'Касса магазина';
  const quantity = sale.items.reduce((sum, item) => sum + item.qty, 0);

  function askRefund() {
    confirm(
      'Оформить возврат?',
      'Товар вернётся на склад, а чек перестанет учитываться в выручке.',
      'Вернуть',
      () => {
        try {
          refundSale(db, id);
          refresh();
        } catch (error) {
          say('Не удалось оформить возврат', String(error));
        }
      },
    );
  }

  const shown = search.trim()
    ? sale.items.filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()))
    : sale.items;

  return (
    <>
      {bare ? null : (
        <View style={styles.bar}>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
            <Text style={styles.closeGlyph}>✕</Text>
          </Pressable>

          <View style={styles.barSpace} />

          {!sale.refunded ? (
            <Pressable accessibilityRole="button" onPress={askRefund} style={styles.danger}>
              <Text style={styles.dangerLabel}>Возврат</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <View style={styles.titleRow}>
        <Text style={styles.title}>
          {sale.refunded ? 'Возврат продажи' : 'Продажа'} #{sale.number ?? sale.id}
        </Text>
        <Text style={styles.kind}>Документ</Text>
      </View>

      <View style={styles.chips}>
        <View style={styles.chip}>
          <WebIcon.calendar size={14} color={web.textMuted} />
          <Text style={styles.chipLabel}>Создан {longDate(sale.created_at)}</Text>
        </View>

        <View style={[styles.chip, styles.chipDone]}>
          <Text style={[styles.chipLabel, styles.chipDoneLabel]}>
            {sale.refunded ? 'Документ возвращён' : 'Документ проведён'}
          </Text>
          <WebIcon.caretDown size={12} color="#FFFFFF" />
        </View>

        {/* «Статус заказа» — у него третьей фишкой. Заказов у нас нет:
            чек пробивается на кассе целиком, промежуточных состояний
            («собирается», «выдан») не бывает. Поэтому фишка стоит, но
            статуса не показывает — придумывать его я не стал. */}
        <View style={styles.chip}>
          <Text style={styles.chipLabel}>Статус заказа</Text>
          <WebIcon.caretDown size={12} color={web.textMuted} />
        </View>
      </View>

      <View style={styles.head}>
        <View style={styles.headColumn}>
          <Field label="Магазин" value={sale.store} link />
          <Field label="Клиент" value={sale.customer ?? 'Розничный покупатель'} link />
          <Field label="Автор" value={sale.author} link />
          <Field label="Касса" value={sale.register} link />
          <Field label="Смена" value={sale.shift_number ? `#${sale.shift_number}` : null} link />
        </View>

        <View style={styles.headColumn}>
          <Field
            label="Скидка"
            value={
              sale.discount
                ? `${percent}% (${formatMoneyWeb(sale.discount)} руб)`
                : `0% (${formatMoneyWeb(0)} руб)`
            }
          />
          <Field label="Сумма" value={`${formatMoneyWeb(sale.total)} руб`} />
          <Field label="Оплаченные" value={`${formatMoneyWeb(sale.total - sale.debt)} руб`} />
          <Field label="Сумма налога" value={`${formatMoneyWeb(0)} руб`} />
        </View>
      </View>

      <Divider>Оплата</Divider>
      <View style={styles.table}>
        <View style={[styles.row, styles.headRow]}>
          <View style={styles.cellDot} />
          <Text style={[styles.cellNo, styles.headText]}>#</Text>
          <Text style={[styles.cellWide, styles.headText]}>Счёт</Text>
          <Text style={[styles.cellWide, styles.headText]}>Контрагент</Text>
          <Text style={[styles.cellDate, styles.headText]}>Дата</Text>
          <Text style={[styles.cellSum, styles.headText]}>Сумма</Text>
        </View>

        <View style={styles.row}>
          {/* Синяя точка слева — метка оплаты, как у него. */}
          <View style={styles.cellDot}>
            <View style={styles.dot} />
          </View>
          <Text style={[styles.cellNo, styles.link]}>{sale.money_number ?? sale.id}</Text>
          <Text style={[styles.cellWide, styles.link]}>{account}</Text>
          <Text style={[styles.cellWide, styles.link]}>
            {sale.customer ?? 'Розничный покупатель'}
          </Text>
          <Text style={styles.cellDate}>{longDate(sale.created_at)}</Text>
          <Text style={styles.cellSum}>{formatMoneyWeb(sale.total)} руб</Text>
        </View>
      </View>

      <Divider>Товары</Divider>

      {/* Поиск по строкам документа — как у него над таблицей товаров.
          В чеке на три позиции он не нужен, а в приходе на две сотни — да. */}
      <View style={styles.goodsBar}>
        <View style={styles.searchBox}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Поиск товаров"
            placeholderTextColor={web.textMuted}
            style={styles.searchInput}
          />
          <WebIcon.search size={16} color={web.textMuted} />
        </View>
      </View>

      <View style={styles.table}>
        <View style={[styles.row, styles.headRow]}>
          <Text style={[styles.cellName, styles.headText]}>Наименование</Text>
          <Text style={[styles.cellCode, styles.headText]}>Штрих-код</Text>
          <Text style={[styles.cellCode, styles.headText]}>Артикул</Text>
          <Text style={[styles.cellNum, styles.headText]}>Количество</Text>
          <Text style={[styles.cellNum, styles.headText]}>Цена</Text>
          <Text style={[styles.cellNum, styles.headText]}>Скидка</Text>
          <Text style={[styles.cellNum, styles.headText]}>Итог</Text>
        </View>

        {shown.map((item) => {
          const sum = Math.round((item.qty * item.price) / 1000);
          return (
            <View key={item.id} style={styles.row}>
              <View style={styles.cellName}>
                <WebIcon.products size={15} color={web.textMuted} />
                <Text style={[styles.itemName, styles.link]} numberOfLines={2}>
                  {item.name}
                </Text>
              </View>
              <Text style={styles.cellCode}>{item.barcode ?? ''}</Text>
              <Text style={styles.cellCode}>{item.sku ?? ''}</Text>
              <Text style={styles.cellNum}>{formatQty(item.qty)}</Text>
              <Text style={styles.cellNum}>{formatMoneyWeb(item.price)}</Text>
              <Text style={styles.cellNum}>{formatMoneyWeb(item.discount ?? 0)}</Text>
              <Text style={styles.cellNum}>{formatMoneyWeb(sum - (item.discount ?? 0))}</Text>
            </View>
          );
        })}

        <View style={[styles.row, styles.totalRow]}>
          <Text style={[styles.cellName, styles.totalText]}>Итог</Text>
          <Text style={styles.cellCode} />
          <Text style={styles.cellCode} />
          <Text style={[styles.cellNum, styles.totalText]}>{formatQty(quantity)}</Text>
          <Text style={styles.cellNum}>-</Text>
          <Text style={[styles.cellNum, styles.totalText]}>{formatMoneyWeb(sale.discount)}</Text>
          <Text style={[styles.cellNum, styles.totalText]}>{formatMoneyWeb(sale.total)}</Text>
        </View>
      </View>
    </>
  );
}

function Field({
  label,
  value,
  link,
}: {
  label: string;
  value: string | null;
  link?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, link && styles.link]} numberOfLines={1}>
        {value ?? '—'}
      </Text>
    </View>
  );
}

function Divider({ children }: { children: string }) {
  return (
    <View style={styles.divider}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerLabel}>{children.toUpperCase()}</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

/** «20 августа 2026» — как подписан документ у него. */
function longDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  content: { padding: 24, paddingBottom: 60 },
  empty: { fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted, padding: 40 },

  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },

  tool: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minWidth: 44,
    height: 38,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(34,36,38,0.15)',
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  toolGreen: { backgroundColor: web.green, borderColor: web.green },
  toolDanger: { borderColor: web.danger },
  toolRight: { marginLeft: 'auto' },
  toolSoon: { opacity: 0.45 },
  toolLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  toolLabelGreen: { color: '#FFFFFF' },
  toolLabelDanger: { color: web.danger },
  barSpace: { flex: 1 },
  close: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: { fontFamily: WEB_FONT, fontSize: 16, color: web.text },
  danger: {
    height: 38,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: web.danger,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.danger },

  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 16 },
  title: { flex: 1, fontFamily: WEB_FONT, fontSize: 30, color: web.text },
  kind: { fontFamily: WEB_FONT, fontSize: 24, color: '#D8DCE3' },

  chips: { flexDirection: 'row', gap: 10, marginTop: 12, marginBottom: 20 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipDone: { backgroundColor: '#00B5AD', borderColor: '#00B5AD' },
  chipLabel: { fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  chipDoneLabel: { color: '#FFFFFF' },

  head: { flexDirection: 'row', gap: 60 },
  headColumn: { flex: 1, gap: 10 },
  field: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  fieldLabel: { width: 130, fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted },
  fieldValue: { flex: 1, fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  link: { color: web.link },

  divider: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 32, marginBottom: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: FORM_BORDER },
  dividerLabel: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted, letterSpacing: 0.6 },

  table: { borderWidth: 1, borderColor: FORM_BORDER, borderRadius: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: FORM_BORDER,
  },
  headRow: { backgroundColor: web.tableHead, borderTopWidth: 0 },
  headText: { color: web.textMuted },
  totalRow: { backgroundColor: web.tableHead },
  totalText: { fontWeight: '700' },

  cellDot: { width: 26, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: web.link },

  goodsBar: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: 280,
    height: 38,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  searchInput: { flex: 1, fontFamily: WEB_FONT, fontSize: 14, color: web.text },

  itemName: { flex: 1, fontFamily: WEB_FONT, fontSize: 13, color: web.text },

  cellNo: { width: 70, fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  cellWide: { flex: 1, fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  cellDate: { width: 170, fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  cellSum: {
    width: 130,
    textAlign: 'right',
    fontFamily: WEB_FONT,
    fontSize: 13,
    color: web.text,
    fontVariant: ['tabular-nums'],
  },

  cellName: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  cellCode: { width: 130, fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  cellNum: {
    width: 96,
    textAlign: 'right',
    fontFamily: WEB_FONT,
    fontSize: 13,
    color: web.text,
    fontVariant: ['tabular-nums'],
  },
});
