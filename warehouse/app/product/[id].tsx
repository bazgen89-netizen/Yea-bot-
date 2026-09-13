import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View,  } from 'react-native';

import {
  createProduct,
  ensureCategory,
  getProduct,
  listCategories,
  restoreProduct,
  updateProduct,
  type ProductInput,
} from '../../src/db/products';
import { adjustStock, listMoves, stockByLocation } from '../../src/db/stock';
import { formatMoney, formatMoneyWithSign, parseMoney } from '../../src/domain/money';
import {
  VAT_RATES,
  formatDate,
  formatPercent,
  markupBp,
  marginBp,
  parseDate,
  parsePercent,
  priceFromMarkup,
  priceWithDiscount,
} from '../../src/domain/pricing';
import { formatQty, formatQtyWithUnit, parseQty } from '../../src/domain/qty';
import {
  PRODUCT_KIND_HINT,
  PRODUCT_KIND_LABEL,
  type MoveReason,
  type ProductKind,
  type ProductWithStock,
} from '../../src/domain/types';
import { useDatabase, useQuery } from '../../src/state/DatabaseProvider';
import { useDesktop } from '../../src/ui/useDesktop';
import { CatalogTable } from '../../src/web/screens/CatalogTable';
import { useScanner } from '../../src/state/ScannerProvider';
import { Badge, Button, Card, Choice, Field, Row } from '../../src/ui/components';
import { colors, radius, spacing, text } from '../../src/ui/theme';
import { say } from '../../src/ui/alert';

const REASON_LABEL: Record<MoveReason, string> = {
  receipt: 'Приход',
  writeoff: 'Списание',
  sale: 'Продажа',
  adjust: 'Инвентаризация',
  return: 'Возврат',
};

export default function ProductScreen() {
  // На широком экране — карточка кабинета: две колонки, остаток по магазинам.
  // Раньше здесь показывалась телефонная вёрстка, единственная в кабинете.
  const desktop = useDesktop();
  const params = useLocalSearchParams<{ id: string; barcode?: string; type?: string }>();

  // На широком экране карточка — панель поверх справочника, а не отдельная
  // страница: у него так же. Поэтому здесь рисуется сам справочник, а панель
  // над ним открывается сразу — тогда по ссылке из отчёта видно и товар, и
  // список, из которого он.
  if (desktop) return <CatalogTable openId={params.id} />;

  return <ProductPhone />;
}

/**
 * Карточка товара на телефоне: сперва смотреть, править — по карандашу.
 *
 * До этого экран открывался сразу формой правки: «Вид: Товар / Услуга /
 * Комплект», поля, кнопка сохранить. У Вазгена в CloudShop иначе — он
 * прислал снимок: фотография во весь верх, под ней вкладки «Информация» и
 * «История», дальше строки «название — значение», цены, остаток по каждому
 * магазину и категории. Править открывается отдельно.
 *
 * Так и правильнее: в карточку заходят посмотреть остаток и цену в сто раз
 * чаще, чем переименовать товар, а форма правки на каждом открытии — это
 * приглашение задеть цену локтем.
 */
function ProductPhone() {
  const params = useLocalSearchParams<{ id: string }>();
  const isNew = params.id === 'new';
  const productId = isNew ? null : Number(params.id);

  const product = useQuery(
    (database) => (productId ? getProduct(database, productId) : null),
    [productId],
  );

  const [editing, setEditing] = useState(isNew);

  if (isNew || editing || !product) {
    return <ProductForm onDone={() => (isNew ? null : setEditing(false))} />;
  }

  return <ProductView product={product} onEdit={() => setEditing(true)} />;
}

function ProductForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { db, refresh } = useDatabase();
  const { scanBarcode } = useScanner();
  const params = useLocalSearchParams<{ id: string; barcode?: string; type?: string }>();

  const isNew = params.id === 'new';
  const productId = isNew ? null : Number(params.id);

  const product = useQuery(
    (database) => (productId ? getProduct(database, productId) : null),
    [productId],
  );
  const categories = useQuery((database) => listCategories(database));

  const [name, setName] = useState(product?.name ?? '');
  const [kind, setKind] = useState<ProductKind>(
    product?.kind ?? ((params.type as ProductKind) || 'product'),
  );
  const [sku, setSku] = useState(product?.sku ?? '');
  const [code, setCode] = useState(product?.code ?? '');
  const [barcode, setBarcode] = useState(product?.barcode ?? params.barcode ?? '');
  const [unit, setUnit] = useState(product?.unit ?? 'шт');
  const [category, setCategory] = useState(product?.category_name ?? '');
  const [purchasePrice, setPurchasePrice] = useState(
    product?.purchase_price ? formatMoney(product.purchase_price) : '',
  );
  const [salePrice, setSalePrice] = useState(
    product ? formatMoney(product.sale_price) : '',
  );
  const [discount, setDiscount] = useState(
    product?.discount_bp ? String(product.discount_bp / 100).replace('.', ',') : '',
  );
  const [vatBp, setVatBp] = useState<number | null>(product?.vat_bp ?? null);
  const [expires, setExpires] = useState(product ? formatDateInput(product.expires_at) : '');
  const [minQty, setMinQty] = useState(product?.min_qty ? formatQty(product.min_qty) : '');
  const [photoUri, setPhotoUri] = useState(product?.photo_uri ?? null);

  // Наценка и маржа не хранятся: это две записи одних и тех же цен, и
  // считаются на лету, чтобы не разойтись с ними после правки.
  //
  // Считаются они от разного, и это не описка. Наценка — сколько накинули
  // сверх цены закупки, той, что в накладной. Маржа — от себестоимости,
  // средней по всем закупкам. Пока закупка была одна, числа совпадают;
  // после второй по другой цене — расходятся.
  const purchase = purchasePrice.trim() ? (parseMoney(purchasePrice) ?? 0) : 0;
  const sale = salePrice.trim() ? (parseMoney(salePrice) ?? 0) : 0;
  const cost = product?.cost_price ?? purchase;
  const markup = markupBp(purchase, sale);
  const margin = marginBp(cost, sale);

  /** Ввели наценку — подставляем цену продажи. Так это работает в исходнике. */
  function applyMarkup(input: string) {
    const bp = parsePercent(input);
    if (bp === null || purchase === 0) return;
    setSalePrice(formatMoney(priceFromMarkup(purchase, bp)));
  }

  function save() {
    if (!name.trim()) {
      say('Нужно название', 'Без названия товар не сохранить.');
      return;
    }

    const parsedPurchase = purchasePrice.trim() ? parseMoney(purchasePrice) : 0;
    const parsedSale = salePrice.trim() ? parseMoney(salePrice) : 0;
    const min = minQty.trim() ? parseQty(minQty) : 0;
    const discountBp = discount.trim() ? parsePercent(discount) : 0;

    if (parsedPurchase === null || parsedSale === null || min === null || discountBp === null) {
      say('Проверьте числа', 'Цены, скидка и минимальный остаток должны быть числами.');
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
      // Себестоимость не вводится: она средняя по закупкам и пересчитывается
      // приходом. У товара, которого ещё не покупали, взять её неоткуда —
      // и до первой закупки она равна цене из накладной.
      cost_price: product?.cost_price ?? parsedPurchase,
      purchase_price: parsedPurchase,
      sale_price: parsedSale,
      min_qty: min,
      vat_bp: vatBp,
      expires_at: expiresAt,
      discount_bp: discountBp,
      photo_uri: photoUri,
    };

    try {
      if (productId) {
        updateProduct(db, productId, input);
      } else {
        createProduct(db, input);
      }
      refresh();
      // Правка существующего товара возвращает к карточке, а не уводит с
      // экрана: человек чаще всего хочет убедиться, что вышло как надо.
      if (productId) onDone();
      else router.back();
    } catch (error) {
      const message = String(error);
      // Единственное ограничение уникальности в таблице — штрихкод.
      say(
        'Не удалось сохранить',
        message.includes('UNIQUE')
          ? 'Такой штрихкод уже есть у другого товара.'
          : message,
      );
    }
  }

  async function pickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      say('Нет доступа к фото', 'Разрешите доступ к галерее в настройках.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: isNew ? 'Новый товар' : 'Товар' }} />

      <Card>
        <Pressable onPress={pickPhoto} style={styles.photoBox} accessibilityRole="button">
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photo} />
          ) : (
            <Text style={text.muted}>Добавить фото</Text>
          )}
        </Pressable>

        <Choice
          label="Вид"
          value={kind}
          options={(Object.keys(PRODUCT_KIND_LABEL) as ProductKind[]).map((value) => ({
            value,
            label: PRODUCT_KIND_LABEL[value],
          }))}
          onChange={setKind}
        />
        <Text style={[text.muted, styles.hint]}>{PRODUCT_KIND_HINT[kind]}</Text>

        <Field label="Название" value={name} onChangeText={setName} placeholder="Шу пуэр 2019" />
        <Field
          label="Категория"
          value={category}
          onChangeText={setCategory}
          placeholder="Пуэр"
          hint={
            categories.length > 0
              ? `Уже есть: ${categories.map((c) => c.name).join(', ')}`
              : 'Новая категория создастся автоматически'
          }
        />

        <View style={styles.pair}>
          <Field
            label="Артикул"
            value={sku}
            onChangeText={setSku}
            placeholder="SH-01"
            containerStyle={styles.pairInput}
          />
          <Field
            label="Код товара"
            value={code}
            onChangeText={setCode}
            placeholder="0001"
            containerStyle={styles.pairInput}
          />
        </View>

        <Field
          label="Единица"
          value={unit}
          onChangeText={setUnit}
          placeholder="шт / кг / г"
        />

        <Text style={text.muted}>Штрихкод</Text>
        <View style={styles.barcodeRow}>
          <TextInput
            value={barcode}
            onChangeText={setBarcode}
            placeholder="4600000000001"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            style={styles.barcodeInput}
          />
          <Button
            title="Скан"
            variant="secondary"
            onPress={async () => {
              const code = await scanBarcode();
              if (code) setBarcode(code);
            }}
            style={styles.scanButton}
          />
        </View>
        <Text style={[text.muted, styles.hint]}>
          Отсканированный код подставится в это поле
        </Text>

        <View style={styles.pair}>
          <Field
            label="Цена закупки"
            value={purchasePrice}
            onChangeText={setPurchasePrice}
            placeholder="0,00"
            keyboardType="decimal-pad"
            containerStyle={styles.pairInput}
          />
          <Field
            label="Цена продажи"
            value={salePrice}
            onChangeText={setSalePrice}
            placeholder="0,00"
            keyboardType="decimal-pad"
            containerStyle={styles.pairInput}
          />
        </View>

        <View style={styles.pair}>
          <Field
            label="Наценка"
            defaultValue={markup === null ? '' : String(markup / 100).replace('.', ',')}
            onEndEditing={(event) => applyMarkup(event.nativeEvent.text)}
            placeholder="0"
            keyboardType="decimal-pad"
            containerStyle={styles.pairInput}
            hint={
              purchase === 0
                ? 'Считается от цены закупки'
                : `Маржа ${margin === null ? '—' : formatPercent(margin)}`
            }
          />
          <Field
            label="Скидка"
            value={discount}
            onChangeText={setDiscount}
            placeholder="0"
            keyboardType="decimal-pad"
            containerStyle={styles.pairInput}
            hint={
              discountValue(discount) > 0
                ? `Цена со скидкой ${formatMoney(priceWithDiscount(sale, discountValue(discount)))}`
                : 'Проценты от цены продажи'
            }
          />
        </View>

        <Choice
          label="НДС"
          value={vatBp === null ? 'none' : String(vatBp)}
          options={VAT_RATES.map((rate) => ({
            value: rate.bp === null ? 'none' : String(rate.bp),
            label: rate.label,
          }))}
          onChange={(value) => setVatBp(value === 'none' ? null : Number(value))}
        />

        <Field
          label="Срок годности"
          value={expires}
          onChangeText={setExpires}
          placeholder="31.12.2026"
          hint="Пусто — за сроком не следим"
        />

        <Field
          label="Сообщать, когда останется меньше"
          value={minQty}
          onChangeText={setMinQty}
          placeholder="0"
          keyboardType="decimal-pad"
          hint="0 — не следить за остатком этого товара"
        />

        <Button title="Сохранить" onPress={save} />
      </Card>

      {/* У услуги остатка нет по определению — карточке остатка неоткуда взяться. */}
      {product && product.kind !== 'service' ? <StockCard productId={product.id} /> : null}
      {product && product.kind !== 'service' ? <HistoryCard productId={product.id} /> : null}

      {/* Архивированный товар можно вернуть — это единственная кнопка, что
          здесь осталась. «В архив» отсюда убрана: она стояла под каждым
          товаром без объяснения, и было непонятно, что она делает и зачем.
          Убирают товар из карточки в кабинете, где кнопка называется
          «Удалить» и спрашивает подтверждение. */}
      {product?.archived ? (
        <Button
          title="Вернуть из архива"
          variant="secondary"
          onPress={() => {
            restoreProduct(db, product.id);
            refresh();
          }}
        />
      ) : null}
    </ScrollView>
  );
}

/** Срок годности в поле ввода — в том же виде, в каком его печатают: 31.12.2026. */
/**
 * Карточка товара — вид, а не правка. Повторяет то, что Вазген прислал
 * снимком из CloudShop.
 *
 * Порядок блоков его: фотография во весь верх с названием поверх, вкладки
 * «Информация» и «История», потом сведения, «Цены и скидки», «Склад» с
 * остатком по каждому магазину и «Категории».
 *
 * Наценка и маржинальность у него приглушены — их не вводят, а считают. Мы
 * тоже считаем и тоже приглушаем: голубая цифра в его карточке значит «сюда
 * можно нажать», серая — «это вывод».
 *
 * Обе считаются от себестоимости, а не от цены закупки. Проверено на его же
 * снимке: цена 1 300, себестоимость 37,50 — наценка 3367 %, маржинальность
 * 97 %. От цены закупки в 300 рублей вышло бы 333 % и 77 %.
 */
function ProductView({
  product,
  onEdit,
}: {
  product: ProductWithStock;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'info' | 'history'>('info');

  const stock = useQuery(
    (database) => stockByLocation(database, product.id),
    [product.id],
  );
  const category = useQuery(
    (database) =>
      product.category_id
        ? listCategories(database).find((one) => one.id === product.category_id)?.name ?? null
        : null,
    [product.category_id],
  );

  const markup = markupBp(product.cost_price, product.sale_price);
  const margin = marginBp(product.cost_price, product.sale_price);
  const всего = stock.reduce((sum, one) => sum + one.qty, 0);

  // У услуги склада нет и быть не может: её не привозят и не списывают.
  // Форма правки это уже учитывает — карточка должна вести себя так же,
  // иначе под «Складом» висит «остатка нет ни в одном магазине», и это
  // читается как недостача, а не как «здесь нечему лежать».
  const складской = product.kind !== 'service';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.viewContent}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.hero}>
        {product.photo_uri ? (
          <Image source={{ uri: product.photo_uri }} style={styles.heroPhoto} />
        ) : (
          <View style={[styles.heroPhoto, styles.heroEmpty]} />
        )}

        <View style={styles.heroTop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Назад"
            onPress={() => router.back()}
            hitSlop={10}
          >
            <Text style={styles.heroIcon}>←</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Редактировать"
            onPress={onEdit}
            hitSlop={10}
          >
            <Text style={styles.heroIcon}>✎</Text>
          </Pressable>
        </View>

        {/* Тёмная подложка под названием: на светлой фотографии белые буквы
            иначе не читаются вовсе. */}
        <View style={styles.heroShade}>
          <Text style={styles.heroName} numberOfLines={3}>
            {product.name}
          </Text>
          <Text style={styles.heroKind}>{PRODUCT_KIND_LABEL[product.kind]}</Text>
        </View>
      </View>

      <View style={styles.viewTabs}>
        {(складской
          ? ([['info', 'Информация'], ['history', 'История']] as const)
          : ([['info', 'Информация']] as const)
        ).map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === value }}
            onPress={() => setTab(value)}
            style={[styles.viewTab, tab === value && styles.viewTabOn]}
          >
            <Text style={[styles.viewTabLabel, tab === value && styles.viewTabLabelOn]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'history' && складской ? (
        <View style={styles.band}>
          <HistoryCard productId={product.id} />
        </View>
      ) : (
        <>
          <Line label="Создан" value={created(product.created_at)} />
          <Line label="Код товара" value={product.code || '—'} />
          <Line
            label="Штрих-код"
            value={product.barcode || 'Сгенерировать'}
            link={!product.barcode}
            onPress={product.barcode ? undefined : onEdit}
          />
          <Line label="Артикул" value={product.sku || '—'} />

          <Divider>Цены и скидки</Divider>
          <Line label="Цена продажи" value={`${formatMoney(product.sale_price)}  руб`} link />
          <Line label="Цена закупки" value={`${formatMoney(product.purchase_price)}  руб`} link />
          <Line label="Себестоимость" value={`${formatMoney(product.cost_price)}  руб`} />
          <Line label="Скидка" value={`${product.discount_bp / 100}%`} link />
          <Line
            label="Наценка"
            value={markup === null ? '—' : `${Math.round(markup / 100)}%`}
            dim
          />
          <Line
            label="Маржинальность"
            value={margin === null ? '—' : `${Math.round(margin / 100)}%`}
            dim
          />

          {складской ? <Divider>Склад</Divider> : null}
          {(складской ? stock : []).map((one) => (
            <View key={one.location_id} style={styles.stockRow}>
              <View style={styles.stockBody}>
                <Text style={styles.stockName}>{one.name}</Text>
                <Text style={styles.stockNote}>
                  По себестоимости: {formatMoney(Math.round((one.qty * product.cost_price) / 1000))}  руб
                </Text>
                <Text style={styles.stockNote}>
                  По цене: {formatMoney(Math.round((one.qty * product.sale_price) / 1000))}  руб
                </Text>
              </View>
              <Text style={styles.stockQty}>{formatQty(one.qty)}</Text>
            </View>
          ))}
          {!складской ? null : stock.length ? (
            <View style={styles.stockRow}>
              <Text style={[styles.stockName, styles.stockTotal]}>Всего</Text>
              <Text style={[styles.stockQty, styles.stockTotal]}>{formatQty(всего)}</Text>
            </View>
          ) : (
            <Text style={styles.viewEmpty}>Остатка нет ни в одном магазине</Text>
          )}

          <Divider>Категории</Divider>
          <Text style={styles.category}>{category ?? 'Без категории'}</Text>
        </>
      )}
    </ScrollView>
  );
}

/** Строка «название — значение». Голубое значение можно нажать, серое — вывод. */
function Line({
  label,
  value,
  link,
  dim,
  onPress,
}: {
  label: string;
  value: string;
  link?: boolean;
  dim?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, dim && styles.lineDim]}>{label}</Text>
      <Text style={[styles.lineValue, link && styles.lineLink, dim && styles.lineDim]}>
        {value}
      </Text>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {body}
    </Pressable>
  );
}

/** Серая полоса с синим заголовком — так у него разделены части карточки. */
function Divider({ children }: { children: string }) {
  return (
    <>
      <View style={styles.band} />
      <Text style={styles.bandTitle}>{children}</Text>
    </>
  );
}

/** «31 янв. 2025, 10:36» — так подписана дата создания у него. */
function created(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}, ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatDateInput(value: string | null): string {
  return value ? formatDate(value) : '';
}

/** Скидка из поля ввода в сотые доли процента; мусор считается нулём. */
function discountValue(input: string): number {
  return (input.trim() ? parsePercent(input) : 0) ?? 0;
}

/** Текущий остаток и пересчёт по факту. */
function StockCard({ productId }: { productId: number }) {
  const { db, refresh } = useDatabase();
  const product = useQuery((database) => getProduct(database, productId), [productId]);
  const [actual, setActual] = useState('');

  if (!product) return null;

  function applyInventory() {
    const parsed = parseQty(actual);
    if (parsed === null || parsed < 0) {
      say('Проверьте количество', 'Фактический остаток должен быть числом не меньше нуля.');
      return;
    }

    const delta = adjustStock(db, productId, parsed, 'Инвентаризация из карточки товара');
    refresh();
    setActual('');

    say(
      'Остаток обновлён',
      delta === 0
        ? 'Расхождения не было.'
        : `Расхождение: ${delta > 0 ? '+' : ''}${formatQty(delta)} ${product!.unit}.`,
    );
  }

  return (
    <Card>
      <View style={styles.stockHeader}>
        <View>
          <Text style={text.muted}>Остаток</Text>
          <Text style={text.title}>{formatQtyWithUnit(product.stock, product.unit)}</Text>
        </View>
        <View style={styles.stockValue}>
          <Text style={text.muted}>В закупке</Text>
          <Text style={text.amount}>
            {formatMoneyWithSign(Math.round((product.stock * product.cost_price) / 1000))}
          </Text>
        </View>
      </View>

      <Text style={[text.muted, styles.hint]}>
        Пересчитали товар? Введите фактическое количество — разница запишется в историю.
      </Text>

      <View style={styles.barcodeRow}>
        <TextInput
          value={actual}
          onChangeText={setActual}
          placeholder={formatQty(product.stock)}
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          style={styles.barcodeInput}
        />
        <Button
          title="Пересчёт"
          variant="secondary"
          onPress={applyInventory}
          disabled={!actual.trim()}
          style={styles.scanButton}
        />
      </View>
    </Card>
  );
}

/** История движений — объясняет, откуда взялся текущий остаток. */
function HistoryCard({ productId }: { productId: number }) {
  const moves = useQuery((database) => listMoves(database, productId, 30), [productId]);

  return (
    <Card style={styles.historyCard}>
      <Text style={[text.heading, styles.historyTitle]}>История движений</Text>

      {moves.length === 0 ? (
        <Text style={[text.muted, styles.historyEmpty]}>Движений пока не было</Text>
      ) : (
        moves.map((move) => (
          <Row
            key={move.id}
            left={
              <>
                <Text style={text.body}>{REASON_LABEL[move.reason]}</Text>
                <Text style={text.muted}>
                  {new Date(move.created_at).toLocaleString('ru-RU', {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {move.counterparty ? ` · ${move.counterparty}` : ''}
                </Text>
              </>
            }
            right={
              <Badge
                label={`${move.qty_delta > 0 ? '+' : ''}${formatQty(move.qty_delta)} ${move.unit}`}
                tone={move.qty_delta > 0 ? 'success' : 'danger'}
              />
            }
          />
        ))
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  viewContent: { paddingBottom: spacing.xl },
  hero: { height: 300, backgroundColor: '#1B1D1F' },
  heroPhoto: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  heroEmpty: { backgroundColor: '#2A2D30' },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  heroIcon: { fontSize: 26, color: '#FFFFFF' },
  // Подложка под названием: на светлой фотографии белые буквы иначе пропадают.
  heroShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  heroName: { fontSize: 26, fontWeight: '700', color: '#FFFFFF', lineHeight: 32 },
  heroKind: { fontSize: 15, color: 'rgba(255,255,255,0.75)', marginTop: 2 },

  viewTabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  viewTab: { flex: 1, paddingVertical: spacing.md, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  viewTabOn: { borderBottomColor: colors.accent },
  viewTabLabel: { fontSize: 17, color: colors.textMuted },
  viewTabLabelOn: { color: colors.text, fontWeight: '700' },

  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  lineLabel: { fontSize: 17, color: colors.text, flexShrink: 1 },
  lineValue: { fontSize: 17, color: colors.text, fontVariant: ['tabular-nums'] },
  lineLink: { color: colors.accent },
  // Приглушены те строки, которых не вводят, а выводят: наценка и маржа.
  lineDim: { color: colors.textMuted },

  band: { height: spacing.lg, backgroundColor: colors.bg },
  bandTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
  },

  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  stockBody: { flex: 1, gap: 2 },
  stockName: { fontSize: 17, fontWeight: '600', color: colors.text },
  stockNote: { fontSize: 13, color: colors.textMuted },
  stockQty: { fontSize: 20, color: colors.text, fontVariant: ['tabular-nums'] },
  stockTotal: { fontWeight: '700' },
  category: {
    fontSize: 17,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  viewEmpty: {
    fontSize: 15,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },

  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  photoBox: {
    height: 140,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  photo: { width: '100%', height: '100%' },
  pair: { flexDirection: 'row', gap: spacing.md },
  pairInput: { flex: 1 },
  barcodeRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  barcodeInput: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  scanButton: { minWidth: 96 },
  hint: { marginTop: spacing.xs, marginBottom: spacing.md, fontSize: 12 },
  stockHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  stockValue: { alignItems: 'flex-end' },
  historyCard: { padding: 0, paddingTop: spacing.lg, overflow: 'hidden' },
  historyTitle: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  historyEmpty: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
});
