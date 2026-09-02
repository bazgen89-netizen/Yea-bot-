import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Translated';
import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';

import { InlineFilter, type FilterValue, type InlineField } from '../InlineFilter';
import { listLocations, stockByLocation } from '../../db/locations';
import { getProduct, productCategories, setItems, storePrices } from '../../db/products';
import {
  productMoveOptions,
  productMoves,
  productMovesCount,
  type JournalMoveKind,
  type ProductMovesFilter,
} from '../../db/stock';
import { DOC_KIND_LABEL } from '../../domain/types';
import { formatMoneyWeb } from '../../domain/money';
import { formatDate, formatPercent, marginBp, markupBp } from '../../domain/pricing';
import { formatQty } from '../../domain/qty';
import { PRODUCT_KIND_LABEL, type Id } from '../../domain/types';
import { useQuery } from '../../state/DatabaseProvider';
import { WebIcon } from '../../ui/icons';
import { web, WEB_FONT } from '../../ui/webTheme';

/**
 * Просмотр товара — то, что видно, когда на товар нажали в справочнике.
 *
 * Только содержимое: панель, в которой оно живёт, и полоса кнопок над ним —
 * в `Drawer` и `ProductCard`. Здесь не должно быть ни того, ни другого, иначе
 * при переходе к правке полоса дёргалась бы, перерисовываясь вместе с телом.
 *
 * Разделы и подписи — его: «ЦЕНЫ», «СОСТАВ КОМЛЕКТА» (с его же опечаткой в
 * слове), «СКЛАД», вкладки «Информация» и «История движения».
 */

export function ProductView({ id }: { id: Id }) {
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
    <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.photo}>
            {product.photo_uri ? (
              <Image
                source={{ uri: product.photo_uri }}
                resizeMode="contain"
                style={styles.photoImage}
              />
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

/**
 * История движения товара — его вкладка «История движения».
 *
 * Колонки взяты из их шаблона
 * (`js/pages/card/catalog/show/blocks/history.html`): дата, документ с
 * автором под ним, себестоимость, цена, приход, расход, остаток. Приход и
 * расход — две отдельные колонки: в одной стоит число, в другой пусто, и по
 * странице сразу видно, чего у товара было больше. Раньше здесь стояло одно
 * число со знаком и колонки «Магазин» и «Кто», которых у него нет.
 *
 * Отбор — его же: дата (по умолчанию год), магазин, тип, сотрудник. И его
 * листалка: по двадцать строк, «показать еще» и «Всего документов».
 */
const HISTORY_KINDS: { value: JournalMoveKind; label: string }[] = [
  ...(Object.keys(DOC_KIND_LABEL) as (keyof typeof DOC_KIND_LABEL)[]).map((kind) => ({
    value: kind as JournalMoveKind,
    label: DOC_KIND_LABEL[kind],
  })),
];

function History({ productId }: { productId: Id }) {
  const router = useRouter();
  const options = useQuery((db) => productMoveOptions(db, productId), [productId]);

  // Дата с самого начала стоит годом — как у него: `defaultValue` этого поля
  // отсчитывает год назад от сегодня. Без неё вкладка открывалась бы всей
  // историей, а у ходового чая это тысячи строк.
  const [values, setValues] = useState<Record<string, FilterValue>>(() => {
    const to = new Date();
    const from = new Date();
    from.setFullYear(from.getFullYear() - 1);
    return { dateFrom: day(from), dateTo: day(to) };
  });
  const [shown, setShown] = useState(20);

  const filter = useMemo<ProductMovesFilter>(
    () => ({
      from: values.dateFrom as string | undefined,
      to: values.dateTo as string | undefined,
      location: values.location as string | undefined,
      author: values.author as string | undefined,
      kind: values.kind as JournalMoveKind | undefined,
    }),
    [values],
  );

  const moves = useQuery(
    (db) => productMoves(db, productId, filter, shown),
    [productId, filter, shown],
  );
  const total = useQuery(
    (db) => productMovesCount(db, productId, filter),
    [productId, filter],
  );

  const fields: InlineField[] = [
    // Дату у него снять нельзя — поле `required`, и крестика у него нет.
    { key: 'date', label: 'Дата', kind: 'date', show: true, required: true, width: 186 },
    {
      key: 'location',
      label: 'Магазин',
      kind: 'select',
      show: true,
      width: 196,
      options: options.locations.map((value) => ({ value, label: value })),
    },
    { key: 'kind', label: 'Тип', kind: 'select', show: true, width: 196, options: HISTORY_KINDS },
    {
      key: 'author',
      label: 'Сотрудник',
      kind: 'select',
      width: 186,
      options: options.authors.map((value) => ({ value, label: value })),
    },
  ];

  return (
    <View>
      <InlineFilter
        fields={fields}
        values={values}
        onChange={(key, value) => {
          setShown(20);
          setValues((current) => ({ ...current, [key]: value }));
        }}
      />

      {moves.length === 0 ? (
        <Text style={styles.empty}>Не найдено</Text>
      ) : (
        <>
          <View style={styles.table}>
            <View style={styles.tableHead}>
              <Text style={[styles.th, styles.dateCol]}>Дата</Text>
              <Text style={[styles.th, styles.docCol, styles.left]}>Документ</Text>
              <Text style={[styles.th, styles.numCol, styles.right]}>Себестоимость</Text>
              <Text style={[styles.th, styles.numCol, styles.right]}>Цена</Text>
              <Text style={[styles.th, styles.numCol, styles.right]}>Приход</Text>
              <Text style={[styles.th, styles.numCol, styles.right]}>Расход</Text>
              <Text style={[styles.th, styles.numCol, styles.right]}>Остаток</Text>
            </View>

            {moves.map((move) => {
              const when = moveDay(move.created_at);

              return (
                <View key={move.id} style={styles.tr}>
                  <View style={[styles.dateCol, styles.dateCell]}>
                    <Text style={styles.dateBig}>{when.day}</Text>
                    <Text style={styles.dateSmall}>{when.rest}</Text>
                  </View>

                  <View style={styles.docCol}>
                    <Text
                      accessibilityRole="link"
                      style={styles.docLink}
                      numberOfLines={1}
                      onPress={() =>
                        move.sale_id
                          ? router.push({
                              pathname: '/sale/[id]',
                              params: { id: String(move.sale_id) },
                            })
                          : router.push({
                              pathname: '/doc/[id]',
                              // Вид передаётся адресом: по нему заголовок
                              // подписывает документ тем, чем он и является.
                              params: { id: String(move.doc_id), kind: move.kind },
                            })
                      }
                    >
                      {`${KIND_TITLE[move.kind] ?? 'Документ'} #${move.number ?? move.doc_id ?? move.sale_id}`}
                    </Text>
                    {move.author ? (
                      <Text
                        accessibilityRole="link"
                        style={styles.docAuthor}
                        numberOfLines={1}
                        onPress={() => router.push('/staff')}
                      >
                        {move.author}
                      </Text>
                    ) : null}
                  </View>

                  <Text style={[styles.td, styles.numCol, styles.right]}>
                    {move.cost === null ? '' : formatMoneyWeb(move.cost)}
                  </Text>
                  <Text style={[styles.td, styles.numCol, styles.right]}>
                    {formatMoneyWeb(move.price)}
                  </Text>
                  {/* Приход и расход — в разных колонках, как у него:
                      `item.qty > 0 ? qty : ''` и наоборот. */}
                  <Text style={[styles.td, styles.numCol, styles.right]}>
                    {move.qty_delta > 0 ? formatQty(move.qty_delta) : ''}
                  </Text>
                  <Text style={[styles.td, styles.numCol, styles.right]}>
                    {move.qty_delta < 0 ? formatQty(move.qty_delta) : ''}
                  </Text>
                  <Text style={[styles.td, styles.numCol, styles.right]}>
                    {formatQty(move.qty_after)}
                  </Text>
                </View>
              );
            })}
          </View>

          {total > moves.length ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShown((count) => count + 20)}
              style={styles.more}
            >
              <Text style={styles.moreLabel}>показать еще</Text>
            </Pressable>
          ) : null}

          <Text style={styles.totalDocs}>Всего документов: {total}</Text>
        </>
      )}
    </View>
  );
}

/** Как подписан документ в строке истории. Возврат чеком — тот же возврат. */
const KIND_TITLE: Record<string, string> = {
  ...DOC_KIND_LABEL,
  refund: DOC_KIND_LABEL.sale_return,
};

const MONTHS = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

/**
 * Дата в две строки — как у него: крупно число, под ним месяц.
 *
 * Год он дописывает двумя цифрами и только у прошлых лет:
 * `t.format("YYYY") !== moment().format("YYYY") && date.push(t.format("YY"))`.
 */
function moveDay(iso: string): { day: string; rest: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { day: '—', rest: '' };

  const month = MONTHS[date.getMonth()];
  const sameYear = date.getFullYear() === new Date().getFullYear();

  return {
    day: String(date.getDate()),
    rest: sameYear ? month : `${month}, ${String(date.getFullYear()).slice(2)}`,
  };
}

/** «2026-08-14» из даты — для отбора. */
function day(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

  /**
   * Ширины колонок истории — из их разметки: дата 10 %, числовые по 18 %,
   * документу достаётся остальное.
   */
  dateCol: { width: 56 },
  docCol: { flex: 1, minWidth: 150, paddingRight: 10 },
  /**
   * Числовые колонки — своей ширины, а не долей.
   *
   * У него они заданы процентами (18 % на каждую из пяти), и в сумме с датой
   * выходит больше ста: браузер отдаёт колонке документа то, что осталось по
   * содержимому. У нас доли делятся честно, и документу оставалось 15 % —
   * «Корректировка #1» обрезалась в «Корректиро…».
   */
  numCol: { width: 108 },
  dateCell: { alignItems: 'center' },
  /** Число крупнее месяца — у него `font-size: 1.1em` на первой строке. */
  dateBig: { fontFamily: WEB_FONT, fontSize: 15, color: web.text, textAlign: 'center' },
  dateSmall: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted, textAlign: 'center' },
  docLink: { fontFamily: WEB_FONT, fontSize: 14, color: web.link },
  docAuthor: { fontFamily: WEB_FONT, fontSize: 12, color: web.link, marginTop: 2 },
  more: { alignSelf: 'flex-start', paddingVertical: 10 },
  moreLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.link },
  totalDocs: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted, paddingBottom: 10 },
});
