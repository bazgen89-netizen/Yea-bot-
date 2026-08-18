import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { Text, TextInput } from '../Translated';

import { Scrollable } from '../Scrollable';
import { useCashierKeys } from './useCashierKeys';
import { CashierMenu } from './CashierMenu';
import { CashierCloseShift } from './CashierCloseShift';
import { CashierCustomer } from './CashierCustomer';
import { CashierDebts } from './CashierDebts';
import { CashierDiscount } from './CashierDiscount';
import { CashierOpenShift } from './CashierOpenShift';
import { CashierNewClient } from './CashierNewClient';
import { CashierPayment } from './CashierPayment';
import { CashierQueue } from './CashierQueue';
import { CashierSellMenu } from './CashierSellMenu';
import { CashierReceipts } from './CashierReceipts';
import { CashierSuccess } from './CashierSuccess';
import { CashierReco } from './CashierReco';
import { CashierSheet } from './CashierSheet';
import { CashierPanel, VIEW_TITLE, type CashierView } from './CashierViews';
import { formatPhone } from '../../db/counterparties';
import { listLocations } from '../../db/locations';
import { listCategoryTiles, listProducts } from '../../db/products';
import { createReturn, createSale, OutOfStockError } from '../../db/sales';
import { recommendedFor } from '../../db/recommendations';
import { getSettings } from '../../db/settings';
import { openShiftAnywhere } from '../../db/shifts';
import { discountFromPercent, lineDiscountOf, percentFromDiscount } from '../../domain/cart';
import { formatMoney } from '../../domain/money';
import { clampSplit, columnsFor, DEFAULT_SPLIT } from '../../domain/split';
import { formatQty } from '../../domain/qty';
import type {
  CounterpartyWithTotals,
  Id,
  PaymentMethod,
  ProductWithStock,
} from '../../domain/types';
import { useCart } from '../../state/CartProvider';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { usePosSettings } from '../../state/PosSettingsProvider';
import { colorFromName } from '../../db/categories';
import { countHeld, holdReceipt } from '../../db/held';
import { say } from '../../ui/alert';
import { Icon, WebIcon } from '../../ui/icons';
import { applyPosTheme, pos } from '../../ui/webTheme';

/**
 * Значок плитки в панели выбора: те же три фигуры, что у него.
 *
 * Рисуются квадратиками, а не шрифтом значков: у него это простые фигуры —
 * четыре плитки у товаров, полосы у категорий, папка у групп, — и подобрать
 * их из набора точнее, чем сложить из прямоугольников, не выходит.
 */
function BrowseGlyph({
  kind,
  active,
  color,
}: {
  kind: string;
  active: boolean;
  /** Свой цвет — для пустой плитки витрины и синей кнопки каталога. */
  color?: string;
}) {
  const tint = color ?? (active ? '#FFFFFF' : pos.text);

  if (kind === 'categories') {
    return (
      <View style={styles.glyphRow}>
        <View style={[styles.glyphTall, { backgroundColor: tint }]} />
        <View style={styles.glyphCol}>
          <View style={[styles.glyphWide, { backgroundColor: tint }]} />
          <View style={[styles.glyphWide, { backgroundColor: tint }]} />
        </View>
      </View>
    );
  }

  if (kind === 'groups') {
    return (
      <View style={styles.glyphFolder}>
        <View style={[styles.glyphTab, { backgroundColor: tint }]} />
        <View style={[styles.glyphBody, { borderColor: tint }]} />
      </View>
    );
  }

  return (
    <View style={styles.glyphGrid}>
      <View style={[styles.glyphSquare, { backgroundColor: tint }]} />
      <View style={[styles.glyphDiamond, { backgroundColor: tint }]} />
      <View style={[styles.glyphSquare, { backgroundColor: tint }]} />
      <View style={[styles.glyphSquare, { backgroundColor: tint }]} />
    </View>
  );
}

/**
 * Короткий сигнал, когда товар попадает в чек.
 *
 * Своим тоном, а не звуковым файлом: файл пришлось бы вшивать в сборку, а
 * нужен один щелчок на сотую долю секунды. Настройка «Звук» в кассе включает
 * и выключает ровно это.
 */
function beep(): void {
  try {
    const Ctor =
      (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const context = new Ctor();
    const tone = context.createOscillator();
    const volume = context.createGain();

    tone.frequency.value = 880;
    volume.gain.value = 0.05;
    tone.connect(volume);
    volume.connect(context.destination);
    tone.start();
    tone.stop(context.currentTime + 0.05);
    // Контекст закрываем сами: браузер разрешает их немного, а чеков за день
    // много.
    tone.onended = () => void context.close();
  } catch {
    // Звук — не то, из-за чего касса должна падать.
  }
}

/** Ширина разделительной полосы; ею же расступается нижняя панель. */
const SPLITTER_WIDTH = 11;

/** Доля ширины, отданная витрине: где стоит граница с чеком. */
const SPLIT_KEY = 'pos.split';
/**
 * Курсор «двигать вбок».
 *
 * Мимо типов React Native: там `cursor` знает только про `auto` и `pointer`,
 * а в браузере значений больше, и полоса без такого курсора не выглядит той,
 * которую можно тянуть.
 */
const RESIZE_CURSOR = { cursor: 'col-resize', userSelect: 'none' } as unknown as ViewStyle;

function readSplit(): number {
  const saved = Number(globalThis.localStorage?.getItem(SPLIT_KEY));
  // Пределы здесь не проверяются: ширины окна ещё нет, и загонять долю
  // в рамки нечем. Это делает первая же раскладка.
  if (!Number.isFinite(saved) || saved <= 0 || saved >= 1) return DEFAULT_SPLIT;
  return saved;
}

/**
 * Интерфейс кассира.
 *
 * Отдельный экран во весь экран: у него своя палитра и свой шрифт — в исходном
 * приложении это вообще другое приложение, собранное на Material, а не на том
 * же, что кабинет. Слева витрина плитками, справа чек, внизу полоса продажи.
 */
export function Cashier() {
  const { db, refresh } = useDatabase();
  const cart = useCart();

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Id | null>(null);
  const [menu, setMenu] = useState(false);
  const [paying, setPaying] = useState(false);
  /**
   * Проведённый чек — для окна «Продажа прошла успешно».
   *
   * Держим весь расчёт, а не одну сдачу: окно показывает, из чего она
   * получилась, а чек к этому времени уже очищен.
   */
  const [done, setDone] = useState<{
    total: number;
    taken: { cash: number; card: number; credit: number };
    change: number;
    mode: 'sale' | 'return';
  } | null>(null);
  // Открытый раздел кассы. 'sale' — сама продажа, всё остальное рисуется
  // поверх неё, не уводя с экрана кассы.
  const [view, setView] = useState<CashierView>('sale');
  // Продажа или возврат. У него это `documentMode`, и переключается он
  // пунктом меню «Создать возврат»; касса при этом остаётся той же.
  const [mode, setMode] = useState<'sale' | 'return'>('sale');
  const [opening, setOpening] = useState(false);
  // Замок на панели закрытой смены открывается под курсором на кнопке.
  const [unlocking, setUnlocking] = useState(false);
  // Закрытие смены в два шага: сначала «действительно?», потом пересчёт ящика.
  const [askClose, setAskClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const [recoSettings, setRecoSettings] = useState(false);
  const [newClient, setNewClient] = useState(false);
  const searchField = useRef<TextInput>(null);
  /**
   * Что показывает витрина: товары, категории или группы.
   *
   * Переключает квадратик слева вверху — у него там всплывает панель с тремя
   * плитками, и выбранная горит оранжевым.
   */
  const [browse, setBrowse] = useState<'products' | 'categories' | 'groups'>('products');
  const [browseMenu, setBrowseMenu] = useState(false);
  /** В какую категорию провалились с плитки категорий. */
  const [category, setCategory] = useState<{ id: Id; name: string } | null>(null);
  // Покупатель чека. null — розничный: у него нет карточки и нет скидки.
  const [customer, setCustomer] = useState<CounterpartyWithTotals | null>(null);

  /** Меню трёх точек на кнопке продажи и окно очереди. */
  const [sellMenu, setSellMenu] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [pickingCustomer, setPickingCustomer] = useState(false);
  const [discounting, setDiscounting] = useState(false);
  /**
   * Скидка процентом, если её задали процентом.
   *
   * Хранится отдельно от суммы, потому что чек добирают: «десять процентов»
   * на одну позицию и на три — разные деньги, а обещали покупателю проценты.
   * Скидка суммой процент сбрасывает: там обещали ровно эти рубли.
   */
  const [discountPercent, setDiscountPercent] = useState<number | null>(null);

  /**
   * Где стоит граница между витриной и чеком — доля ширины, отданная витрине.
   *
   * Её двигают: в чайной длинные названия, и кому-то нужнее видеть их целиком,
   * а кому-то — больше плиток на витрине. Положение переживает перезагрузку:
   * подвинуть границу заново при каждом открытии кассы никто не станет.
   */
  const [split, setSplit] = useState(readSplit);
  const [bodyWidth, setBodyWidth] = useState(0);
  // Размер плитки задаёт окно, число плиток — ширина витрины. Двигаем
  // границу — товаров видно больше или меньше, а карточки остаются теми же.
  const windowWidth = useWindowDimensions().width;
  // Ряд заполняется целиком: ширина плитки — доля ряда, а не число точек.
  // Столбцов столько, чтобы плитка была как можно ближе к своему размеру.
  const columns = columnsFor(windowWidth, Math.max(0, (bodyWidth - SPLITTER_WIDTH) * split));

  function dragSplit(pageX: number, save = false): void {
    if (bodyWidth <= 0) return;
    // Пределы — в сантиметрах: чеку остаётся не меньше 8 см, витрине — 18.
    // Разбор — `src/domain/split.ts`.
    const next = clampSplit(pageX / bodyWidth, bodyWidth - SPLITTER_WIDTH);
    setSplit(next);
    if (save) globalThis.localStorage?.setItem(SPLIT_KEY, String(next));
  }

  /**
   * Окно поменяло размер — граница подтягивается в допустимые пределы.
   *
   * Иначе доля, сохранённая на широком мониторе, на ноутбуке оставила бы
   * чеку полоску в палец шириной.
   */
  useEffect(() => {
    if (bodyWidth <= 0) return;
    const allowed = clampSplit(split, bodyWidth - SPLITTER_WIDTH);
    if (Math.abs(allowed - split) > 0.0005) setSplit(allowed);
  }, [bodyWidth, split]);

  // Настройки кассы: порядок товаров и нулевые остатки на витрине, звук
  // при добавлении, «печатать чек» в окне оплаты.
  const { settings } = usePosSettings();

  // Оформление ставится при входе в кассу и всякий раз, когда его поменяли.
  useEffect(() => {
    applyPosTheme(settings.theme);
  }, [settings.theme]);

  /**
   * Отметки «что показывать на карточке» — одним значением, а не новым
   * объектом на каждую отрисовку.
   *
   * Плитка обёрнута в `memo`, но объект, собранный прямо в разметке, каждый
   * раз новый, и сравнение всегда расходилось: любое нажатие в настройках —
   * хоть звука, хоть оформления — перерисовывало все шесть сотен плиток.
   * Отсюда и заминка, на которую жаловались.
   */
  const card = useMemo(
    () => ({
      stock: settings.cardStock,
      image: settings.cardImage,
      code: settings.cardCode,
      sku: settings.cardSku,
      barcode: settings.cardBarcode,
    }),
    [
      settings.cardStock,
      settings.cardImage,
      settings.cardCode,
      settings.cardSku,
      settings.cardBarcode,
    ],
  );

  const products = useQuery(
    (database) =>
      listProducts(database, {
        search,
        categoryId: category?.id ?? null,
        sortBy: settings.sortBy,
        sortAsc: settings.sortAsc,
        hideZeroStocks: !settings.showZeroStocks,
        hideHiddenCategories: !settings.showHiddenCategories,
      }),
    [
      search,
      category?.id,
      settings.sortBy,
      settings.sortAsc,
      settings.showZeroStocks,
      settings.showHiddenCategories,
    ],
  );
  // Сколько чеков отложено — цифра на оранжевой кнопке над продажей.
  const held = useQuery((database) => countHeld(database));

  const categories = useQuery((database) => listCategoryTiles(database));
  const locations = useQuery((database) => listLocations(database));
  const shift = useQuery((database) => openShiftAnywhere(database));
  // Что предложить к набранному. Пересчитывается на каждое изменение чека:
  // подсказка «возьмите ещё вот это» имеет смысл только про то, что в чеке
  // лежит сейчас.
  const cartIds = cart.lines.map((line) => line.product_id).join(',');
  const reco = useQuery(
    (database) => recommendedFor(database, cartIds ? cartIds.split(',').map(Number) : []),
    [cartIds],
  );
  const shop = locations[0]?.name ?? 'Магазин';

  /**
   * Скидка процентом пересчитывается на каждое изменение чека.
   *
   * Иначе «десять процентов», данные на одну позицию, остались бы теми же
   * рублями после того, как в чек добрали ещё две: обещали процент, а
   * получилось бы меньше.
   */
  useEffect(() => {
    if (discountPercent === null) return;
    const wanted = discountFromPercent(cart.totals.subtotal, discountPercent);
    if (wanted !== cart.totals.discount) cart.setDiscount(wanted);
  }, [discountPercent, cart]);

  /**
   * Открыть смену.
   *
   * Не одним нажатием: смена начинается со сверки денег в ящике, и сумму, с
   * которой начали, спрашивает отдельное окно — без неё в конце смены не с
   * чем сравнивать пересчёт.
   */
  function openShiftNow() {
    setOpening(true);
  }

  /**
   * Нажали «ПРОДАЖА».
   *
   * Раньше здесь чек проводился сразу и молча: способ оплаты был всегда
   * наличными, сдача не считалась, а на любой ошибке — не открыта смена, не
   * хватает остатка — исключение уходило в пустоту, и со стороны это выглядело
   * так, будто касса «не поняла» и сбросила чек.
   */
  /**
   * Нажали плитку на витрине.
   *
   * Ссылка на обработчик держится неизменной: плитки запоминаются
   * (`React.memo`), и новая функция на каждую отрисовку заставляла бы
   * перерисовываться всю витрину — в том числе на каждое движение
   * разделительной полосы. Отсюда и рывки при перетаскивании.
   */
  const pickRef = useRef<(product: ProductWithStock) => void>(() => {});
  const pick = useCallback((product: ProductWithStock) => pickRef.current(product), []);

  pickRef.current = (product: ProductWithStock) => {
    // Остаток проверяется при нажатии, а не при оплате: узнать, что товара
    // нет, кассир должен сразу, а не после того, как назвал сумму.
    //
    // В возврате остаток не проверяется вовсе: товар приносят обратно, и на
    // складе его как раз и нет — потому и продали.
    //
    // Разрешена продажа в минус — не проверяется тоже: настройка ровно про
    // это, и останавливать кассира на подходе к чеку, чтобы пропустить его
    // на оплате, значило бы включить её наполовину.
    if (
      mode === 'sale' &&
      product.kind !== 'service' &&
      product.stock <= 0 &&
      !getSettings(db).negativeSale
    ) {
      say(
        'Товара нет на остатке',
        `«${product.name}» — остаток ${formatQty(product.stock)} ${product.unit}. ` +
          'Оприходуйте товар, проведите инвентаризацию или разрешите продажу в минус: ' +
          'Компания → Настройки → Основные.',
      );
      return;
    }

    const inCart = cart.lines.find((line) => line.product_id === product.id);
    if (
      mode === 'sale' &&
      product.kind !== 'service' &&
      (inCart?.qty ?? 0) + 1000 > product.stock &&
      !getSettings(db).negativeSale
    ) {
      say(
        'Больше нет',
        `«${product.name}»: на складе ${formatQty(product.stock)} ${product.unit}, ` +
          'столько уже в чеке.',
      );
      return;
    }

    setSelected(product.id);
    cart.add(product, 1000);
    if (settings.sound) beep();
  };

  /**
   * Буквы в рамках — не украшение, а клавиши.
   *
   * У них рядом с поиском товара стоит ⌐F¬, рядом с покупателем — ⌐C¬, и это
   * ровно то, чем их вызывают, не отрывая рук от клавиатуры. Ловим по коду
   * клавиши, а не по букве: в русской раскладке на тех же местах «а» и «с»,
   * и по букве сочетание работало бы через раз.
   *
   * Пока открыто любое окно или набирают в поле, клавиши молчат: «с» в имени
   * покупателя должна быть буквой, а не командой.
   */
  const busy =
    menu || paying || opening || askClose || closing || pickingCustomer ||
    discounting || recoSettings || newClient || browseMenu || view !== 'sale';

  useCashierKeys(!busy, (event) => {
    const tag = (event.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.code === 'KeyF') {
      event.preventDefault();
      searchField.current?.focus();
    }
    if (event.code === 'KeyC') {
      event.preventDefault();
      setPickingCustomer(true);
    }
  });

  const startPay = () => {
    if (cart.lines.length === 0) {
      say(
        mode === 'sale' ? 'Чек пуст' : 'Возврат пуст',
        'Выберите товары на витрине.',
      );
      return;
    }

    // Смена — первое, что проверяем: чек без смены некуда положить, и её
    // отсутствие надо назвать, а не молчать.
    if (!shift) {
      say(
        'Смена закрыта',
        'Чтобы работать, откройте смену: «Меню» слева внизу → «Открыть смену».',
      );
      return;
    }

    setPaying(true);
  };

  const pay = (
    payment: PaymentMethod,
    changeDue: number,
    note: string,
    debt = 0,
    taken: { cash: number; card: number; credit: number } = {
      cash: 0,
      card: 0,
      credit: 0,
    },
  ): void => {
    try {
      // Возврат проводится своей операцией: товар возвращается на склад, а
      // деньги уходят из кассы — списывать остаток здесь было бы наоборот.
      const post = mode === 'sale' ? createSale : createReturn;
      post(db, {
        customerId: customer?.id ?? null,
        note,
        discount: cart.discount,
        payment,
        // Отсрочка бывает только у продажи: возврат долга не создаёт.
        debt: mode === 'sale' ? debt : 0,
        lines: cart.lines,
        locationId: locations[0]?.id ?? null,
        // «Разрешить продажу в минус» из настроек компании. Настройка
        // читается в тот миг, когда чек проводится, а не когда открыли кассу:
        // её могли включить только что, из-за этого самого чека.
        allowNegative: getSettings(db).negativeSale,
      });
    } catch (error) {
      setPaying(false);

      // Не хватает остатка — говорим, чего именно и сколько: кассир должен
      // понять, какой товар убрать из чека, а не гадать.
      if (error instanceof OutOfStockError) {
        say(
          'Не хватает остатка',
          [
            ...error.details.map(
              (issue) =>
                `${issue.name}: в чеке ${formatQty(issue.requested)}, на складе ${formatQty(issue.available)}`,
            ),
            // Куда идти, если товар на прилавке есть, а в программе его нет:
            // без этой строки кассир упирается в отказ и не знает, что делать.
            '',
            'Если товар на руках, а прихода на него ещё нет — включите «Разрешить продажу в минус»: Компания → Настройки → Основные.',
          ].join('\n'),
        );
        return;
      }

      say(mode === 'sale' ? 'Чек не проведён' : 'Возврат не проведён', String(error));
      return;
    }

    // Сдачу посчитало окно оплаты: только там известно, сколько денег легло
    // на прилавок и каким способом.
    const rest = mode === 'sale' ? changeDue : 0;
    // Итог берём до очистки чека: через строку его уже не будет.
    setDone({ total: cart.totals.total, taken, change: rest, mode });

    cart.clear();
    setSelected(null);
    // Покупатель и скидка тоже сбрасываются: следующий чек пробивают
    // следующему, и оставленная карточка приписала бы его покупку прежнему
    // клиенту, а оставленная скидка — досталась бы ему даром.
    setCustomer(null);
    setDiscountPercent(null);
    cart.setDiscount(0);
    setPaying(false);
    refresh();
  };

  return (
    <View style={styles.screen}>
      <View
        style={styles.body}
        onLayout={(event) => setBodyWidth(event.nativeEvent.layout.width)}
      >
        {/* Витрина */}
        <View style={[styles.left, { flex: split }]}>
          <View style={styles.searchBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Товары, категории и группы"
              onPress={() => setBrowseMenu((open) => !open)}
              style={styles.gridButton}
            >
              <BrowseGlyph kind="products" active color="#FFFFFF" />
            </Pressable>
            <TextInput
              ref={searchField}
              value={search}
              onChangeText={setSearch}
              placeholder="Поиск по наименованию, артикулу, штрихкоду, коду и описанию"
              placeholderTextColor="#8E8E93"
              style={styles.searchInput}
            />
            <View style={styles.keyHint}>
              <Text style={styles.keyHintText}>F</Text>
            </View>
          </View>

          {/* Куда провалились: строка возврата к категориям. */}
          {category ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setCategory(null);
                setBrowse('categories');
              }}
              style={styles.crumb}
            >
              <Text style={styles.crumbBack}>‹</Text>
              <Text style={styles.crumbLabel}>{category.name}</Text>
            </Pressable>
          ) : null}

          {browse === 'categories' ? (
            <Scrollable toTop contentContainerStyle={styles.tiles}>
              {categories.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Категория «${item.name}»`}
                  onPress={() => {
                    setCategory({ id: item.id, name: item.name });
                    setBrowse('products');
                  }}
                  style={[
                    styles.tile,
                    styles.catTile,
                    // «Размер» из настроек: плитка на одну клетку или на две.
                    { width: `${(100 / columns) * (item.big ? 2 : 1)}%` },
                  ]}
                >
                  {/* Цветная полоса сверху — их примета. Цвет назначают в
                      «Настройках → Категории»; пока не назначили — берётся от
                      самого названия, чтобы у категории он был всегда один и
                      тот же, а не менялся от порядка в списке. */}
                  <View
                    style={[
                      styles.catStripe,
                      { backgroundColor: item.color ?? colorFromName(item.name) },
                    ]}
                  />
                  <Text style={styles.catName} numberOfLines={3}>
                    {item.name}
                  </Text>
                  <Text style={styles.catCount}>{item.count} поз.</Text>
                </Pressable>
              ))}

              {categories.length === 0 ? (
                <Text style={styles.browseNote}>
                  Категорий пока нет — их заводят в карточке товара.
                </Text>
              ) : null}
            </Scrollable>
          ) : (
            <Scrollable toTop contentContainerStyle={styles.tiles}>
              {browse === 'groups' ? (
                <Text style={styles.browseNote}>
                  Групп в каталоге пока нет — ниже всё, что вне групп.
                </Text>
              ) : null}

              {products.map((product) => (
                <Tile
                  key={product.id}
                  product={product}
                  columns={columns}
                  selected={selected === product.id}
                  card={card}
                  list={settings.view === 'list'}
                  onPick={pick}
                />
              ))}
            </Scrollable>
          )}

          {/* Панель выбора: Товары, Категории, Группы. */}
          {browseMenu ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Закрыть выбор"
                onPress={() => setBrowseMenu(false)}
                style={styles.browseShade}
              />
              <View style={styles.browsePanel}>
                {(
                  [
                    ['products', 'Товары'],
                    ['categories', 'Категории'],
                    ['groups', 'Группы'],
                  ] as ['products' | 'categories' | 'groups', string][]
                ).map(([id, label]) => (
                  <Pressable
                    key={id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: browse === id }}
                    onPress={() => {
                      setBrowse(id);
                      setCategory(null);
                      setBrowseMenu(false);
                    }}
                    style={[styles.browseTile, browse === id && styles.browseTileOn]}
                  >
                    <View style={styles.browseIcon}>
                      <BrowseGlyph kind={id} active={browse === id} />
                    </View>
                    <Text style={[styles.browseLabel, browse === id && styles.browseLabelOn]}>
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
        </View>

        {/* Граница, которую двигают: ровная полоса во всю высоту. Стрелок
            посередине нет — курсор над ней и так меняется на «двигать вбок»,
            а значок на белом фоне читался как случайный след. */}
        <View
          accessibilityRole="adjustable"
          accessibilityLabel="Ширина витрины"
          style={[styles.splitter, RESIZE_CURSOR]}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderMove={(event) => dragSplit(event.nativeEvent.pageX)}
          onResponderRelease={(event) => dragSplit(event.nativeEvent.pageX, true)}
        />

        {/* Чек */}
        <View style={[styles.right, { flex: 1 - split }]}>
          {/* Строка покупателя — это поиск, а не подпись: клиент называет
              телефон, кассир набирает четыре цифры и выбирает нужного. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Выбрать покупателя"
            onPress={() => setPickingCustomer(true)}
            style={styles.customerBar}
          >
            <WebIcon.search size={19} color="#8E8E93" />
            <View style={styles.customerText}>
              <Text style={styles.customerName} numberOfLines={1}>
                {customer ? customer.name : 'Розничный покупатель'}
              </Text>
              {customer ? (
                <Text style={styles.customerNote} numberOfLines={1}>
                  {[
                    formatPhone(customer.phone),
                    customer.loyalty_type !== 'bonus' && customer.discount_bp > 0
                      ? `скидка ${customer.discount_bp / 100} %`
                      : '',
                    customer.bonus_balance > 0
                      ? `${formatMoney(customer.bonus_balance)} бонусов`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              ) : null}
            </View>
            <View style={styles.keyHint}>
              <Text style={styles.keyHintText}>C</Text>
            </View>
            {/* Человечек с плюсом — «добавить покупателя», и ничего больше.
                Раньше кнопка открывала список клиентов, то есть отвечала не
                на тот вопрос: список нужен, чтобы найти, а тут — завести. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Добавить покупателя"
              onPress={() => setNewClient(true)}
              style={styles.addCustomer}
            >
              <WebIcon.personPlus size={24} color="#FFFFFF" />
            </Pressable>
          </Pressable>

          {shift ? (
            <>
              <View style={styles.recommendRow}>
                <Text style={styles.recommendLabel}>Рекомендации</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Настройки рекомендаций"
                  onPress={() => setRecoSettings(true)}
                  style={styles.recommendGear}
                >
                  <WebIcon.gear size={18} color={pos.muted} />
                </Pressable>
              </View>

              {/* Сами рекомендации — полоса под строкой. Нажатие кладёт товар
                  в чек: подсказка, которую нельзя принять одним касанием, не
                  подсказка. */}
              {reco.length > 0 ? (
                <Scrollable horizontal style={styles.recoStrip}>
                  {reco.map((product) => (
                    <Pressable
                      key={product.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Добавить «${product.name}»`}
                      onPress={() => pick(product)}
                      style={styles.recoTile}
                    >
                      <Text style={styles.recoName} numberOfLines={2}>
                        {product.name}
                      </Text>
                      <Text style={styles.recoPrice}>
                        {formatMoney(product.sale_price)} руб
                      </Text>
                    </Pressable>
                  ))}
                </Scrollable>
              ) : null}
            </>
          ) : (
            <View style={styles.recommendRow}>
              <Text style={styles.recommendLabel}>Смена закрыта</Text>
            </View>
          )}

          {/* Пока смена закрыта, чека нет вовсе: вместо него — замок и
              кнопка. Объяснять тут нечего, и он ничего не объясняет: замок
              закрыт, кнопка одна, и под курсором на ней замок открывается.
              Ровно это и надо понять. */}
          {!shift ? (
            <View style={styles.emptyReceipt}>
              {unlocking ? (
                <WebIcon.lockOpen size={106} color={pos.faint} />
              ) : (
                <WebIcon.lockClosed size={106} color={pos.faint} />
              )}
              <Pressable
                accessibilityRole="button"
                onPress={openShiftNow}
                onHoverIn={() => setUnlocking(true)}
                onHoverOut={() => setUnlocking(false)}
                style={({ pressed }) => [styles.openShift, pressed && { opacity: 0.9 }]}
              >
                <Text style={styles.openShiftLabel}>ОТКРЫТЬ СМЕНУ</Text>
              </Pressable>
            </View>
          ) : cart.lines.length === 0 ? (
            <View style={styles.emptyReceipt}>
              <Text style={styles.emptyReceiptText}>Выберите товары</Text>
            </View>
          ) : (
            <>
              <Scrollable style={styles.receipt}>
                {cart.lines.map((line) => {
                  const gross = Math.round((line.price * line.qty) / 1000);
                  const own = lineDiscountOf(line);
                  // Скидка чека раскладывается на позиции пропорционально —
                  // так у него: у строки видно и цену до скидки, и после.
                  const share =
                    cart.totals.subtotal > 0
                      ? Math.round(((gross - own) * cart.totals.discount) / cart.totals.subtotal)
                      : 0;
                  // В ярлыке — сколько сняли с этой строки всего: своя скидка
                  // товара и доля скидки чека вместе. Показывать их порознь
                  // значило бы спорить с ценой, которая тут же напечатана.
                  const off = own + share;
                  const percent = gross > 0 ? Math.round((off / gross) * 1000) / 10 : 0;

                  return (
                    <View key={line.product_id} style={styles.receiptRow}>
                      <View style={styles.receiptBody}>
                        <Text style={styles.receiptName} numberOfLines={2}>
                          {line.name}
                        </Text>
                        <View style={styles.receiptMeta}>
                          {off > 0 ? (
                            <View style={styles.discountBadge}>
                              <Text style={styles.discountBadgeText}>{percent}% Скидка</Text>
                            </View>
                          ) : null}
                          <Text style={styles.receiptQty}>
                            {formatQty(line.qty)} {line.unit} × {formatMoney(line.price)}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.receiptSums}>
                        <Text style={styles.receiptSum}>{formatMoney(gross - off)}</Text>
                        {off > 0 ? (
                          <Text style={styles.receiptWas}>{formatMoney(gross)}</Text>
                        ) : null}
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Убрать из чека"
                        onPress={() => cart.remove(line.product_id)}
                        hitSlop={8}
                      >
                        <Text style={styles.receiptRemove}>✕</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </Scrollable>

              {/* Подытог и скидка — у него они стоят над кнопкой продажи, и
                  по строке скидки в неё же и заходят. */}
              <View style={styles.totals}>
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>Подытог</Text>
                  <Text style={styles.totalsValue}>{formatMoney(cart.totals.gross)} руб</Text>
                </View>
                {cart.totals.lineDiscount > 0 ? (
                  <View style={styles.totalsRow}>
                    <Text style={styles.totalsLabel}>Скидки на товары</Text>
                    <Text style={styles.totalsValue}>
                      {formatMoney(cart.totals.lineDiscount)} руб
                    </Text>
                  </View>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Размер скидки"
                  onPress={() => setDiscounting(true)}
                  style={styles.totalsRow}
                >
                  <Text style={styles.totalsDiscount}>
                    Скидка{' '}
                    {percentFromDiscount(cart.totals.subtotal, cart.totals.discount).toFixed(2)} %
                  </Text>
                  <Text style={styles.totalsDiscount}>
                    {formatMoney(cart.totals.discount)} руб
                  </Text>
                </Pressable>
              </View>
            </>
          )}

          {/* Очередь и непроведённые — две кнопки в ряд, как у него.
              Оранжевая, пока в очереди кто-то есть; серая, когда пусто. */}
          <View style={styles.queueRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: held === 0 }}
              disabled={held === 0}
              onPress={() => setQueueOpen(true)}
              style={[styles.queueButton, held > 0 && styles.queueButtonOn]}
            >
              <Text style={[styles.queueLabel, held > 0 && styles.queueLabelOn]}>
                ОЧЕРЕДЬ ЧЕКОВ: {held}
              </Text>
            </Pressable>

            {/* «Непроведённые» — чеки, которые не ушли в фискальный
                регистратор. Регистратора у нас нет, и число здесь всегда
                ноль; кнопка стоит на своём месте и молчит. */}
            <View style={styles.queueButton}>
              <Text style={styles.queueLabel}>НЕПРОВЕДЕННЫЕ: 0</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Нижняя полоса */}
      <View style={styles.bottom}>
        {/* Левая часть нижней полосы повторяет пропорцию витрины, а синяя
            кнопка — пропорцию чека. Тогда кнопка стоит ровно под чеком при
            любой ширине окна; заданная процентами, она не совпадала с ним. */}
        <View style={[styles.bottomLeft, { flex: split }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Меню"
            onPress={() => setMenu(true)}
            style={styles.bottomMenu}
          >
            <Icon.menu size={24} color={pos.text} />
            <Text style={styles.bottomMenuLabel}>Меню</Text>
          </Pressable>

          {/* Черта за «Меню» — как у него: кнопка отделена от подписи кассы,
              а не стоит с ней в одну строку. По ней и видно, где кончается
              нажимаемое. */}
          <View style={styles.bottomDivider} />

          <Text style={styles.bottomShop} numberOfLines={1}>
            {shop} / {shift ? `Смена #${shift.id}` : 'Смена закрыта'}
          </Text>

          <Text style={styles.bottomClock}>{today()}</Text>
        </View>

        {/* Просвет ровно под разделительной полосой: ни кнопка продажи, ни
            строка с магазином и часами на неё не заходят. */}
        <View style={styles.bottomGap} />

        {/* Полоса продажи. Пока чек пуст, она бледная и не нажимается — у
            него так же: продавать нечего, и кнопка это показывает. */}
        <View
          style={[
            styles.sellBar,
            { flex: 1 - split },
            cart.lines.length === 0 && styles.sellBarOff,
          ]}
        >
          {/* Три точки — своя кнопка, а не часть полосы: у них своё меню, и
              нажатие на них не должно открывать оплату. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Меню чека"
            accessibilityState={{ disabled: cart.lines.length === 0 }}
            disabled={cart.lines.length === 0}
            onPress={() => setSellMenu(true)}
            style={styles.sellDotsButton}
          >
            <Text style={styles.sellDots}>⋮</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={mode === 'sale' ? 'Продажа' : 'Возврат'}
            disabled={cart.lines.length === 0}
            onPress={startPay}
            style={({ pressed }) => [styles.sellPress, pressed && { opacity: 0.9 }]}
          >
            <Text style={styles.sellLabel}>{mode === 'sale' ? 'ПРОДАЖА' : 'ВОЗВРАТ'}</Text>
            <Text style={styles.sellTotal}>{formatMoney(cart.totals.total)} руб</Text>
          </Pressable>
        </View>
      </View>

      <CashierSellMenu
        visible={sellMenu}
        onClose={() => setSellMenu(false)}
        who={shop}
        rightInset={(1 - split) * bodyWidth}
        onHold={() => {
          holdReceipt(db, {
            mode,
            customerId: customer?.id ?? null,
            customerName: customer?.name ?? null,
            discount: cart.totals.discount,
            lines: cart.lines,
          });
          refresh();
          cart.clear();
          setCustomer(null);
          setSelected(null);
          setDiscountPercent(null);
        }}
        onCancel={() => {
          cart.clear();
          setCustomer(null);
          setSelected(null);
          setDiscountPercent(null);
        }}
      />

      <CashierQueue
        visible={queueOpen}
        onClose={() => setQueueOpen(false)}
        onPick={(receipt) => {
          // Чек возвращается на кассу таким, каким его отложили: строки,
          // скидка и покупатель. Набранное до этого пропало бы молча —
          // поэтому его сперва откладываем обратно в очередь.
          if (cart.lines.length > 0) {
            holdReceipt(db, {
              mode,
              customerId: customer?.id ?? null,
              customerName: customer?.name ?? null,
              discount: cart.totals.discount,
              lines: cart.lines,
            });
          }

          cart.replace(receipt.lines, receipt.discount);
          setCustomer(null);
          setSelected(null);
          setDiscountPercent(null);
          refresh();
        }}
      />

      <CashierPayment
        visible={paying}
        mode={mode}
        total={cart.totals.total}
        onClose={() => setPaying(false)}
        customer={customer}
        onPay={pay}
      />

      <CashierSuccess
        visible={done !== null}
        total={done?.total ?? 0}
        taken={done?.taken ?? { cash: 0, card: 0, credit: 0 }}
        changeDue={done?.change ?? 0}
        mode={done?.mode ?? 'sale'}
        onClose={() => setDone(null)}
      />

      <CashierDiscount
        visible={discounting}
        subtotal={cart.totals.subtotal}
        discount={cart.totals.discount}
        onClose={() => setDiscounting(false)}
        onApply={(money, percent) => {
          setDiscountPercent(percent);
          cart.setDiscount(money);
        }}
      />

      <CashierCustomer
        visible={pickingCustomer}
        chosen={customer}
        onClose={() => setPickingCustomer(false)}
        onPick={(picked) => {
          setCustomer(picked);
          // Личная скидка клиента подставляется сама: её для того и завели,
          // и заставлять кассира вводить её руками — верный способ забыть.
          // Бонусному клиенту процент не даётся: у него бонусы вместо него.
          const personal =
            picked && picked.loyalty_type !== 'bonus' ? picked.discount_bp / 100 : 0;
          setDiscountPercent(personal > 0 ? personal : null);
          if (personal === 0) cart.setDiscount(0);
        }}
      />

      <CashierOpenShift
        visible={opening}
        onClose={() => setOpening(false)}
        onOpened={() => say('Смена открыта', 'Чеки будут копиться в ней, пока её не закроют.')}
      />

      {/* Закрытие смены спрашивает дважды, и первым — «действительно?».
          Закрытие необратимо, а мимо пункта меню попадают легко; пересчёт
          ящика идёт вторым шагом, когда кассир уже понял, что закрывает. */}
      <CashierSheet
        visible={askClose}
        title="Вы действительно хотите закрыть смену?"
        onClose={() => setAskClose(false)}
        items={[
          {
            label: 'Закрыть смену',
            severity: 'error',
            shortKey: 'Enter',
            onPress: () => setClosing(true),
          },
        ]}
      />

      <CashierCloseShift
        shiftId={shift?.id ?? null}
        visible={closing}
        onClose={() => setClosing(false)}
      />

      <CashierReco visible={recoSettings} onClose={() => setRecoSettings(false)} />

      <CashierNewClient
        visible={newClient}
        onClose={() => setNewClient(false)}
        onCreated={(created) => {
          // Заведённый клиент сразу встаёт в чек — за этим его и заводили,
          // пока он стоит у прилавка.
          setCustomer(created);
          const personal = created.loyalty_type !== 'bonus' ? created.discount_bp / 100 : 0;
          setDiscountPercent(personal > 0 ? personal : null);
        }}
      />

      <CashierMenu
        visible={menu}
        onClose={() => setMenu(false)}
        onOpenView={setView}
        mode={mode}
        who={shop}
        onOpenShift={openShiftNow}
        onCloseShift={() => setAskClose(true)}
        onToggleMode={() => {
          // Набранное не переносится из продажи в возврат: это разные чеки, и
          // молча превратить один в другой значило бы вернуть покупателю то,
          // что он только что выбрал купить.
          cart.clear();
          setSelected(null);
          setMode((current) => (current === 'sale' ? 'return' : 'sale'));
        }}
      />

      {/* Журнал чеков — окно поверх продажи, а не раздел с синей шапкой:
          из него возвращаются в тот же чек, который набирали. */}
      <CashierReceipts visible={view === 'receipts'} onClose={() => setView('sale')} />

      {/* «Возврат долга» — тоже окно поверх продажи: долг гасят между чеками,
          не уходя с рабочего места. */}
      <CashierDebts visible={view === 'debts'} onClose={() => setView('sale')} />

      {view !== 'sale' && view !== 'receipts' && view !== 'debts' ? (
        <View style={styles.panel}>
          <View style={styles.panelHead}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Назад к продаже"
              onPress={() => setView('sale')}
              style={styles.panelBack}
            >
              <Text style={styles.panelBackLabel}>‹</Text>
            </Pressable>
            <Text style={styles.panelTitle}>{VIEW_TITLE[view]}</Text>
          </View>
          <CashierPanel view={view} onCloseShift={() => setAskClose(true)} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Плитка витрины.
 *
 * Запоминается: витрина — это шестьсот с лишним плиток, и перерисовывать их
 * все ради того, что сдвинулась граница с чеком, незачем. Все её свойства
 * при перетаскивании остаются прежними, и React не трогает ни одну.
 */
const Tile = memo(function Tile({
  product,
  columns,
  selected,
  card,
  list,
  onPick,
}: {
  product: ProductWithStock;
  /** Сколько плиток в ряду: её ширина — доля от него. */
  columns: number;
  selected: boolean;
  /** Что показывать на карточке — «Настройки → Отображение товаров». */
  card: {
    stock: boolean;
    image: boolean;
    code: boolean;
    sku: boolean;
    barcode: boolean;
  };
  /** Витрина строками вместо плиток. */
  list: boolean;
  onPick: (product: ProductWithStock) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPick(product)}
      /**
       * Полное название под курсором.
       *
       * Плашку рисует **сам браузер**: у него на плитке обычный `title`, и та
       * серая рамка на снимке — системная подсказка, а не часть страницы.
       * Своя, нарисованная поверх плиток, выглядела иначе и вставала не там,
       * где ждут: не под курсором, а по краю карточки.
       *
       * Атрибут ставится через ссылку на узел: React Native Web своих
       * `title` не пропускает, а притворяться подсказкой не нужно — нужна она
       * сама.
       */
      ref={(node) => {
        (node as unknown as { setAttribute?: (name: string, value: string) => void })?.setAttribute?.(
          'title',
          product.name,
        );
      }}
      style={[
        list ? styles.line : styles.tile,
        list ? null : { width: `${100 / columns}%` },
        selected && styles.tileSelected,
      ]}
    >
      {card.stock && !list ? (
        <Text style={styles.tileStock}>
          {formatQty(product.stock)} {product.unit}
        </Text>
      ) : null}

      {card.image ? (
        <View style={list ? styles.lineImage : styles.tileImage}>
          {product.photo_uri ? (
            <Image source={{ uri: product.photo_uri }} style={styles.tilePhoto} />
          ) : (
            // Без фотографии — тот же значок, что у него: четыре фигуры,
            // а не сетка из девяти квадратиков.
            <BrowseGlyph kind="products" active={false} color={pos.faint} />
          )}
        </View>
      ) : null}

      <View style={list ? styles.lineMain : undefined}>
        <Text
          style={list ? styles.lineName : styles.tileName}
          numberOfLines={list ? 1 : 2}
        >
          {product.name}
        </Text>
        {card.code ? (
          <Text style={list ? styles.lineSmall : styles.tileСode}>{product.code ?? ''}</Text>
        ) : null}
        {card.sku ? (
          <Text style={list ? styles.lineSmall : styles.tileСode}>{product.sku ?? ''}</Text>
        ) : null}
        {card.barcode ? (
          <Text style={list ? styles.lineSmall : styles.tileСode}>{product.barcode ?? ''}</Text>
        ) : null}
      </View>

      {card.stock && list ? (
        <Text style={styles.lineStock}>
          {formatQty(product.stock)} {product.unit}
        </Text>
      ) : null}

      <View style={list ? styles.linePrice : styles.tilePriceRow}>
        <Text style={styles.tilePrice}>{formatMoney(product.sale_price)} руб</Text>
      </View>
    </Pressable>
  );
});

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

/** «8 августа, суббота 11:41» — как в нижней полосе исходного приложения. */
function today(now = new Date()): string {
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return `${now.getDate()} ${MONTHS[now.getMonth()]}, ${WEEKDAYS[now.getDay()]} ${time}`;
}

const styles = StyleSheet.create({
  /** Раздел кассы поверх продажи: корзина под ним остаётся набранной. */
  panel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: pos.bg,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 56,
    paddingHorizontal: 12,
    backgroundColor: pos.bar,
  },
  panelBack: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  panelBackLabel: { fontFamily: pos.font, fontSize: 24, color: '#FFFFFF', lineHeight: 32 },
  panelTitle: { fontFamily: pos.font, fontSize: 17, color: '#FFFFFF' },
  // Витрина строками: то же содержимое, но в ряд и во всю ширину.
  line: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: pos.tile,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },
  lineImage: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: pos.bg,
  },
  lineMain: { flex: 1, minWidth: 0 },
  lineName: { fontFamily: pos.font, fontSize: 16, color: pos.text },
  // В строке подписи идут слева под названием, а не по центру, как в плитке.
  lineSmall: { fontFamily: pos.font, fontSize: 13, color: pos.muted, marginTop: 2 },
  lineStock: { fontFamily: pos.font, fontSize: 13, color: pos.muted, marginRight: 12 },
  linePrice: { minWidth: 120, alignItems: 'flex-end' },

  screen: { flex: 1, backgroundColor: pos.bg },
  body: { flex: 1, flexDirection: 'row' },

  left: { backgroundColor: pos.bg, minWidth: 0 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: pos.tile,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
    height: 62,
    paddingRight: 16,
  },
  gridButton: {
    width: 62,
    height: 62,
    backgroundColor: pos.bar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: { outlineWidth: 0,
    flex: 1,
    fontFamily: pos.font, fontSize: 17,
    color: pos.text,
    paddingHorizontal: 20,
    outlineStyle: 'none',
  } as object,
  keyHint: {
    width: 30,
    height: 30,
    borderWidth: 1,
    borderColor: pos.faint,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyHintText: { fontFamily: pos.font, fontSize: 13, color: pos.muted },

  // Ни зазоров, ни отступов у самой сетки: ширина плиток задана долей, и
  // всё, что прибавлено сверху, ломает сумму в сто процентов. Просвет между
  // плитками рисует их собственная рамка.
  tiles: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: {
    backgroundColor: pos.tile,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
    borderWidth: 2,
    borderColor: pos.bg,
  },
  tileSelected: { borderColor: pos.accent },
  tileStock: { fontFamily: pos.font, fontSize: 13, color: pos.muted, textAlign: 'center' },
  tileImage: {
    height: 128,
    // Подложка картинки — общая подложка витрины, а не свой серый: иначе
    // в тёмном оформлении она осталась бы светлым пятном.
    backgroundColor: pos.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
    overflow: 'hidden',
  },
  tilePhoto: { width: '100%', height: '100%' },
  tileName: { fontFamily: pos.font, fontSize: 16, color: pos.text, textAlign: 'center', lineHeight: 18 },
  tileСode: { fontFamily: pos.font, fontSize: 13, color: pos.muted, textAlign: 'center', marginTop: 2 },
  tilePriceRow: {
    borderTopWidth: 1,
    borderTopColor: pos.border,
    marginTop: 8,
    paddingTop: 8,
  },
  tilePrice: { fontFamily: pos.font, fontSize: 15, fontWeight: '600', color: pos.text, textAlign: 'center' },

  right: { backgroundColor: pos.tile, minWidth: 0 },

  // Полоса шире самой черты: пальцем в единственный пиксель не попасть.
  // Цветом отличается и от витрины, и от чека — её видно как границу, а не
  // как шов между двумя белыми полями.
  splitter: { width: SPLITTER_WIDTH, backgroundColor: pos.border },
  customerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    height: 62,
    paddingLeft: 20,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },
  customerText: { flex: 1 },
  customerName: { fontFamily: pos.font, fontSize: 17, color: pos.text },
  customerNote: { fontFamily: pos.font, fontSize: 13, color: pos.muted },
  addCustomer: {
    width: 62,
    height: 62,
    backgroundColor: pos.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recommendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  recommendLabel: { fontFamily: pos.font, fontSize: 15, color: pos.text },
  recommendGear: { padding: 6 },

  // Плитка категории: цветная полоса сверху, название, «N поз.» внизу.
  // Плитка категории такой же высоты, как товарная: витрина не должна
  // рассыпаться, когда в неё смотрят категориями.
  catTile: { height: 214 },
  catStripe: { height: 10, marginHorizontal: -10, marginTop: -8, marginBottom: 12 },
  catName: { fontFamily: pos.font, fontSize: 17, color: pos.text, lineHeight: 21 },
  catCount: { fontFamily: pos.font, fontSize: 13, color: pos.muted, marginTop: 'auto', paddingTop: 14 },

  crumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: pos.tile,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },
  crumbBack: { fontFamily: pos.font, fontSize: 19, color: pos.bar },
  crumbLabel: { fontFamily: pos.font, fontSize: 15, color: pos.text },

  browseShade: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 2 },
  browsePanel: {
    position: 'absolute',
    top: 58,
    left: 0,
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    backgroundColor: pos.tile,
    borderBottomRightRadius: 6,
    zIndex: 3,
    shadowColor: pos.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  browseTile: {
    width: 132,
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    borderRadius: 6,
    backgroundColor: pos.bg,
  },
  browseTileOn: { backgroundColor: pos.accent },
  browseIcon: { height: 34, justifyContent: 'center' },
  browseLabel: { fontFamily: pos.font, fontSize: 15, color: pos.text },
  browseLabelOn: { color: '#FFFFFF' },
  browseNote: {
    fontFamily: pos.font,
    fontSize: 13,
    color: pos.muted,
    width: '100%',
    padding: 16,
  },

  glyphGrid: { width: 32, height: 32, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  glyphSquare: { width: 14, height: 14 },
  glyphDiamond: { width: 14, height: 14, transform: [{ rotate: '45deg' }] },
  glyphRow: { width: 34, height: 30, flexDirection: 'row', gap: 4 },
  glyphTall: { width: 11, height: 30 },
  glyphCol: { flex: 1, gap: 4 },
  glyphWide: { flex: 1 },
  glyphFolder: { width: 34, height: 30, justifyContent: 'flex-end' },
  glyphTab: { width: 16, height: 6, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  glyphBody: { height: 22, borderWidth: 3, borderRadius: 2 },

  recoStrip: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: pos.border },
  recoTile: {
    width: 132,
    padding: 10,
    marginLeft: 12,
    marginBottom: 12,
    backgroundColor: pos.bg,
    borderRadius: 4,
  },
  recoName: { fontFamily: pos.font, fontSize: 13, color: pos.text, lineHeight: 17 },
  recoPrice: { fontFamily: pos.font, fontSize: 13, color: pos.text, marginTop: 6 },

  emptyReceipt: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 14 },
  emptyReceiptText: { fontFamily: pos.font, fontSize: 28, color: pos.faint },
  // Синяя, а не зелёная: у него это обычная главная кнопка, того же цвета,
  // что и полоса продажи. Зелёный в кассе не значит ничего.
  openShift: {
    marginTop: 8,
    paddingHorizontal: 26,
    paddingVertical: 12,
    borderRadius: 4,
    backgroundColor: pos.bar,
  },
  openShiftLabel: { fontFamily: pos.font, fontSize: 15, color: '#FFFFFF', letterSpacing: 0.6 },

  receipt: { flex: 1 },
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: pos.border,
  },
  receiptBody: { flex: 1, gap: 2 },
  receiptName: { fontFamily: pos.font, fontSize: 15, color: pos.text },
  receiptQty: { fontFamily: pos.font, fontSize: 13, color: pos.muted },
  receiptMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  discountBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    backgroundColor: '#FCE4EC',
  },
  discountBadgeText: { fontFamily: pos.font, fontSize: 11, color: '#C2185B', fontWeight: '700' },
  receiptSums: { alignItems: 'flex-end' },
  receiptWas: {
    fontFamily: pos.font,
    fontSize: 13,
    color: pos.muted,
    textDecorationLine: 'line-through',
    fontVariant: ['tabular-nums'],
  },
  totals: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: pos.border,
  },
  totalsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalsLabel: { fontFamily: pos.font, fontSize: 14, color: pos.muted },
  totalsValue: {
    fontFamily: pos.font,
    fontSize: 14,
    color: pos.text,
    fontVariant: ['tabular-nums'],
  },
  totalsDiscount: { fontFamily: pos.font, fontSize: 14, color: pos.bar },
  receiptSum: { fontFamily: pos.font, fontSize: 15, color: pos.text, fontVariant: ['tabular-nums'] },
  receiptRemove: { fontFamily: pos.font, fontSize: 15, color: pos.muted },

  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 58,
    backgroundColor: pos.tile,
    borderTopWidth: 1,
    borderTopColor: pos.border,
  },
  // minWidth: 0 обеим половинам — иначе синюю полосу распирает её же
  // содержимое («⋮ ПРОДАЖА 60.00 руб» плюс отступы), она перестаёт слушаться
  // flex и вылезает левее чека на два десятка точек.
  bottomLeft: { minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  bottomGap: { width: SPLITTER_WIDTH, alignSelf: 'stretch', backgroundColor: pos.border },
  bottomMenu: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 },
  bottomDivider: { width: 1, alignSelf: 'stretch', backgroundColor: pos.border },
  bottomMenuLabel: { fontFamily: pos.font, fontSize: 15, color: pos.text },
  bottomShop: { flex: 1, fontFamily: pos.font, fontSize: 14, color: pos.muted, textAlign: 'center' },
  bottomClock: { fontFamily: pos.font, fontSize: 14, color: pos.muted, paddingRight: 24 },
  sellBar: { minWidth: 0, height: 58, backgroundColor: pos.bar, flexDirection: 'row' },
  // Пустой чек: полоса бледнеет, как у него, и не нажимается.
  sellBarOff: { opacity: 0.55 },
  sellDotsButton: { width: 52, alignItems: 'center', justifyContent: 'center' },
  sellPress: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 20,
    gap: 18,
  },
  sellInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 18,
  },

  // Две кнопки над полосой продажи: очередь и непроведённые.
  queueRow: { flexDirection: 'row', gap: 8, padding: 12, paddingTop: 0 },
  queueButton: {
    flex: 1,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: pos.raise,
    borderRadius: 3,
  },
  queueButtonOn: { backgroundColor: pos.accent },
  queueLabel: { fontFamily: pos.font, fontSize: 13, color: pos.muted, letterSpacing: 0.4 },
  queueLabelOn: { color: '#FFFFFF' },
  sellDots: { fontFamily: pos.font, fontSize: 18, color: '#FFFFFF' },
  sellLabel: { flex: 1, fontFamily: pos.font, fontSize: 17, color: '#FFFFFF', letterSpacing: 0.6 },
  sellTotal: { fontFamily: pos.font, fontSize: 18, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
});
