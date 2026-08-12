import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { listCounterparties } from '../../db/counterparties';
import { listLocations, stockByLocation } from '../../db/locations';
import {
  archiveProduct,
  createProduct,
  getProduct,
  listCategories,
  listPacks,
  listProducts,
  productCategories,
  restoreProduct,
  savePacks,
  saveCategories,
  saveSetItems,
  saveStorePrices,
  setItems,
  storePrices,
  updateProduct,
  type ProductInput,
} from '../../db/products';
import { postInventory } from '../../db/stock';
import { MARKING_TYPES, TAX_SYSTEMS, barcodeFromCode, gtinFromBarcode } from '../../domain/marking';
import { formatMoneyWeb, parseMoney } from '../../domain/money';
import {
  VAT_RATES,
  formatDate,
  markupBp,
  parseDate,
  parsePercent,
  priceFromMarkup,
} from '../../domain/pricing';
import { formatQty, parseQty } from '../../domain/qty';
import { PRODUCT_KIND_HINT, PRODUCT_KIND_LABEL, type Id, type ProductKind } from '../../domain/types';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { confirm, say } from '../../ui/alert';
import { WebIcon } from '../../ui/icons';
import { web, webText, WEB_FONT } from '../../ui/webTheme';
import { Drawer, DrawerButton } from '../Drawer';
import { Dropdown } from '../Dropdown';
import {
  Chips,
  Divider,
  Field,
  Fields,
  FormLink,
  FormPanel,
  Heading,
  Notice,
  TextBox,
  Toggle,
} from '../Form';
import { ProductView } from './ProductView';

/**
 * Карточка товара — форма кабинета.
 *
 * Собрана его четырьмя разделами и в его порядке: Основная информация,
 * Состав комлекта (только у комплекта), Цены, Склад. До этого здесь были
 * свои блоки — Основные, Фотография, Цены и скидки, Остаток — в две колонки
 * с рамками. Выглядело опрятно, но у оригинала форма идёт одним листом:
 * заголовок, поля, тонкая линия, следующий заголовок. Кто работал там,
 * ищет поле по месту, а не по названию блока.
 *
 * Подписи — из его словаря, вплоть до «Состав комлекта» с опечаткой:
 * человек, перешедший оттуда, ищет глазами знакомое слово, а не правильное.
 *
 * Чего в форме нет и почему: группы (папки каталога) и модификации —
 * отдельные механизмы, у него они открывают свои окна; акцизные реквизиты
 * Эвотора и поля Украины, Казахстана и Узбекистана — привязаны к их
 * интеграциям.
 */

/** Строка упаковки в форме: пока не сохранили, количество живёт текстом. */
interface PackDraft {
  name: string;
  qty: string;
}

export function ProductCard({ id, onClose }: { id: string; onClose: () => void }) {
  const { db, refresh } = useDatabase();

  const isNew = id === 'new';
  const productId = isNew ? null : Number(id);

  // Существующий товар сперва показывается, а не открывается на правку —
  // так же, как у него: `/catalog/list/m/get/:id` смотрит, `/m/update/:id`
  // редактирует. Чаще всего в карточку заходят посмотреть остаток и цену.
  const [editing, setEditing] = useState(isNew);

  const product = useQuery(
    (database) => (productId ? getProduct(database, productId) : null),
    [productId],
  );

  const categories = useQuery((database) => listCategories(database));
  const locations = useQuery((database) => listLocations(database));
  const stock = useQuery((database) => stockByLocation(database));
  const suppliers = useQuery((database) => listCounterparties(database, { kind: 'supplier' }));
  const savedCategories = useQuery(
    (database) => (productId ? productCategories(database, productId) : []),
    [productId],
  );
  const savedPacks = useQuery(
    (database) => (productId ? listPacks(database, productId) : []),
    [productId],
  );
  const savedSet = useQuery(
    (database) => (productId ? setItems(database, productId) : []),
    [productId],
  );
  const savedStorePrices = useQuery(
    (database) => (productId ? storePrices(database, productId) : new Map<Id, number>()),
    [productId],
  );

  // Основная информация
  const [kind, setKind] = useState<ProductKind>(product?.kind ?? 'product');
  const [name, setName] = useState(product?.name ?? '');
  const [code, setCode] = useState(product?.code ?? '');
  const [barcode, setBarcode] = useState(product?.barcode ?? '');
  const [sku, setSku] = useState(product?.sku ?? '');
  const [gtin, setGtin] = useState(product?.gtin ?? '');
  const [markingType, setMarkingType] = useState(product?.marking_type ?? '');
  const [taxSystem, setTaxSystem] = useState(product?.tax_system ?? '');
  const [excisable, setExcisable] = useState(Boolean(product?.excisable));
  const [chosenCategories, setChosenCategories] = useState<string[]>(savedCategories);
  const [unit, setUnit] = useState(product?.unit ?? 'шт');
  const [weighted, setWeighted] = useState(Boolean(product?.weighted));
  const [plu, setPlu] = useState(product?.plu_code ?? '');
  const [packs, setPacks] = useState<PackDraft[]>(
    savedPacks.map((pack) => ({ name: pack.name, qty: formatQty(pack.qty) })),
  );
  const [height, setHeight] = useState(cmOf(product?.height_mm));
  const [width, setWidth] = useState(cmOf(product?.width_mm));
  const [depth, setDepth] = useState(cmOf(product?.depth_mm));
  const [weight, setWeight] = useState(kgOf(product?.weight_g));
  const [description, setDescription] = useState(product?.description ?? '');
  const [country, setCountry] = useState(product?.country ?? '');

  // Цены
  const [purchase, setPurchase] = useState(
    product?.purchase_price ? formatMoneyWeb(product.purchase_price) : '',
  );
  const [price, setPrice] = useState(product ? formatMoneyWeb(product.sale_price) : '');
  const [freePrice, setFreePrice] = useState(Boolean(product?.free_price));
  const [byStore, setByStore] = useState(savedStorePrices.size > 0);
  const [shopPrices, setShopPrices] = useState<Map<Id, string>>(
    () => new Map([...savedStorePrices].map(([shop, value]) => [shop, formatMoneyWeb(value)])),
  );
  const [discount, setDiscount] = useState(
    product?.discount_bp ? String(product.discount_bp / 100) : '',
  );
  const [vatBp, setVatBp] = useState<number | null>(product?.vat_bp ?? null);

  // Склад
  const [supplierId, setSupplierId] = useState<Id | null>(product?.supplier_id ?? null);
  const [minQty, setMinQty] = useState(product?.min_qty ? formatQty(product.min_qty) : '');
  const [enterStock, setEnterStock] = useState(false);
  const [shopStock, setShopStock] = useState<Map<Id, string>>(() => new Map());
  const [expires, setExpires] = useState(product?.expires_at ? formatDate(product.expires_at) : '');

  // Состав комплекта
  const [set, setSet] = useState(savedSet.map((item) => ({ ...item, qtyText: formatQty(item.qty) })));

  const purchaseValue = purchase.trim() ? (parseMoney(purchase) ?? 0) : 0;
  const priceValue = price.trim() ? (parseMoney(price) ?? 0) : 0;
  const markup = markupBp(purchaseValue, priceValue);

  const byShop = productId ? stock.get(productId) : undefined;

  /** Остаток магазина в поле: что ввели, иначе то, что есть на складе. */
  const stockText = (shop: Id): string =>
    shopStock.get(shop) ?? (productId ? formatQty(byShop?.get(shop) ?? 0) : '');

  function save() {
    if (!name.trim()) {
      say('Нужно наименование', 'Без наименования товар не сохранить.');
      return;
    }

    const min = minQty.trim() ? parseQty(minQty) : 0;
    if (min === null) {
      say('Проверьте числа', 'Минимальный остаток должен быть числом.');
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
      // Категория в карточке — первая из списка; остальные лягут в свою
      // таблицу ниже, когда у товара появится номер.
      category_id: product?.category_id ?? null,
      unit: unit.trim() || 'шт',
      // Себестоимость не вводится: она считается по среднему при каждой
      // закупке. У нового товара она равна цене закупки — до первой закупки
      // считать не по чему.
      cost_price: product?.cost_price ?? purchaseValue,
      purchase_price: purchaseValue,
      sale_price: priceValue,
      min_qty: min,
      vat_bp: vatBp,
      expires_at: expiresAt,
      discount_bp: discount.trim() ? (parsePercent(discount) ?? 0) : 0,
      country: country.trim() || null,
      supplier_id: supplierId,
      description: description.trim() || null,
      plu_code: weighted ? plu.trim() || null : null,
      gtin: gtin.trim() || null,
      weighted: weighted ? 1 : 0,
      height_mm: mmOf(height),
      width_mm: mmOf(width),
      depth_mm: mmOf(depth),
      weight_g: gramsOf(weight),
      free_price: freePrice ? 1 : 0,
      store_price: byStore ? 1 : 0,
      marking_type: markingType || null,
      tax_system: taxSystem || null,
      excisable: excisable ? 1 : 0,
      photo_uri: product?.photo_uri ?? null,
    };

    try {
      const savedId = productId ?? createProduct(db, input);
      if (productId) updateProduct(db, productId, input);

      saveCategories(db, savedId, chosenCategories);
      savePacks(
        db,
        savedId,
        packs.map((pack) => ({ name: pack.name, qty: parseQty(pack.qty) ?? 0 })),
      );

      if (kind === 'set') {
        saveSetItems(
          db,
          savedId,
          set.map((item) => ({ product_id: item.product_id, qty: parseQty(item.qtyText) ?? 0 })),
        );
      }

      saveStorePrices(
        db,
        savedId,
        new Map(
          locations.map((shop) => {
            const text = byStore ? shopPrices.get(shop.id)?.trim() : '';
            return [shop.id, text ? parseMoney(text) : null];
          }),
        ),
      );

      applyStock(savedId, input.unit);

      refresh();
      onClose();
    } catch (error) {
      const message = String(error);
      say(
        'Не удалось сохранить',
        message.includes('UNIQUE') ? 'Такой штрих-код уже есть у другого товара.' : message,
      );
    }
  }

  /**
   * Введённые остатки — документами, по одному на магазин.
   *
   * Их же пояснение: правка количества создаёт документы корректировки, и
   * себестоимость они не трогают. Поэтому здесь не UPDATE поля, а проведённый
   * документ: иначе на вопрос «откуда взялись эти 12 штук» ответить нечем.
   */
  function applyStock(savedId: Id, savedUnit: string): void {
    for (const shop of locations) {
      const text = shopStock.get(shop.id);
      if (text === undefined || !text.trim()) continue;

      const actual = parseQty(text);
      if (actual === null || actual < 0) continue;

      const current = byShop?.get(shop.id) ?? 0;
      if (actual === current) continue;

      postInventory(db, {
        locationId: shop.id,
        note: productId ? 'Правка остатка в карточке товара' : 'Начальный остаток',
        lines: [{ product_id: savedId, name: name.trim(), unit: savedUnit, actual, price: 0 }],
      });
    }
  }

  // Существующий товар сперва показывается, а не открывается на правку.
  // Панель при этом остаётся та же: у него переход «посмотрел → правлю» не
  // закрывает панель и не перезагружает страницу, меняется только тело.
  /**
   * Клонирование — его кнопка со значком копии.
   *
   * Копия заводится без штрихкода, кода и артикула: все три уникальны, и
   * второй товар с тем же кодом касса опознала бы неверно. Название получает
   * пометку, чтобы копия не потерялась среди одинаковых строк.
   */
  function clone() {
    if (!product) return;

    const copy = createProduct(db, {
      ...product,
      name: `${product.name} (копия)`,
      barcode: null,
      code: null,
      sku: null,
    });

    saveCategories(db, copy, savedCategories);
    savePacks(db, copy, savedPacks);
    if (product.kind === 'set') {
      saveSetItems(
        db,
        copy,
        savedSet.map((item) => ({ product_id: item.product_id, qty: item.qty })),
      );
    }

    refresh();
    say('Товар скопирован', 'Копия заведена без штрихкода — его нужно задать заново.');
    onClose();
  }

  /**
   * «Удалить» — на деле архив.
   *
   * Товар нельзя убрать насовсем: на него ссылаются позиции проданных чеков,
   * и удаление сломало бы историю продаж и отчёты за прошлые периоды. Поэтому
   * он исчезает из списков и кассы, но остаётся в истории.
   */
  function remove() {
    if (!product) return;

    confirm(
      'Удалить товар?',
      'Товар исчезнет из справочника и кассы, но останется в проданных чеках — иначе отчёты за прошлые месяцы перестали бы сходиться.',
      'Удалить',
      () => {
        archiveProduct(db, product.id);
        refresh();
        onClose();
      },
    );
  }

  if (productId && !editing) {
    return (
      <Drawer
        visible
        onClose={onClose}
        // Кнопки — его: «Редактировать» зелёная, рядом копия, «Удалить»
        // красная и прижата вправо.
        actions={
          <>
            <DrawerButton label="Редактировать" tone="green" onPress={() => setEditing(true)} />
            {product?.archived ? (
              <DrawerButton
                label="Вернуть из архива"
                tone="orangeOutline"
                onPress={() => {
                  restoreProduct(db, product.id);
                  refresh();
                }}
              />
            ) : (
              <DrawerButton label="Клонировать товар" onPress={clone} />
            )}
            <DrawerButton label="Удалить" tone="dangerOutline" right onPress={remove} />
          </>
        }
      >
        <ProductView id={productId} />
      </Drawer>
    );
  }

  return (
    <Drawer
      visible
      onClose={onClose}
      // Правку открывают из просмотра — слева стрелка «назад», а не крестик.
      nested={!isNew}
      actions={
        <>
          <DrawerButton label="Сохранить" tone="green" onPress={save} />
          <DrawerButton label="Отмена" onPress={onClose} />
        </>
      }
    >
      <View style={styles.screen}>
        <Text style={webText.pageTitle}>{isNew ? 'Создание товара' : name || 'Товар'}</Text>

        <FormPanel>
          {/* Вид выбирается только при создании: у заведённого товара смена
              вида означала бы, что у услуги вдруг появился остаток. */}
          {isNew ? <TypeCards value={kind} onChange={setKind} /> : null}

          <Heading>Основная информация</Heading>

          <Field label="Наименование">
            <TextBox value={name} onChange={setName} placeholder="Шу пуэр 2019" label="Наименование" />
          </Field>

          <Fields>
            <Field label={kind === 'service' ? 'Код услуги' : 'Код товара'} third>
              <TextBox
                value={code}
                onChange={setCode}
                placeholder="Введите код товара"
                label="Код товара"
              />
            </Field>
            <Field
              label="Штрих-код"
              third
              action={barcode ? undefined : 'Сгенерировать'}
              onAction={() => {
                const made = barcodeFromCode(code || String(productId ?? ''));
                if (made) setBarcode(made);
                else say('Нечего генерировать', 'Сперва заполните код товара.');
              }}
            >
              <TextBox
                value={barcode}
                onChange={setBarcode}
                placeholder="Введите штрих-код"
                label="Штрих-код"
              />
            </Field>
            <Field label="Артикул" third>
              <TextBox value={sku} onChange={setSku} placeholder="Введите артикул" label="Артикул" />
            </Field>
          </Fields>

          {kind === 'product' ? (
            <Fields>
              <Field
                label="GTIN"
                third
                action={barcode && !gtin ? 'Получить из штрих-кода' : undefined}
                onAction={() => {
                  const made = gtinFromBarcode(barcode);
                  if (made) setGtin(made);
                  else say('Не получилось', 'GTIN получается из штрихкода EAN-8, EAN-13 или UPC.');
                }}
              >
                <TextBox value={gtin} onChange={setGtin} placeholder="Введите GTIN" label="GTIN" />
              </Field>
              <View style={styles.spacer} />
              <View style={styles.spacer} />
            </Fields>
          ) : null}

          {kind === 'product' ? (
            <Fields>
              <Field label="Тип маркировки" half>
                <Dropdown
                  variant="field"
                  label="Тип маркировки"
                  placeholder="Без маркировки"
                  value={markingType}
                  onChange={setMarkingType}
                  options={[
                    { value: '', label: 'Без маркировки' },
                    ...MARKING_TYPES.map((item) => ({ value: item.code, label: item.name })),
                  ]}
                />
              </Field>
              <Field label="Система налогообложения" half>
                <Dropdown
                  variant="field"
                  label="Система налогообложения"
                  placeholder="Как у магазина"
                  value={taxSystem}
                  onChange={setTaxSystem}
                  options={[
                    { value: '', label: 'Как у магазина' },
                    ...TAX_SYSTEMS.map((item) => ({ value: item.code, label: item.name })),
                  ]}
                />
              </Field>
            </Fields>
          ) : null}

          {kind === 'product' ? (
            <Field>
              <Toggle on={excisable} onChange={setExcisable} label="Подакцизный товар" />
            </Field>
          ) : null}

          <Field label="Изображение">
            <View style={styles.photo}>
              {product?.photo_uri ? (
                <Image source={{ uri: product.photo_uri }} style={styles.photoImage} />
              ) : (
                <Text style={styles.photoHint}>Фотография добавляется с телефона</Text>
              )}
            </View>
          </Field>

          <Field label="Категории">
            <Chips
              values={chosenCategories}
              options={categories.map((item) => item.name)}
              onChange={setChosenCategories}
              placeholder="Выберите из списка или введите новую и нажмите Enter"
            />
          </Field>

          <Fields>
            <Field label="Единица измерения" third>
              <TextBox value={unit} onChange={setUnit} placeholder="шт" label="Единица измерения" />
            </Field>
            <Field third>
              <View style={styles.toggleUnder}>
                <Toggle
                  on={weighted}
                  onChange={setWeighted}
                  label={kind === 'service' ? 'Дробная услуга' : 'Весовой товар'}
                />
              </View>
            </Field>
            {weighted && kind === 'product' ? (
              <Field label="PLU код" third>
                <TextBox value={plu} onChange={setPlu} maxLength={5} label="PLU код" />
              </Field>
            ) : (
              <View style={styles.spacer} />
            )}
          </Fields>

          {packs.map((pack, index) => (
            <Fields key={index}>
              <Field label="Упаковка" third>
                <TextBox
                  value={pack.name}
                  onChange={(value) => setPacks(replace(packs, index, { ...pack, name: value }))}
                  placeholder="Коробка"
                  label="Упаковка"
                />
              </Field>
              <Field label="Количество в упаковке" third>
                <TextBox
                  value={pack.qty}
                  onChange={(value) => setPacks(replace(packs, index, { ...pack, qty: value }))}
                  numeric
                  unit={unit}
                  label="Количество в упаковке"
                />
              </Field>
              <Field third>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Убрать упаковку"
                  style={styles.removePack}
                  onPress={() => setPacks(packs.filter((_, at) => at !== index))}
                >
                  <WebIcon.close size={16} color={web.textMuted} />
                </Pressable>
              </Field>
            </Fields>
          ))}

          <Field>
            <FormLink
              label="Добавить упаковку"
              onPress={() => setPacks([...packs, { name: '', qty: '' }])}
            />
          </Field>

          <Field label="Характеристики товара">
            <Fields>
              <Field label="Высота, см" third>
                <TextBox value={height} onChange={setHeight} numeric label="Высота" />
              </Field>
              <Field label="Ширина, см" third>
                <TextBox value={width} onChange={setWidth} numeric label="Ширина" />
              </Field>
              <Field label="Глубина, см" third>
                <TextBox value={depth} onChange={setDepth} numeric label="Глубина" />
              </Field>
            </Fields>
            <Fields>
              <Field label="Фактический вес, кг" third>
                <TextBox value={weight} onChange={setWeight} numeric label="Фактический вес" />
              </Field>
              <View style={styles.spacer} />
              <View style={styles.spacer} />
            </Fields>
            {volumeOf(height, width, depth) ? (
              <Text style={styles.volume}>Объем: {volumeOf(height, width, depth)} см³</Text>
            ) : null}
          </Field>

          <Field label="Описание">
            <TextBox
              value={description}
              onChange={setDescription}
              multiline
              label="Описание"
            />
          </Field>

          {kind === 'product' ? (
            <Fields>
              <Field label="Страна" half>
                <TextBox
                  value={country}
                  onChange={setCountry}
                  placeholder="Введите название страны"
                  label="Страна"
                />
              </Field>
              <View style={styles.spacer} />
            </Fields>
          ) : null}

          {kind === 'set' ? (
            <>
              <Divider />
              <Heading>Состав комлекта</Heading>
              <SetComposition
                items={set}
                unitOf={(item) => item.unit}
                onAdd={(item) =>
                  setSet((current) =>
                    current.some((line) => line.product_id === item.id)
                      ? current
                      : [
                          ...current,
                          {
                            product_id: item.id,
                            name: item.name,
                            unit: item.unit,
                            qty: 1000,
                            price: item.sale_price,
                            sum: item.sale_price,
                            qtyText: '1',
                          },
                        ],
                  )
                }
                onQty={(productId2, value) =>
                  setSet((current) =>
                    current.map((line) =>
                      line.product_id === productId2 ? { ...line, qtyText: value } : line,
                    ),
                  )
                }
                onRemove={(productId2) =>
                  setSet((current) => current.filter((line) => line.product_id !== productId2))
                }
              />
            </>
          ) : null}

          <Divider />
          <Heading>Цены</Heading>

          <Fields>
            {kind === 'product' ? (
              <Field label="Цена закупки" third>
                <TextBox
                  value={purchase}
                  onChange={setPurchase}
                  numeric
                  unit="₽"
                  label="Цена закупки"
                />
              </Field>
            ) : null}
            {kind === 'product' ? (
              <Field label="Наценка" third>
                <TextBox
                  value={markup === null ? '' : String(round2(markup / 100))}
                  onChange={(value) => {
                    const bp = parsePercent(value);
                    if (bp !== null && purchaseValue > 0) {
                      setPrice(formatMoneyWeb(priceFromMarkup(purchaseValue, bp)));
                    }
                  }}
                  numeric
                  unit="%"
                  label="Наценка"
                />
              </Field>
            ) : null}
            <Field label="Цена продажи" third>
              <TextBox value={price} onChange={setPrice} numeric unit="₽" label="Цена продажи" />
            </Field>
            {kind === 'set' ? (
              <Field third>
                <Pressable
                  accessibilityRole="button"
                  style={styles.recount}
                  onPress={() =>
                    setPrice(
                      formatMoneyWeb(
                        set.reduce(
                          (sum, item) =>
                            sum + Math.round((item.price * (parseQty(item.qtyText) ?? 0)) / 1000),
                          0,
                        ),
                      ),
                    )
                  }
                >
                  <Text style={styles.recountText}>Пересчитать стоимость</Text>
                </Pressable>
              </Field>
            ) : null}
          </Fields>

          <Field>
            <Toggle
              on={freePrice}
              onChange={setFreePrice}
              label={`${PRODUCT_KIND_LABEL[kind]} по свободной цене`}
              hint="Кассир при продаже может редактировать цену"
            />
          </Field>

          {locations.length > 1 ? (
            <Field>
              <Toggle
                on={byStore}
                onChange={setByStore}
                label="Установить разные цены продажи в магазинах"
                hint="На кассах товар будет продаваться по цене магазина"
              />
            </Field>
          ) : null}

          {byStore ? (
            <Field>
              <View style={styles.tableHead}>
                <Text style={[styles.th, styles.thWide]}>Магазин</Text>
                {kind === 'product' ? <Text style={styles.th}>Наценка</Text> : null}
                <Text style={styles.th}>Цена продажи</Text>
              </View>
              {locations.map((shop) => {
                const text = shopPrices.get(shop.id) ?? '';
                const shopPrice = text.trim() ? (parseMoney(text) ?? 0) : priceValue;
                const shopMarkup = markupBp(purchaseValue, shopPrice);
                return (
                  <View key={shop.id} style={styles.tableRow}>
                    <Text style={[styles.td, styles.thWide]}>{shop.name}</Text>
                    {kind === 'product' ? (
                      <View style={styles.cellInput}>
                        <TextBox
                          value={shopMarkup === null ? '' : String(round2(shopMarkup / 100))}
                          onChange={(value) => {
                            const bp = parsePercent(value);
                            if (bp === null || purchaseValue <= 0) return;
                            setShopPrices(
                              withKey(
                                shopPrices,
                                shop.id,
                                formatMoneyWeb(priceFromMarkup(purchaseValue, bp)),
                              ),
                            );
                          }}
                          numeric
                          unit="%"
                          label={`Наценка ${shop.name}`}
                        />
                      </View>
                    ) : null}
                    <View style={styles.cellInput}>
                      <TextBox
                        value={text}
                        onChange={(value) => setShopPrices(withKey(shopPrices, shop.id, value))}
                        placeholder={price}
                        numeric
                        unit="₽"
                        label={`Цена продажи ${shop.name}`}
                      />
                    </View>
                  </View>
                );
              })}
            </Field>
          ) : null}

          <Fields>
            <Field label="Скидка" half>
              <TextBox value={discount} onChange={setDiscount} numeric unit="%" label="Скидка" />
            </Field>
            <View style={styles.spacer} />
          </Fields>

          <Fields>
            <Field label="Налоги" half>
              <Dropdown
                variant="field"
                label="Налоги"
                value={vatBp === null ? '' : String(vatBp)}
                onChange={(value) => setVatBp(value === '' ? null : Number(value))}
                options={VAT_RATES.map((rate) => ({
                  value: rate.bp === null ? '' : String(rate.bp),
                  label: rate.label,
                }))}
              />
            </Field>
            <View style={styles.spacer} />
          </Fields>

          <Divider />
          <Heading>Склад</Heading>

          {kind === 'product' ? (
            <Fields>
              <Field label="Выберите поставщика" half>
                <Dropdown
                  variant="field"
                  label="Поставщик"
                  placeholder="Не выбран"
                  value={supplierId === null ? '' : String(supplierId)}
                  onChange={(value) => setSupplierId(value === '' ? null : Number(value))}
                  options={[
                    { value: '', label: 'Не выбран' },
                    ...suppliers.map((party) => ({
                      value: String(party.id),
                      label: party.name,
                    })),
                  ]}
                />
              </Field>
              <Field label="Минимальный остаток" half>
                <TextBox
                  value={minQty}
                  onChange={setMinQty}
                  numeric
                  unit={unit}
                  label="Минимальный остаток"
                />
              </Field>
            </Fields>
          ) : null}

          {kind === 'product' && isNew ? (
            <Field>
              <Toggle
                on={enterStock}
                onChange={setEnterStock}
                label="Ввести начальные остатки"
                hint="Будут созданы документы оприходования"
              />
            </Field>
          ) : null}

          {kind === 'product' && !isNew ? <Heading>Текущие остатки</Heading> : null}

          {kind === 'product' && (enterStock || !isNew) ? (
            <Field>
              {locations.length === 0 ? (
                <Notice>Магазинов пока нет — остаток положить некуда.</Notice>
              ) : (
                <>
                  <View style={styles.tableHead}>
                    <Text style={[styles.th, styles.thWide]}>Магазин</Text>
                    <Text style={styles.th}>{isNew ? 'Начальный остаток' : 'Текущий остаток'}</Text>
                  </View>
                  {locations.map((shop) => (
                    <View key={shop.id} style={styles.tableRow}>
                      <Text style={[styles.td, styles.thWide]}>{shop.name}</Text>
                      <View style={styles.cellInput}>
                        <TextBox
                          value={stockText(shop.id)}
                          onChange={(value) => setShopStock(withKey(shopStock, shop.id, value))}
                          numeric
                          unit={unit}
                          label={`Остаток ${shop.name}`}
                        />
                      </View>
                    </View>
                  ))}

                  <View style={styles.noticeWrap}>
                    {isNew ? (
                      <Notice title="Маленький совет: Добавляйте товар с ценой закупки, чтобы правильно считалась себестоимость">
                        Себестоимость считается по среднему и корректируется при каждой закупке
                        товара или оприходовании. Чтобы она была верной, нужно указывать цену
                        закупки. Себестоимость нужна, чтобы правильно подсчиталась прибыль с продаж
                        и отобразились основные показатели.
                      </Notice>
                    ) : (
                      <Notice>
                        При изменении количества товара будут созданы документы корректировки,
                        которые не влияют на себестоимость товара.
                      </Notice>
                    )}
                  </View>
                </>
              )}
            </Field>
          ) : null}

          {kind === 'product' ? (
            <Fields>
              <Field label="Срок годности" half>
                <TextBox
                  value={expires}
                  onChange={setExpires}
                  placeholder="31.12.2026"
                  label="Срок годности"
                />
              </Field>
              <View style={styles.spacer} />
            </Fields>
          ) : null}
        </FormPanel>
      </View>
    </Drawer>
  );
}

/**
 * Выбор вида — тремя карточками с заголовком и пояснением.
 *
 * Пояснение здесь не украшение: разница между товаром и услугой в том, есть
 * ли у неё остаток, и по одному названию это не видно.
 */
function TypeCards({
  value,
  onChange,
}: {
  value: ProductKind;
  onChange: (value: ProductKind) => void;
}) {
  return (
    <View style={styles.types}>
      {(Object.keys(PRODUCT_KIND_LABEL) as ProductKind[]).map((item) => (
        <Pressable
          key={item}
          accessibilityRole="button"
          accessibilityState={{ selected: value === item }}
          onPress={() => onChange(item)}
          style={[styles.type, value === item && styles.typeOn]}
        >
          <Text style={styles.typeTitle}>{PRODUCT_KIND_LABEL[item]}</Text>
          <View style={styles.typeLine} />
          <Text style={styles.typeHint}>{PRODUCT_KIND_HINT[item]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

interface SetLine {
  product_id: Id;
  name: string;
  unit: string;
  qty: number;
  price: number;
  sum: number;
  qtyText: string;
}

/**
 * Состав комплекта: слева поиск по каталогу, справа выбранное.
 *
 * Стоимость строки считается по текущей цене входящего товара, а не
 * записывается при добавлении: цены меняются, и запомненная сумма назавтра
 * соврала бы.
 */
function SetComposition({
  items,
  onAdd,
  onQty,
  onRemove,
}: {
  items: SetLine[];
  unitOf: (item: SetLine) => string;
  onAdd: (item: { id: Id; name: string; unit: string; sale_price: number }) => void;
  onQty: (productId: Id, value: string) => void;
  onRemove: (productId: Id) => void;
}) {
  const [search, setSearch] = useState('');
  const found = useQuery((db) => listProducts(db, { search }), [search]);

  // Комплект не может входить сам в себя, и вкладывать комплект в комплект
  // тоже нельзя: остаток пришлось бы разворачивать рекурсивно.
  const offer = useMemo(() => found.filter((item) => item.kind !== 'set').slice(0, 60), [found]);

  const total = items.reduce(
    (sum, item) => sum + Math.round((item.price * (parseQty(item.qtyText) ?? 0)) / 1000),
    0,
  );

  return (
    <View style={styles.set}>
      <View style={styles.setSearch}>
        <TextBox value={search} onChange={setSearch} placeholder="поиск…" label="Поиск товара" />
        <ScrollView style={styles.setList}>
          {offer.length === 0 ? (
            <Text style={styles.setEmpty}>Не найдено</Text>
          ) : (
            offer.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => onAdd(item)}
                style={styles.setOption}
              >
                <Text style={styles.setOptionText} numberOfLines={1}>
                  {item.name}
                </Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>

      <View style={styles.setChosen}>
        <View style={styles.tableHead}>
          <Text style={[styles.th, styles.thWide]}>Наименование</Text>
          <Text style={styles.th}>Кол-во</Text>
          <Text style={[styles.th, styles.right]}>Стоимость</Text>
          <View style={styles.removeCell} />
        </View>

        {items.length === 0 ? (
          <Text style={styles.setEmptyBig}>← Выберите товары</Text>
        ) : (
          items.map((item) => (
            <View key={item.product_id} style={styles.tableRow}>
              <View style={styles.thWide}>
                <Text style={styles.td}>{item.name}</Text>
                <Text style={styles.setPrice}>Цена продажи: {formatMoneyWeb(item.price)}</Text>
              </View>
              <View style={styles.cellInput}>
                <TextBox
                  value={item.qtyText}
                  onChange={(value) => onQty(item.product_id, value)}
                  numeric
                  label={`Количество ${item.name}`}
                />
              </View>
              <Text style={[styles.td, styles.right, styles.cellInput]}>
                {formatMoneyWeb(Math.round((item.price * (parseQty(item.qtyText) ?? 0)) / 1000))}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Убрать ${item.name}`}
                onPress={() => onRemove(item.product_id)}
                style={styles.removeCell}
              >
                <WebIcon.close size={16} color={web.textMuted} />
              </Pressable>
            </View>
          ))
        )}

        {items.length > 0 ? (
          <View style={styles.tableRow}>
            <Text style={[styles.td, styles.thWide, styles.bold]}>Итого</Text>
            <View style={styles.cellInput} />
            <Text style={[styles.td, styles.right, styles.cellInput, styles.bold]}>
              {formatMoneyWeb(total)}
            </Text>
            <View style={styles.removeCell} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Заменяет один элемент списка — короче, чем `map` с индексом на каждом поле. */
function replace<T>(list: T[], index: number, item: T): T[] {
  return list.map((current, at) => (at === index ? item : current));
}

/** Новый `Map` с изменённым ключом: состояние в React меняется целиком. */
function withKey<K, V>(map: Map<K, V>, key: K, value: V): Map<K, V> {
  const next = new Map(map);
  next.set(key, value);
  return next;
}

/** Габариты хранятся в миллиметрах, а вводятся в сантиметрах — как у него. */
function cmOf(mm: number | null | undefined): string {
  return mm === null || mm === undefined ? '' : String(round2(mm / 10));
}

function mmOf(cm: string): number | null {
  const value = Number(cm.replace(',', '.'));
  return cm.trim() && Number.isFinite(value) ? Math.round(value * 10) : null;
}

function kgOf(grams: number | null | undefined): string {
  return grams === null || grams === undefined ? '' : String(round2(grams / 1000));
}

function gramsOf(kg: string): number | null {
  const value = Number(kg.replace(',', '.'));
  return kg.trim() && Number.isFinite(value) ? Math.round(value * 1000) : null;
}

/** Объём в кубических сантиметрах — он же считает его сам, по трём габаритам. */
function volumeOf(height: string, width: string, depth: string): string | null {
  const [h, w, d] = [height, width, depth].map((value) => Number(value.replace(',', '.')));
  if (![h, w, d].every((value) => Number.isFinite(value) && value > 0)) return null;
  return String(round2(h * w * d));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const styles = StyleSheet.create({
  // Внутри панели заголовок стоит над листом формы, а не на сером поле:
  // `.cs_container > .content .panel` у него теряет тень и поля страницы.
  screen: { backgroundColor: '#FFFFFF', paddingTop: 22 },
  spacer: { flex: 1 },

  types: { flexDirection: 'row', gap: 14, marginBottom: 14 },
  type: {
    flex: 1,
    borderWidth: 2,
    borderColor: 'rgba(34,36,38,0.15)',
    borderRadius: 5,
    padding: 10,
    alignItems: 'center',
    gap: 8,
  },
  typeOn: { borderColor: web.link },
  typeTitle: { fontFamily: WEB_FONT, fontSize: 18, fontWeight: '500', color: web.text },
  typeLine: { height: 1, alignSelf: 'stretch', backgroundColor: 'rgba(34,36,38,0.15)' },
  typeHint: {
    fontFamily: WEB_FONT,
    fontSize: 12,
    color: 'rgba(0,0,0,0.6)',
    textAlign: 'center',
    lineHeight: 17,
  },

  photo: {
    height: 150,
    borderWidth: 1,
    borderColor: 'rgba(34,36,38,0.15)',
    borderStyle: 'dashed',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoImage: { width: '100%', height: '100%' },
  photoHint: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },

  // 30 сверху — как `style="padding-top: 30px"` в его разметке: столько
  // занимает подпись соседнего поля, и переключатель встаёт вровень с вводом,
  // а не над ним.
  toggleUnder: { paddingTop: 30 },
  removePack: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderColor: 'rgba(34,36,38,0.15)',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volume: { fontFamily: WEB_FONT, fontSize: 13, color: 'rgba(0,0,0,0.6)' },

  recount: {
    height: 38,
    borderWidth: 1,
    borderColor: 'rgba(34,36,38,0.15)',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recountText: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },

  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: web.gridLine,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: web.gridLine,
  },
  th: { flex: 1, fontFamily: WEB_FONT, fontSize: 13, fontWeight: '700', color: 'rgba(0,0,0,0.87)' },
  thWide: { flex: 2 },
  td: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  cellInput: { flex: 1 },
  right: { textAlign: 'right' },
  bold: { fontWeight: '700' },
  removeCell: { width: 28, alignItems: 'center' },
  noticeWrap: { marginTop: 14 },

  set: { flexDirection: 'row', gap: 22 },
  setSearch: { flex: 1, gap: 8 },
  setList: {
    maxHeight: 399,
    borderWidth: 1,
    borderColor: 'rgba(34,36,38,0.15)',
    borderRadius: 4,
  },
  setOption: { paddingHorizontal: 12, paddingVertical: 9 },
  setOptionText: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  setEmpty: { padding: 12, fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted },
  setEmptyBig: {
    padding: 40,
    fontFamily: WEB_FONT,
    fontSize: 20,
    color: web.textMuted,
    textAlign: 'center',
  },
  setChosen: { flex: 2 },
  setPrice: { fontFamily: WEB_FONT, fontSize: 11, color: web.textMuted },
});
