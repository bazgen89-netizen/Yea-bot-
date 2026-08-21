import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '../Translated';
import { getSale, refundSale } from '../../db/sales';
import { SALE_ACCOUNT } from '../../db/money';
import { formatMoneyWeb } from '../../domain/money';
import { formatQty } from '../../domain/qty';
import type { Id } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { confirm, say } from '../../ui/alert';
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
  const { db, refresh } = useDatabase();
  const sale = useQuery((database) => getSale(database, id), [id]);

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

  function back() {
    if (router.canGoBack()) router.back();
    else router.replace('/journal');
  }

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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" onPress={back} style={styles.close}>
          <Text style={styles.closeGlyph}>✕</Text>
        </Pressable>

        <View style={styles.barSpace} />

        {!sale.refunded ? (
          <Pressable accessibilityRole="button" onPress={askRefund} style={styles.danger}>
            <Text style={styles.dangerLabel}>Возврат</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.titleRow}>
        <Text style={styles.title}>
          {sale.refunded ? 'Возврат продажи' : 'Продажа'} #{sale.number ?? sale.id}
        </Text>
        <Text style={styles.kind}>Документ</Text>
      </View>

      <View style={styles.chips}>
        <View style={styles.chip}>
          <Text style={styles.chipLabel}>Создан {longDate(sale.created_at)}</Text>
        </View>
        <View style={[styles.chip, styles.chipDone]}>
          <Text style={[styles.chipLabel, styles.chipDoneLabel]}>Документ проведён</Text>
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
          <Text style={[styles.cellNo, styles.headText]}>#</Text>
          <Text style={[styles.cellWide, styles.headText]}>Счёт</Text>
          <Text style={[styles.cellWide, styles.headText]}>Контрагент</Text>
          <Text style={[styles.cellDate, styles.headText]}>Дата</Text>
          <Text style={[styles.cellSum, styles.headText]}>Сумма</Text>
        </View>

        <View style={styles.row}>
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
      <View style={styles.table}>
        <View style={[styles.row, styles.headRow]}>
          <Text style={[styles.cellName, styles.headText]}>Наименование</Text>
          <Text style={[styles.cellCode, styles.headText]}>Штрих-код</Text>
          <Text style={[styles.cellCode, styles.headText]}>Артикул</Text>
          <Text style={[styles.cellNum, styles.headText]}>Количество</Text>
          <Text style={[styles.cellNum, styles.headText]}>Цена</Text>
          <Text style={[styles.cellNum, styles.headText]}>Итог</Text>
        </View>

        {sale.items.map((item) => (
          <View key={item.id} style={styles.row}>
            <Text style={[styles.cellName, styles.link]}>{item.name}</Text>
            <Text style={styles.cellCode}>{item.barcode ?? ''}</Text>
            <Text style={styles.cellCode}>{item.sku ?? ''}</Text>
            <Text style={styles.cellNum}>{formatQty(item.qty)}</Text>
            <Text style={styles.cellNum}>{formatMoneyWeb(item.price)}</Text>
            <Text style={styles.cellNum}>
              {formatMoneyWeb(Math.round((item.qty * item.price) / 1000))}
            </Text>
          </View>
        ))}

        <View style={[styles.row, styles.totalRow]}>
          <Text style={[styles.cellName, styles.totalText]}>Итог</Text>
          <Text style={styles.cellCode} />
          <Text style={styles.cellCode} />
          <Text style={[styles.cellNum, styles.totalText]}>{formatQty(quantity)}</Text>
          <Text style={styles.cellNum}>—</Text>
          <Text style={[styles.cellNum, styles.totalText]}>{formatMoneyWeb(sale.total)}</Text>
        </View>
      </View>
    </ScrollView>
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

  cellName: { flex: 1, fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  cellCode: { width: 150, fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  cellNum: {
    width: 110,
    textAlign: 'right',
    fontFamily: WEB_FONT,
    fontSize: 13,
    color: web.text,
    fontVariant: ['tabular-nums'],
  },
});
