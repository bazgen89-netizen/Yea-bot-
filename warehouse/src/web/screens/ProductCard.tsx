import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { listLocations, stockByLocation } from '../../db/locations';
import {
  archiveProduct,
  createProduct,
  ensureCategory,
  getProduct,
  listCategories,
  restoreProduct,
  updateProduct,
  type ProductInput,
} from '../../db/products';
import { listMoves } from '../../db/stock';
import { formatMoneyWeb, parseMoney } from '../../domain/money';
import {
  VAT_RATES,
  formatDate,
  formatPercent,
  marginBp,
  markupBp,
  parseDate,
  parsePercent,
  priceFromMarkup,
  priceWithDiscount,
} from '../../domain/pricing';
import { formatQty, parseQty } from '../../domain/qty';
import {
  PRODUCT_KIND_HINT,
  PRODUCT_KIND_LABEL,
  type Id,
  type MoveReason,
  type ProductKind,
} from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { say } from '../../ui/alert';
import { web, webText, WEB_FONT } from '../../ui/webTheme';
import { ToolButton, Toolbar } from '../Table';

/**
 * Карточка товара в кабинете.
 *
 * До этого на широком экране открывалась телефонная карточка: одна узкая
 * колонка в пустом поле. У оригинала здесь широкая карточка из блоков
 * («card-wrap», заголовок 18 пикселей начертанием 500), поля в две колонки,
 * остаток расписан по магазинам.
 *
 * Подписи полей — его же: «Наименование», «Себестоимость», «Ед. изм.»,
 * «Мин. остаток». Они взяты из словаря подписей, а не переведены заново:
 * человек, перешедший из CloudShop, ищет глазами знакомое слово.
 */

const REASON_LABEL: Record<MoveReason, string> = {
  receipt: 'Приход',
  writeoff: 'Списание',
  sale: 'Продажа',
  adjust: 'Инвентаризация',
  return: 'Возврат',
};

export function ProductCard({ id }: { id: string }) {
  const router = useRouter();
  const { db, refresh } = useDatabase();

  const isNew = id === 'new';
  const productId = isNew ? null : Number(id);

  const product = useQuery(
    (database) => (productId ? getProduct(database, productId) : null),
    [productId],
  );
  const categories = useQuery((database) => listCategories(database));
  const locations = useQuery((database) => listLocations(database));
  const stock = useQuery((database) => stockByLocation(database));

  const [kind, setKind] = useState<ProductKind>(product?.kind ?? 'product');
  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState(product?.category_name ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [code, setCode] = useState(product?.code ?? '');
  const [barcode, setBarcode] = useState(product?.barcode ?? '');
  const [unit, setUnit] = useState(product?.unit ?? 'шт');
  const [cost, setCost] = useState(product ? formatMoneyWeb(product.cost_price) : '');
  const [price, setPrice] = useState(product ? formatMoneyWeb(product.sale_price) : '');
  const [discount, setDiscount] = useState(
    product?.discount_bp ? String(product.discount_bp / 100) : '',
  );
  const [vatBp, setVatBp] = useState<number | null>(product?.vat_bp ?? null);
  const [expires, setExpires] = useState(product?.expires_at ? formatDate(product.expires_at) : '');
  const [minQty, setMinQty] = useState(product?.min_qty ? formatQty(product.min_qty) : '');

  const costValue = cost.trim() ? (parseMoney(cost) ?? 0) : 0;
  const priceValue = price.trim() ? (parseMoney(price) ?? 0) : 0;
  const markup = markupBp(costValue, priceValue);
  const margin = marginBp(costValue, priceValue);
  const discountBp = discount.trim() ? (parsePercent(discount) ?? 0) : 0;

  function save() {
    if (!name.trim()) {
      say('Нужно наименование', 'Без наименования товар не сохранить.');
      return;
    }

    const min = minQty.trim() ? parseQty(minQty) : 0;
    if (costValue === null || priceValue === null || min === null) {
      say('Проверьте числа', 'Цены и минимальный остаток должны быть числами.');
      return;
    }

    const expiresAt = expires.trim() ? parseDate(expires) : null;
    if (expires.trim() && expiresAt === null) {
      say('Проверьте срок годности', 'Дата пишется как 31.12.2026.');
      return;
    }

    const input: ProductInput = {
      name: name.trim(),
      kind,
      sku: sku.trim() || null,
      code: code.trim() || null,
      barcode: barcode.trim() || null,
      category_id: category.trim() ? ensureCategory(db, category) : null,
      unit: unit.trim() || 'шт',
      cost_price: costValue,
      sale_price: priceValue,
      min_qty: min,
      vat_bp: vatBp,
      expires_at: expiresAt,
      discount_bp: discountBp,
      photo_uri: product?.photo_uri ?? null,
    };

    try {
      if (productId) updateProduct(db, productId, input);
      else createProduct(db, input);
      refresh();
      router.back();
    } catch (error) {
      const message = String(error);
      say(
        'Не удалось сохранить',
        message.includes('UNIQUE') ? 'Такой штрих-код уже есть у другого товара.' : message,
      );
    }
  }

  const byShop = productId ? stock.get(productId) : undefined;
  const total = locations.reduce((sum, shop) => sum + (byShop?.get(shop.id) ?? 0), 0);

  return (
    <View style={styles.screen}>
      <Toolbar>
        <ToolButton label="Сохранить" tone="green" onPress={save} />
        <ToolButton label="Отмена" onPress={() => router.back()} />
        {product ? (
          <ToolButton
            label={product.archived ? 'Вернуть из архива' : 'В архив'}
            tone="orangeOutline"
            onPress={() => {
              if (product.archived) restoreProduct(db, product.id);
              else archiveProduct(db, product.id);
              refresh();
            }}
          />
        ) : null}
      </Toolbar>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={webText.pageTitle}>{isNew ? 'Создание товара' : name || 'Товар'}</Text>

        <View style={styles.columns}>
          <View style={styles.column}>
            <Block title="Основные">
              <Row label="Вид">
                <View style={styles.kinds}>
                  {(Object.keys(PRODUCT_KIND_LABEL) as ProductKind[]).map((value) => (
                    <Pressable
                      key={value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: kind === value }}
                      onPress={() => setKind(value)}
                      style={[styles.kind, kind === value && styles.kindOn]}
                    >
                      <Text style={[styles.kindLabel, kind === value && styles.kindLabelOn]}>
                        {PRODUCT_KIND_LABEL[value]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </Row>
              <Text style={styles.hint}>{PRODUCT_KIND_HINT[kind]}</Text>

              <Row label="Наименование">
                <Input value={name} onChange={setName} placeholder="Шу пуэр 2019" />
              </Row>
              <Row label="Категория">
                <Input value={category} onChange={setCategory} placeholder="Пуэр" />
              </Row>
              {categories.length > 0 ? (
                <Text style={styles.hint}>
                  Уже есть: {categories.map((item) => item.name).join(', ')}
                </Text>
              ) : null}

              <View style={styles.pair}>
                <Row label="Артикул" half>
                  <Input value={sku} onChange={setSku} placeholder="SH-01" />
                </Row>
                <Row label="Код товара" half>
                  <Input value={code} onChange={setCode} placeholder="0001" />
                </Row>
              </View>

              <View style={styles.pair}>
                <Row label="Ед. изм." half>
                  <Input value={unit} onChange={setUnit} placeholder="шт" />
                </Row>
                <Row label="Штрих-код" half>
                  <Input value={barcode} onChange={setBarcode} placeholder="4600000000001" />
                </Row>
              </View>
            </Block>

            <Block title="Фотография">
              <View style={styles.photo}>
                {product?.photo_uri ? (
                  <Image source={{ uri: product.photo_uri }} style={styles.photoImage} />
                ) : (
                  <Text style={styles.hint}>Фотография добавляется с телефона</Text>
                )}
              </View>
            </Block>
          </View>

          <View style={styles.column}>
            <Block title="Цены и скидки">
              <View style={styles.pair}>
                <Row label="Себестоимость" half>
                  <Input value={cost} onChange={setCost} placeholder="0.00" numeric />
                </Row>
                <Row label="Цена продажи" half>
                  <Input value={price} onChange={setPrice} placeholder="0.00" numeric />
                </Row>
              </View>

              <View style={styles.pair}>
                <Row label="Наценка" half>
                  <Input
                    value={markup === null ? '' : String(markup / 100)}
                    onChange={(value) => {
                      const bp = parsePercent(value);
                      if (bp !== null && costValue > 0) setPrice(formatMoneyWeb(priceFromMarkup(costValue, bp)));
                    }}
                    placeholder="0"
                    numeric
                  />
                </Row>
                <Row label="Маржа" half>
                  <Text style={styles.readonly}>
                    {margin === null ? '—' : formatPercent(margin)}
                  </Text>
                </Row>
              </View>

              <View style={styles.pair}>
                <Row label="Скидка" half>
                  <Input value={discount} onChange={setDiscount} placeholder="0" numeric />
                </Row>
                <Row label="НДС" half>
                  <View style={styles.kinds}>
                    {VAT_RATES.map((rate) => {
                      const on = vatBp === rate.bp;
                      return (
                        <Pressable
                          key={rate.label}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          onPress={() => setVatBp(rate.bp)}
                          style={[styles.vat, on && styles.kindOn]}
                        >
                          <Text style={[styles.kindLabel, on && styles.kindLabelOn]}>
                            {rate.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </Row>
              </View>

              {discountBp > 0 ? (
                <Text style={styles.hint}>
                  Цена со скидкой {formatMoneyWeb(priceWithDiscount(priceValue, discountBp))}
                </Text>
              ) : null}
            </Block>

            <Block title="Остаток">
              {productId ? (
                <>
                  {locations.map((shop) => {
                    const qty = byShop?.get(shop.id) ?? 0;
                    return (
                      <View key={shop.id} style={styles.stockRow}>
                        <Text style={webText.cell}>{shop.name}</Text>
                        <Text
                          style={[
                            webText.cellNumber,
                            styles.stockValue,
                            qty < 0 && { color: web.danger },
                          ]}
                        >
                          {formatQty(qty)} {unit}
                        </Text>
                      </View>
                    );
                  })}
                  <View style={[styles.stockRow, styles.stockTotal]}>
                    <Text style={[webText.cell, styles.bold]}>Всего</Text>
                    <Text style={[webText.cellNumber, styles.stockValue, styles.bold]}>
                      {formatQty(total)} {unit}
                    </Text>
                  </View>
                </>
              ) : (
                <Text style={styles.hint}>Остаток появится после первого документа</Text>
              )}

              <View style={styles.pair}>
                <Row label="Мин. остаток" half>
                  <Input value={minQty} onChange={setMinQty} placeholder="0" numeric />
                </Row>
                <Row label="Срок годности" half>
                  <Input value={expires} onChange={setExpires} placeholder="31.12.2026" />
                </Row>
              </View>
            </Block>
          </View>
        </View>

        {productId ? <History productId={productId} /> : null}
      </ScrollView>
    </View>
  );
}

/** Блок карточки — «card-wrap» оригинала: рамка снизу и заголовок 18/500. */
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockHeader}>{title}</Text>
      <View style={styles.blockBody}>{children}</View>
    </View>
  );
}

function Row({
  label,
  half,
  children,
}: {
  label: string;
  half?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.row, half && styles.rowHalf]}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  numeric,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  numeric?: boolean;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={web.textMuted}
      style={[styles.input, numeric && styles.inputNumeric]}
    />
  );
}

function History({ productId }: { productId: Id }) {
  const moves = useQuery((database) => listMoves(database, productId, 40), [productId]);

  return (
    <View style={styles.block}>
      <Text style={styles.blockHeader}>История движений</Text>
      <View style={styles.blockBody}>
        {moves.length === 0 ? (
          <Text style={styles.hint}>Движений пока не было</Text>
        ) : (
          moves.map((move) => (
            <View key={move.id} style={styles.stockRow}>
              <Text style={webText.cell}>{REASON_LABEL[move.reason]}</Text>
              <Text style={webText.cellSmall}>
                {new Date(move.created_at).toLocaleString('ru-RU')}
              </Text>
              <Text
                style={[
                  webText.cellNumber,
                  styles.stockValue,
                  { color: move.qty_delta > 0 ? web.greenText : web.danger },
                ]}
              >
                {move.qty_delta > 0 ? '+' : ''}
                {formatQty(move.qty_delta)} {move.unit}
              </Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  content: { padding: 26, paddingBottom: 60, gap: 22 },
  columns: { flexDirection: 'row', gap: 22 },
  column: { flex: 1, gap: 22 },
  block: {
    borderWidth: 1,
    borderColor: '#D3E0E9',
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 1,
    shadowOffset: { width: 0, height: 1 },
  },
  // 18 пикселей начертанием 500 — как «.card-wrap .header» в оригинале.
  blockHeader: {
    fontFamily: WEB_FONT, fontSize: 18,
    fontWeight: '500',
    color: '#33425B',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#D3E0E9',
  },
  blockBody: { padding: 14, gap: 12 },
  row: { gap: 5 },
  rowHalf: { flex: 1 },
  pair: { flexDirection: 'row', gap: 14 },
  label: { fontFamily: WEB_FONT, fontSize: 12, color: '#555555', textTransform: 'uppercase' },
  input: {
    height: 34,
    borderWidth: 1,
    borderColor: '#D9DBDE',
    borderRadius: 3,
    paddingHorizontal: 10,
    fontFamily: WEB_FONT, fontSize: 14,
    color: web.text,
  },
  inputNumeric: { textAlign: 'right' },
  readonly: { height: 34, lineHeight: 34, fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted },
  hint: { fontFamily: WEB_FONT, fontSize: 12, color: web.textMuted, lineHeight: 17 },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  kind: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#D9DBDE',
    borderRadius: 3,
  },
  vat: {
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#D9DBDE',
    borderRadius: 3,
  },
  kindOn: { backgroundColor: web.link, borderColor: web.link },
  kindLabel: { fontFamily: WEB_FONT, fontSize: 13, color: web.text },
  kindLabelOn: { color: '#FFFFFF' },
  photo: {
    height: 150,
    borderWidth: 1,
    borderColor: '#D9DBDE',
    borderStyle: 'dashed',
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoImage: { width: '100%', height: '100%' },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: web.gridLine,
  },
  stockValue: { textAlign: 'right' },
  stockTotal: { borderBottomWidth: 0 },
  bold: { fontWeight: '700' },
});
