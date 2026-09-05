import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../Translated';

import { formatDay, formatTime, listJournal, listMoney } from '../../db/journal';
import { shiftReport } from '../../db/shifts';
import { formatMoneyWeb } from '../../domain/money';
import { formatQty } from '../../domain/qty';
import type { Id } from '../../domain/types';
import { useQuery } from '../../state/DatabaseProvider';
import { web, webText, WEB_FONT } from '../../ui/webTheme';
import { Drawer, DrawerButton } from '../Drawer';

/**
 * Просмотр смены — панель справа поверх списка смен.
 *
 * Собран его экраном: шапка с полями «Создан · Открыта · Закрыта · Магазин ·
 * Касса», ниже «последние операции» тремя вкладками — Движение товара,
 * Движение денег, Список товаров.
 *
 * Список товаров — его же отчёт по смене: две таблицы, «Продажа товаров» с
 * колонками Кол-во товаров · Сумма продаж · Валовая прибыль и «Возврат
 * товаров» с колонками Кол-во товаров · Сумма возврата.
 */

type Tab = 'goods' | 'money' | 'products';

const TAB_LABEL: Record<Tab, string> = {
  goods: 'Движение товара',
  money: 'Движение денег',
  products: 'Список товаров',
};

export function ShiftView({ id, onClose }: { id: Id; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('goods');

  const report = useQuery((db) => shiftReport(db, id), [id]);

  return (
    <Drawer visible size="xl" onClose={onClose} actions={<DrawerButton label="Закрыть" onPress={onClose} />}>
      <View style={styles.content}>
        <Text style={styles.title}>Смена №{report.shift.id}</Text>

        <View style={styles.info}>
          <Info label="Создан" value={when(report.shift.created_at)} />
          <Info label="Открыта" value={when(report.shift.opened_at)} />
          <Info
            label="Закрыта"
            value={report.shift.closed_at ? when(report.shift.closed_at) : 'ещё открыта'}
          />
          <Info label="Магазин" value={report.location_name ?? '—'} />
          <Info label="Касса" value={report.register_name} />
          <Info label="Кассир" value={report.shift.cashier ?? '—'} />
        </View>

        <View style={styles.tabs}>
          {(Object.keys(TAB_LABEL) as Tab[]).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: tab === value }}
              onPress={() => setTab(value)}
              style={[styles.tab, tab === value && styles.tabOn]}
            >
              <Text style={[styles.tabLabel, tab === value && styles.tabLabelOn]}>
                {TAB_LABEL[value]}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === 'goods' ? <Goods shift={report.shift.opened_at} to={report.shift.closed_at} /> : null}
        {tab === 'money' ? <Money shift={report.shift.opened_at} to={report.shift.closed_at} /> : null}
        {tab === 'products' ? <Products id={id} /> : null}
      </View>
    </Drawer>
  );
}

/**
 * Движение товара за смену.
 *
 * Отбирается по времени, а не по ссылке на смену: складские документы к смене
 * не привязаны — их проводят и вне смены, — а показать надо всё, что
 * происходило, пока она была открыта.
 */
function Goods({ shift, to }: { shift: string; to: string | null }) {
  const entries = useQuery(
    (db) =>
      listJournal(db, 200, { from: shift.slice(0, 10), to: (to ?? shift).slice(0, 10) }),
    [shift, to],
  );

  if (entries.length === 0) return <Empty />;

  return (
    <Table head={['Документ', 'Время', 'Позиций', 'Сумма']}>
      {entries.map((entry) => (
        <Row
          key={`${entry.kind}-${entry.id}`}
          cells={[
            `${entry.kind === 'sale' ? 'Продажа' : entry.kind === 'refund' ? 'Возврат' : 'Документ'} #${entry.id}`,
            formatTime(entry.created_at),
            String(entry.positions),
            formatMoneyWeb(entry.amount),
          ]}
        />
      ))}
    </Table>
  );
}

function Money({ shift, to }: { shift: string; to: string | null }) {
  const entries = useQuery(
    (db) => listMoney(db, 200, { from: shift.slice(0, 10), to: (to ?? shift).slice(0, 10) }),
    [shift, to],
  );

  if (entries.length === 0) return <Empty />;

  return (
    <Table head={['Ордер', 'Время', 'Счёт', 'Приход', 'Расход']}>
      {entries.map((entry) => (
        <Row
          key={`${entry.source}-${entry.id}`}
          cells={[
            `#${entry.id}`,
            formatTime(entry.created_at),
            entry.account,
            entry.income ? formatMoneyWeb(entry.income) : '—',
            entry.expense ? formatMoneyWeb(entry.expense) : '—',
          ]}
        />
      ))}
    </Table>
  );
}

/** Отчёт по товарам смены: продажи и возвраты двумя таблицами, как у него. */
function Products({ id }: { id: Id }) {
  const lines = useQuery((db) => shiftProducts(db, id), [id]);

  const sold = lines.filter((line) => line.qty > 0);
  const returned = lines.filter((line) => line.returned > 0);

  return (
    <View style={styles.blocks}>
      <Text style={styles.blockTitle}>Продажа товаров</Text>
      {sold.length === 0 ? (
        <Empty />
      ) : (
        <Table head={['Наименование', 'Кол-во товаров', 'Сумма продаж', 'Валовая прибыль']}>
          {sold.map((line) => (
            <Row
              key={line.product_id}
              cells={[
                line.name,
                `${formatQty(line.qty)} ${line.unit}`,
                formatMoneyWeb(line.revenue),
                formatMoneyWeb(line.profit),
              ]}
            />
          ))}
        </Table>
      )}

      <Text style={styles.blockTitle}>Возврат товаров</Text>
      {returned.length === 0 ? (
        <Empty text="Возвратов за смену не было" />
      ) : (
        <Table head={['Наименование', 'Кол-во товаров', 'Сумма возврата']}>
          {returned.map((line) => (
            <Row
              key={line.product_id}
              cells={[
                line.name,
                `${formatQty(line.returned)} ${line.unit}`,
                formatMoneyWeb(line.returnedSum),
              ]}
            />
          ))}
        </Table>
      )}
    </View>
  );
}

interface ShiftProduct {
  product_id: Id;
  name: string;
  unit: string;
  qty: number;
  revenue: number;
  profit: number;
  returned: number;
  returnedSum: number;
}

/** Что продали и что вернули за смену — по позициям её чеков. */
function shiftProducts(
  db: Parameters<typeof shiftReport>[0],
  shiftId: Id,
): ShiftProduct[] {
  return db.all<ShiftProduct>(
    `SELECT i.product_id                                       AS product_id,
            p.name                                            AS name,
            p.unit                                            AS unit,
            COALESCE(SUM(CASE WHEN s.total > 0 THEN i.qty END), 0)  AS qty,
            COALESCE(SUM(CASE WHEN s.total > 0
                 THEN CAST(ROUND(i.qty * i.price / 1000.0) AS INTEGER) END), 0)      AS revenue,
            COALESCE(SUM(CASE WHEN s.total > 0
                 THEN CAST(ROUND(i.qty * (i.price - i.cost_price) / 1000.0) AS INTEGER) END), 0) AS profit,
            -- Возвращённый чек обнуляется: у него total = 0, а позиции целы.
            COALESCE(SUM(CASE WHEN s.total = 0 THEN i.qty END), 0)  AS returned,
            COALESCE(SUM(CASE WHEN s.total = 0
                 THEN CAST(ROUND(i.qty * i.price / 1000.0) AS INTEGER) END), 0)      AS returnedSum
     FROM sale_items i
     JOIN sales s   ON s.id = i.sale_id
     JOIN products p ON p.id = i.product_id
     WHERE s.shift_id = ?
     GROUP BY i.product_id
     ORDER BY p.name COLLATE NOCASE`,
    [shiftId],
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <View style={styles.table}>
      <View style={styles.head}>
        {head.map((title, index) => (
          <Text
            key={title}
            style={[styles.th, index > 0 && styles.right, index === 0 && styles.wide]}
          >
            {title}
          </Text>
        ))}
      </View>
      {children}
    </View>
  );
}

function Row({ cells }: { cells: string[] }) {
  return (
    <View style={styles.tr}>
      {cells.map((cell, index) => (
        <Text
          key={index}
          style={[styles.td, index > 0 && styles.right, index === 0 && styles.wide]}
          numberOfLines={2}
        >
          {cell}
        </Text>
      ))}
    </View>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function Empty({ text = 'За смену ничего не было' }: { text?: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

function when(iso: string): string {
  return `${formatDay(iso.slice(0, 10))}, ${formatTime(iso)}`;
}

const styles = StyleSheet.create({
  content: { padding: 26, gap: 20 },
  title: { fontFamily: WEB_FONT, fontSize: 25, color: web.text },
  info: { gap: 10 },
  infoRow: { flexDirection: 'row', gap: 16 },
  infoLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted, width: 130 },
  infoValue: { flex: 1, fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  tabs: { flexDirection: 'row', marginTop: 10 },
  tab: { paddingHorizontal: 22, paddingVertical: 11, borderWidth: 1, borderColor: web.border },
  tabOn: { backgroundColor: '#FFFFFF', borderBottomColor: '#FFFFFF' },
  tabLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },
  tabLabelOn: { color: web.text },
  blocks: { gap: 10 },
  blockTitle: { ...webText.blockTitle, marginTop: 14 },
  table: { borderWidth: 1, borderColor: web.border, borderRadius: 3 },
  head: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: web.tableHead,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  tr: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: web.gridLine,
  },
  th: { flex: 1, fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },
  td: { flex: 1, fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  wide: { flex: 2 },
  right: { textAlign: 'right' },
  empty: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted, padding: 24 },
});
