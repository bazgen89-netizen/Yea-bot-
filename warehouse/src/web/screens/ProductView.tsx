import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';

import { listLocations, stockByLocation } from '../../db/locations';
import { getProduct, productCategories, setItems, storePrices } from '../../db/products';
import { listMoves } from '../../db/stock';
import { formatMoneyWeb } from '../../domain/money';
import { formatDate, formatPercent, marginBp, markupBp } from '../../domain/pricing';
import { formatQty } from '../../domain/qty';
import { PRODUCT_KIND_LABEL, type Id, type MoveReason } from '../../domain/types';
import { useQuery } from '../../state/DatabaseProvider';
import { WebIcon } from '../../ui/icons';
import { web, WEB_FONT } from '../../ui/webTheme';

/**
 * Просмотр товара — панель справа поверх справочника.
 *
 * Именно панель, а не отдельная страница: в исходном приложении адрес
 * выглядит как `/catalog/list/m/get/<id>`, и список остаётся виден слева.
 * Так после закрытия карточки не нужно заново искать, где ты был, а соседние
 * товары открываются один за другим.
 *
 * Разделы и подписи — его: «ЦЕНЫ», «СОСТАВ КОМЛЕКТА» (с его же опечаткой в
 * слове), «СКЛАД», вкладки «Информация» и «История движения».
 */

const REASON_LABEL: Record<MoveReason, string> = {
  receipt: 'Приход',
  writeoff: 'Списание',
  sale: 'Продажа',
  adjust: 'Инвентаризация',
  return: 'Возврат',
};

export function ProductView({
  id,
  onClose,
  onEdit,
}: {
  id: Id;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [tab, setTab] = useState<'info' | 'history'>('info');

  const product = useQuery((db) => getProduct(db, id), [id]);
  const locations = useQuery((db) => listLocations(db));
  const stock = useQuery((db) => stockByLocation(db));
  const prices = useQuery((db) => storePrices(db, id), [id]);
  const composition = useQuery((db) => setItems(db, id), [id]);
  const categories = useQuery((db) => productCategories(db, id), [id]);

  if (!product) return null;

  const byShop = stock.get(id);
  const markup = markupBp(product.purchase_price, product.sale_price);
  const margin = marginBp(product.cost_price, product.sale_price);

  return (
    <View style={styles.panel}>
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={onClose}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onEdit} style={styles.edit}>
          <Text style={styles.editLabel}>Редактировать</Text>
        </Pressable>
        <View style={styles.spacer} />
        <Pressable accessibilityRole="button" style={styles.remove}>
          <Text style={styles.removeLabel}>Удалить</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.photo}>
            {product.photo_uri ? (
              <Image source={{ uri: product.photo_uri }} style={styles.photoImage} />
            ) : (
              <WebIcon.products size={54} color="#D3D6D9" />
            )}
          </View>

          <View style={styles.headerText}>
            <Text style={styles.kind}>{PRODUCT_KIND_LABEL[product.kind]}</Text>
            <Text style={styles.name}>{product.name}</Text>
            <Field label="Штрих-код" value={product.barcode} />
            <Field label="Артикул" value={product.sku} />
            <Field label="Код товара" value={product.code} />
          </View>
        </View>

        <View style={styles.tabs}>
          {(['info', 'history'] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: tab === value }}
              onPress={() => setTab(value)}
              style={[styles.tab, tab === value && styles.tabOn]}
            >
              <Text style={[styles.tabLabel, tab === value && styles.tabLabelOn]}>
                {value === 'info' ? 'Информация' : 'История движения'}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === 'history' ? (
          <History productId={id} />
        ) : (
          <>
            <View style={styles.info}>
              <Info label="Создан" value={new Date(product.created_at).toLocaleDateString('ru-RU')} />
              <Info label="Категории" value={categories.join(', ') || null} />
              <Info label="Страна" value={product.country} />
              <Info label="Срок годности" value={product.expires_at ? formatDate(product.expires_at) : null} />
              {/* Группа — папка каталога, а не категория: у него это дерево
                  со своим окном выбора. Пока его нет, строка стоит пустой —
                  повторять здесь категорию значило бы выдать одно за другое. */}
              <Info label="Группа" value={null} />
              <Info label="Описание" value={product.description} />
            </View>

            <Section title="ЦЕНЫ" />
            <Table
              head={['Цена продажи', 'Цена закупки', 'Себестоимость', 'Наценка', 'Маржинальность']}
              rows={[[
                formatMoneyWeb(product.sale_price),
                formatMoneyWeb(product.purchase_price),
                formatMoneyWeb(product.cost_price),
                markup === null ? '—' : formatPercent(markup),
                margin === null ? '—' : formatPercent(margin),
              ]]}
            />

            {product.kind === 'set' ? (
              <>
                <Section title="СОСТАВ КОМЛЕКТА" />
                <Table
                  head={['Наименование', 'Кол-во', 'Цена продажи, руб', 'Стоимость, руб']}
                  first
                  rows={composition.map((item) => [
                    item.name,
                    `${formatQty(item.qty)} ${item.unit}`,
                    formatMoneyWeb(item.price),
                    formatMoneyWeb(item.sum),
                  ])}
                  empty="Состав комплекта не заполнен"
                />
              </>
            ) : null}

            <Section title="СКЛАД" />
            <Table
              head={[
                'Магазин',
                'Цена продажи, руб',
                `Остаток, ${product.unit}`,
                'По себестоимости, руб',
                'По цене продажи, руб',
              ]}
              first
              rows={locations.map((shop) => {
                const qty = byShop?.get(shop.id) ?? 0;
                const price = prices.get(shop.id) ?? product.sale_price;
                return [
                  shop.name,
                  formatMoneyWeb(price),
                  formatQty(qty),
                  formatMoneyWeb(Math.round((qty * product.cost_price) / 1000)),
                  formatMoneyWeb(Math.round((qty * price) / 1000)),
                ];
              })}
              total={totalRow(locations, byShop, product.cost_price, product.sale_price, prices)}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** Строка «Итог» склада: количество и обе оценки, цена продажи — прочерком. */
function totalRow(
  locations: { id: Id; name: string }[],
  byShop: Map<Id, number> | undefined,
  cost: number,
  salePrice: number,
  prices: Map<Id, number>,
): string[] {
  let qty = 0;
  let byCost = 0;
  let bySale = 0;

  for (const shop of locations) {
    const amount = byShop?.get(shop.id) ?? 0;
    qty += amount;
    byCost += Math.round((amount * cost) / 1000);
    bySale += Math.round((amount * (prices.get(shop.id) ?? salePrice)) / 1000);
  }

  return ['Итог', '—', formatQty(qty), formatMoneyWeb(byCost), formatMoneyWeb(bySale)];
}

function History({ productId }: { productId: Id }) {
  const moves = useQuery((db) => listMoves(db, productId, 60), [productId]);

  if (moves.length === 0) {
    return <Text style={styles.empty}>Движений пока не было</Text>;
  }

  return (
    <Table
      head={['Документ', 'Дата', 'Количество']}
      first
      rows={moves.map((move) => [
        REASON_LABEL[move.reason],
        new Date(move.created_at).toLocaleString('ru-RU'),
        `${move.qty_delta > 0 ? '+' : ''}${formatQty(move.qty_delta)} ${move.unit}`,
      ])}
    />
  );
}

function Section({ title }: { title: string }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionLine} />
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionLine} />
    </View>
  );
}

/** Подпись и значение в шапке: «Штрих-код: —». */
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}:</Text>
      <Text style={styles.fieldValue}>{value?.trim() ? value : '—'}</Text>
    </View>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value?.trim() ? value : '—'}</Text>
    </View>
  );
}

function Table({
  head,
  rows,
  total,
  first,
  empty,
}: {
  head: string[];
  rows: string[][];
  total?: string[];
  /** Первая колонка — текстовая, остальные числовые и прижаты вправо. */
  first?: boolean;
  empty?: string;
}) {
  return (
    <View style={styles.table}>
      <View style={styles.tableHead}>
        {head.map((title, index) => (
          <Text
            key={title}
            style={[styles.th, index > 0 || first ? styles.right : null, first && index === 0 && styles.left]}
          >
            {title}
          </Text>
        ))}
      </View>

      {rows.map((row, index) => (
        <View key={index} style={styles.tr}>
          {row.map((cell, cellIndex) => (
            <Text
              key={cellIndex}
              style={[styles.td, cellIndex > 0 || first ? styles.right : null, first && cellIndex === 0 && styles.left]}
              numberOfLines={2}
            >
              {cell}
            </Text>
          ))}
        </View>
      ))}

      {rows.length === 0 && empty ? <Text style={styles.empty}>{empty}</Text> : null}

      {total ? (
        <View style={[styles.tr, styles.totalRow]}>
          {total.map((cell, index) => (
            <Text
              key={index}
              style={[styles.td, styles.bold, index > 0 ? styles.right : styles.left]}
            >
              {cell}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: '#FFFFFF' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: web.border,
  },
  close: { fontFamily: WEB_FONT, fontSize: 20, color: web.textMuted },
  edit: { backgroundColor: web.green, borderRadius: 3, paddingHorizontal: 22, paddingVertical: 10 },
  editLabel: { fontFamily: WEB_FONT, fontSize: 14, color: '#FFFFFF' },
  spacer: { flex: 1 },
  remove: {
    borderWidth: 1,
    borderColor: web.danger,
    borderRadius: 3,
    paddingHorizontal: 22,
    paddingVertical: 9,
  },
  removeLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.danger },
  content: { padding: 24, paddingBottom: 60 },
  header: { flexDirection: 'row', gap: 26 },
  photo: {
    width: 150,
    height: 150,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoImage: { width: '100%', height: '100%' },
  headerText: { flex: 1, gap: 5 },
  kind: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },
  name: { fontFamily: WEB_FONT, fontSize: 25, color: web.text, marginBottom: 8 },
  field: { flexDirection: 'row', gap: 10 },
  fieldLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted, width: 110 },
  fieldValue: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  tabs: { flexDirection: 'row', justifyContent: 'center', gap: 0, marginTop: 30 },
  tab: {
    paddingHorizontal: 26,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: web.border,
  },
  tabOn: { backgroundColor: '#FFFFFF', borderBottomColor: '#FFFFFF' },
  tabLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },
  tabLabelOn: { color: web.text },
  info: { marginTop: 22, gap: 12 },
  infoRow: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  infoLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted, width: 160 },
  infoValue: { fontFamily: WEB_FONT, fontSize: 14, color: web.text, flex: 1 },
  section: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 34, marginBottom: 6 },
  sectionLine: { flex: 1, height: 1, backgroundColor: web.border },
  sectionTitle: { fontFamily: WEB_FONT, fontSize: 14, color: web.text, letterSpacing: 0.6 },
  table: { borderWidth: 1, borderColor: web.border, borderRadius: 3, marginTop: 10 },
  tableHead: {
    flexDirection: 'row',
    backgroundColor: web.tableHead,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  th: { flex: 1, fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted, textAlign: 'center' },
  tr: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: web.gridLine,
  },
  td: { flex: 1, fontFamily: WEB_FONT, fontSize: 14, color: web.text, textAlign: 'center' },
  left: { textAlign: 'left' },
  right: { textAlign: 'right' },
  bold: { fontWeight: '700' },
  totalRow: { backgroundColor: web.tableHead },
  empty: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted, padding: 20 },
});
