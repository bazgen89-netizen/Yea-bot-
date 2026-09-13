import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../Translated';

import { ActionsMenu } from '../ActionsMenu';
import { PricesDialog, CategoryDialog, OtherDialog, ScalesDialog } from '../BulkDialogs';
import {
  CATALOG_COLUMNS,
  COLUMNS_KEY,
  DEFAULT_COLUMNS,
  НОВЫЕ_КОЛОНКИ,
  sortProducts,
} from '../catalogColumns';
import { ColumnPicker } from '../ColumnPicker';
import { CatalogFilter, activeParts } from '../CatalogFilter';
import { Checkbox, Column, HeadRow, Pager, Row, SearchBox, ToolButton, Toolbar } from '../Table';
import { archiveProducts } from '../../db/bulk';
import { catalogCsv, stockCsv } from '../../db/export';
import { listLocations, stockByLocation } from '../../db/locations';
import { listProducts, type CatalogQuery } from '../../db/products';
import { formatMoneyWeb } from '../../domain/money';
import { formatQty } from '../../domain/qty';
import { pluralize } from '../../domain/plural';
import { today } from '../../domain/pricing';
import { DOC_KIND_LABEL, PRODUCT_KIND_LABEL } from '../../domain/types';
import type { ProductWithStock } from '../../domain/types';
import { useCatalogFilters } from '../../state/catalogFilters';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { confirm } from '../../ui/alert';
import { saveFile } from '../../ui/download';
import { WebIcon } from '../../ui/icons';
import { версияКабинета } from '../../ui/версияКабинета';
import { web, webText, WEB_FONT } from '../../ui/webTheme';
import { ProductCard } from './ProductCard';

/** Сколько строк на странице. При 661 товаре выходит семь страниц — как в исходном. */
const PAGE_SIZE = 100;

/**
 * «Товары и услуги / справочник» — таблица кабинета.
 *
 * Колонки остатков заводятся по магазинам из базы: сколько точек завели,
 * столько и колонок. Захардкодить их нельзя — у другого магазина набор свой.
 */
/**
 * Новый кабинет. Считается один раз: палитра и разметка выбираются при
 * загрузке, менять их на ходу всё равно нельзя.
 */
const НОВЫЙ = версияКабинета() === 'новая';

export function CatalogTable({ openId }: { openId?: string } = {}) {
  const router = useRouter();
  /**
   * Готовый отбор из адреса.
   *
   * На главной, в «Оценке склада», стоят его ссылки: «417 поз. с
   * себестоимостью равной 0 руб» и «151 поз. с остатком меньше 0». Они
   * обязаны открывать именно эти позиции, а не просто справочник, — иначе
   * это синий текст, который никуда не ведёт.
   */
  const asked = useLocalSearchParams<{ preset?: string }>();
  const [search, setSearch] = useState('');
  // Какой товар открыт в панели справа. Не переход по адресу: у него список
  // остаётся виден слева, а страница не перезагружается — иначе после
  // закрытия карточки пришлось бы заново листать до нужной страницы и
  // набирать поиск.
  const [open, setOpen] = useState<string | null>(openId ?? null);
  const [page, setPage] = useState(1);
  const { db, refresh } = useDatabase();

  /** Какое окно из меню «Действия» открыто. */
  const [bulk, setBulk] = useState<'prices' | 'category' | 'other' | 'scales' | null>(null);

  const [filterOpen, setFilterOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  /*
   * «Группы» — у него галочка справа в панели: с ней товары идут папками
   * («Зал», и внутри — что в зале), без неё сплошным списком. Галочка
   * отмечена по умолчанию, как у него.
   */
  const [группы, переключитьГруппы] = useState(true);
  /** Сколько строк ленты уже показано — только в новом кабинете. */
  const [видно, показать] = useState(PAGE_SIZE);

  const filters = useCatalogFilters();

  /**
   * Условие из окна «Фильтр».
   *
   * Живёт рядом с готовыми наборами, а не вместо них: наборы остались
   * «пресетами» сверху окна, а это — то, что он собрал руками.
   */
  const [query, setQuery] = useState<CatalogQuery>(() => {
    if (asked.preset === 'zero-cost') return { price: { field: 'cost', op: 'eq', value: 0 } };
    if (asked.preset === 'negative-stock') return { stock: { op: 'lt', value: 0 } };
    return {};
  });

  // Кнопка «Фильтр» подсвечена, когда что-то отобрано: и готовыми наборами,
  // и собранным условием.
  const active = filters.active + activeParts(query);

  // Какие колонки показывать. Выбор запоминается: у него он тоже переживает
  // перезагрузку, иначе настраивать таблицу пришлось бы каждое утро.
  const [shown, setShown] = useState<string[]>(() => readColumns());
  /** Сортировка: по наименованию и по возрастанию, как открывается у него. */
  const [sorting, setSorting] = useState({ key: 'name', reverse: false });

  const products = useQuery(
    (db) => listProducts(db, { search, presets: filters.presets, query }),
    [search, filters.presets, query],
  );
  const locations = useQuery((db) => listLocations(db));
  const stock = useQuery((db) => stockByLocation(db));

  // Показываемые колонки в том порядке, в каком они объявлены, а не в каком
  // их отмечали: порядок столбцов — часть таблицы, а не история нажатий.
  /*
   * Колонки до магазинов. «Остаток» сюда не попадает: у него он стоит
   * последним, уже после колонок точек, — так и рисуем.
   */
  const picked = useMemo(
    () => CATALOG_COLUMNS.filter((column) => shown.includes(column.key) && column.key !== 'stock'),
    [shown],
  );
  const остатокКолонка = useMemo(
    () => (shown.includes('stock') ? CATALOG_COLUMNS.find((c) => c.key === 'stock') : undefined),
    [shown],
  );

  const columns = useMemo<Column[]>(
    () => [
      ...picked.map((column) => ({
        key: column.key,
        title: column.title,
        width: шириной(column.width, column.numeric, column.key),
        numeric: column.numeric,
        // Подчёркнута — значит сортирует; без правила сортировки колонку
        // подчёркивать нельзя.
        sortable: Boolean(column.sort),
      })),
      // Остаток по каждому магазину — столько колонок, сколько точек заведено.
      ...locations.map((location) => ({
        key: `loc${location.id}`,
        title: location.name,
        width: НОВЫЙ ? 112 : 168,
        numeric: true,
      })),
      ...(остатокКолонка
        ? [
            {
              key: остатокКолонка.key,
              title: остатокКолонка.title,
              width: шириной(остатокКолонка.width, true, остатокКолонка.key),
              numeric: true,
              sortable: true,
            },
          ]
        : []),
    ],
    [picked, locations, остатокКолонка],
  );

  // Сортируем весь справочник, а не видимую страницу.
  const sorted = useMemo(
    () => sortProducts(products, остатокКолонка ? [...picked, остатокКолонка] : picked, sorting),
    [products, picked, остатокКолонка, sorting],
  );

  /*
   * Список с папками.
   *
   * У него товары лежат группами: строка-папка «Зал», под ней — что в зале.
   * Галочка «Группы» в панели их включает и выключает. Группировать нам
   * нечем, кроме категорий: отдельных «групп товаров» у нас в базе нет — и
   * придумывать их ради одной галочки хуже, чем честно сгруппировать по
   * тому, что есть.
   *
   * Без категории — в конце списка, без папки.
   */
  const лента = useMemo(
    () => (НОВЫЙ && группы ? папками(sorted) : sorted),
    [sorted, группы],
  );

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  /*
   * В новом кабинете страниц нет вовсе — список идёт лентой и подкладывается
   * по мере прокрутки: у него внизу таблицы только «+ Создать новый товар»,
   * никакой листалки. Сразу все шестьсот строк рисовать незачем, поэтому
   * сотня и ещё сотня при подходе к низу.
   */
  const page1 = НОВЫЙ
    ? лента.slice(0, видно)
    : лента.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <View style={styles.screen}>
      <Toolbar>
        <SearchBox
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          // У него в новом кабинете в поле стоит одно слово — «Поиск».
          placeholder={НОВЫЙ ? 'Поиск' : 'Поиск по наименованию,'}
        />
        {/* Фильтр у него в новом кабинете — значок-воронка без подписи и без
            рамки, 36×36. Подпись «Фильтр» осталась в прежнем. */}
        <ToolButton
          label={НОВЫЙ ? (active > 0 ? String(active) : '') : active > 0 ? `Фильтр: ${active}` : 'Фильтр'}
          tone={active > 0 ? 'blueOutline' : НОВЫЙ ? 'bare' : 'plain'}
          icon={<WebIcon.funnel color={active > 0 ? web.link : web.text} />}
          onPress={() => {
            setFilterOpen(true);
            setPage(1);
          }}
        />
        <ActionsMenu
          label={НОВЫЙ ? `Действия (${products.length})` : `Действия ${products.length} поз.`}
          groups={[
            {
              items: [
                {
                  label: 'Создать документ',
                  submenu: (
                    [
                      'purchase',
                      'sale',
                      'stock_in',
                      'writeoff',
                      'transfer',
                      'inventory',
                    ] as const
                  ).map((kind) => ({
                    label: DOC_KIND_LABEL[kind],
                    onPress: () => router.push(`/doc/new?kind=${kind}`),
                  })),
                },
              ],
            },
            {
              title: 'РАБОТА С ГРУППОЙ ТОВАРОВ',
              items: [
                { label: 'Цены и скидки', onPress: () => setBulk('prices') },
                { label: 'Категории и группы', onPress: () => setBulk('category') },
                // «Другое» у него — сроки годности, НДС и признаки товара.
                { label: 'Другое', onPress: () => setBulk('other') },
              ],
            },
            {
              items: [
                { label: 'Ценники', onPress: () => router.push('/print-forms') },
                { label: 'Редактор цен', onPress: () => router.push('/catalog/prices') },
              ],
            },
            {
              items: [
                {
                  label: 'Оценка склада',
                  icon: <WebIcon.products size={18} color={web.text} />,
                  onPress: () => router.push('/reports'),
                },
                // Файл для весов: модель выбирается в окне — их же три,
                // с их же наборами колонок.
                {
                  label: 'Файл для весов',
                  icon: <WebIcon.tag size={18} color={web.text} />,
                  onPress: () => setBulk('scales'),
                },
                {
                  label: 'Скачать в Excel',
                  icon: <WebIcon.download size={18} color={web.text} />,
                  submenu: [
                    {
                      label: 'Остатки и цены',
                      onPress: () => {
                        void saveFile(
                          `Товары ${today()}.csv`,
                          stockCsv(db),
                          'text/csv;charset=utf-8',
                        );
                      },
                    },
                    {
                      // Эта выгрузка возвращается обратно: заголовки колонок —
                      // те же слова, по которым импорт узнаёт поля. Каталог
                      // правят таблицей и заливают целиком.
                      label: 'Все поля карточки',
                      onPress: () => {
                        void saveFile(
                          `Каталог ${today()}.csv`,
                          catalogCsv(db),
                          'text/csv;charset=utf-8',
                        );
                      },
                    },
                  ],
                },
              ],
            },
            {
              items: [
                {
                  label: 'Удалить',
                  icon: <WebIcon.trash size={18} color="#DB2828" />,
                  danger: true,
                  onPress: () =>
                    confirm(
                      'Удалить товары',
                      `${products.length} поз. уйдут в корзину. Продажи и движения склада ` +
                        'по ним останутся — товар просто пропадёт из справочника и с витрины.',
                      'Удалить',
                      () => {
                        archiveProducts(db, products.map((product) => product.id));
                        refresh();
                      },
                    ),
                },
              ],
            },
          ]}
        />
        {НОВЫЙ ? null : (
          <ToolButton label={`Колонки: ${picked.length}`} onPress={() => setColumnsOpen(true)} />
        )}
        {/* У него это «+ Создать товар»: плюс внутри кнопки, а не значком. */}
        <ToolButton
          label={НОВЫЙ ? '+ Создать товар' : 'Создать товар'}
          tone="green"
          onPress={() => setOpen('new')}
        />
        <ToolButton
          label=""
          tone={НОВЫЙ ? 'bare' : 'plain'}
          icon={<WebIcon.folderPlus color={web.text} />}
          soon
        />
        {/* Импорт у него тоже значком без подписи. */}
        <ToolButton
          label={НОВЫЙ ? '' : 'Импорт товаров'}
          tone={НОВЫЙ ? 'bare' : 'greenOutline'}
          icon={<WebIcon.excel color={НОВЫЙ ? web.text : web.actionText} />}
          onPress={() => router.push('/import?kind=products')}
        />

        {/* Справа у него галочка «Группы» и значок выбора колонок. */}
        {НОВЫЙ ? (
          <View style={styles.правыйКрай}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: группы }}
              onPress={() => переключитьГруппы((было) => !было)}
              style={styles.группы}
            >
              <View style={[styles.группыКвадрат, группы && styles.группыОтмечен]}>
                {группы ? <WebIcon.done size={13} color="#FFFFFF" /> : null}
              </View>
              <Text style={styles.группыПодпись}>Группы</Text>
            </Pressable>
            <ToolButton
              label=""
              tone="bare"
              icon={<WebIcon.tiles color={web.text} />}
              onPress={() => setColumnsOpen(true)}
            />
          </View>
        ) : null}
      </Toolbar>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        style={styles.table}
        // Без `flexGrow` содержимое горизонтальной прокрутки не получает
        // высоты, и вложенная вертикальная прокрутка растёт по содержимому —
        // тогда последние строки уезжают под подвал.
        contentContainerStyle={styles.tableContent}
      >
        <View style={styles.tableInner}>
          <HeadRow
            columns={columns}
            celled={НОВЫЙ}
            lead={<View style={НОВЫЙ ? styles.галочкаЯчейка : null}><Checkbox /></View>}
            sorting={sorting}
            onSort={(key) =>
              setSorting((was) =>
                was.key === key ? { key, reverse: !was.reverse } : { key, reverse: false },
              )
            }
          />

          <ScrollView
            style={styles.body}
            scrollEventThrottle={200}
            onScroll={({ nativeEvent: с }) => {
              if (!НОВЫЙ) return;
              const доНиза =
                с.contentSize.height - с.layoutMeasurement.height - с.contentOffset.y;
              if (доНиза < 600) показать((было) => было + PAGE_SIZE);
            }}
          >
            {page1.map((product) =>
              'папка' in product ? (
                <Папка key={`папка:${product.папка}`} имя={product.папка} />
              ) : (
              <ProductRow
                key={product.id}
                product={product}
                picked={picked}
                locations={locations.map((location) => location.id)}
                widths={columns}
                stock={stock.get(product.id)}
                итого={остатокКолонка}
                onPress={() => setOpen(String(product.id))}
              />
              ),
            )}

            {page1.length === 0 ? (
              <Text style={styles.empty}>
                {search ? 'Ничего не нашлось' : 'В справочнике пока нет товаров'}
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </ScrollView>

      <PricesDialog
        visible={bulk === 'prices'}
        products={products}
        onClose={() => setBulk(null)}
      />
      <CategoryDialog
        visible={bulk === 'category'}
        products={products}
        onClose={() => setBulk(null)}
      />
      <OtherDialog
        visible={bulk === 'other'}
        products={products}
        onClose={() => setBulk(null)}
      />
      <ScalesDialog
        visible={bulk === 'scales'}
        products={products}
        onClose={() => setBulk(null)}
      />

      <CatalogFilter
        visible={filterOpen}
        value={query}
        onClose={() => setFilterOpen(false)}
        onApply={(next) => {
          setQuery(next);
          setPage(1);
        }}
        saved={filters.saved
          .filter((item) => item.query)
          .map((item) => ({ name: item.name, query: item.query as CatalogQuery }))}
        onSave={(name, next) => filters.saveQuery(name, next)}
      />

      <ColumnPicker
        visible={columnsOpen}
        onClose={() => setColumnsOpen(false)}
        shown={shown}
        onToggle={(key) => {
          setShown((current2) => {
            const next = current2.includes(key)
              ? current2.filter((item) => item !== key)
              : [...current2, key];
            writeColumns(next);
            return next;
          });
        }}
        onReset={() => {
          setShown(ПО_УМОЛЧАНИЮ);
          writeColumns(ПО_УМОЛЧАНИЮ);
        }}
      />

      {open !== null ? <ProductCard id={open} onClose={() => setOpen(null)} /> : null}

      {НОВЫЙ ? null : <Pager page={current} pages={pages} onPage={setPage} />}

      <View style={styles.createRow}>
        {/* Значок и подпись — одна кнопка. Раньше нажималась только подпись,
            а синий плюсик рядом молчал: синее, что не нажимается, обещает
            переход, которого нет. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Создать новый товар или услугу"
          onPress={() => setOpen('new')}
          style={styles.createButton}
        >
          <Text style={styles.createSign}>⊞</Text>
          <Text style={styles.createLabel}>Создать новый товар или услугу</Text>
        </Pressable>
        <Text style={styles.total}>
          {pluralize(products.length, 'позиция', 'позиции', 'позиций')}
        </Text>
      </View>
    </View>
  );
}

/** Строка-папка в ленте: не товар, а заголовок группы. */
interface СтрокаПапки {
  папка: string;
}

/**
 * Разложить товары папками по категориям.
 *
 * Порядок внутри папки — тот, что задан сортировкой таблицы; сами папки идут
 * по алфавиту. Без категории — наверху и без папки.
 */
function папками(товары: ProductWithStock[]): (ProductWithStock | СтрокаПапки)[] {
  const без: ProductWithStock[] = [];
  const по = new Map<string, ProductWithStock[]>();

  for (const товар of товары) {
    const имя = товар.category_name?.trim();
    if (!имя) {
      без.push(товар);
      continue;
    }
    const в = по.get(имя);
    if (в) в.push(товар);
    else по.set(имя, [товар]);
  }

  const лента: (ProductWithStock | СтрокаПапки)[] = [];
  for (const имя of [...по.keys()].sort((a, b) => a.localeCompare(b, 'ru'))) {
    лента.push({ папка: имя });
    лента.push(...(по.get(имя) as ProductWithStock[]));
  }
  // Ни в какой папке не лежащее — в конец. Наверху оно дало бы первый экран
  // из одних прочерков: в чайной у половины карточек категории нет.
  лента.push(...без);
  return лента;
}

/** Сама строка-папка: значок и название, как у него на «Зал». */
function Папка({ имя }: { имя: string }) {
  return (
    <View style={styles.папка}>
      <View style={styles.галочкаЯчейка}>
        <Checkbox />
      </View>
      <WebIcon.folder size={16} color={web.text} />
      <Text style={styles.папкаИмя}>{имя}</Text>
    </View>
  );
}

/**
 * Ширина столбца.
 *
 * В прежнем кабинете она у каждой колонки своя — так и было подобрано. В
 * новом у него все столбцы одинаковые: замерено по его же `th` — имя 400,
 * числовые 112, остальные 176. Своя ширина на каждую колонку там выглядела
 * бы самодеятельностью.
 */
function шириной(своя: number, числовая: boolean | undefined, ключ: string): number {
  if (!НОВЫЙ) return своя;
  if (ключ === 'name') return 400;
  return числовая ? 112 : 176;
}

function ProductRow({
  product,
  picked,
  widths,
  locations,
  stock,
  итого,
  onPress,
}: {
  product: ProductWithStock;
  picked: typeof CATALOG_COLUMNS;
  widths: Column[];
  locations: number[];
  stock: Map<number, number> | undefined;
  /** Колонка общего остатка, если она включена: у него она идёт последней. */
  итого?: (typeof CATALOG_COLUMNS)[number];
  onPress: () => void;
}) {
  /** Ячейка: в новом кабинете у неё свои поля и линия справа. */
  const последний = widths[widths.length - 1]?.key;
  const ячейка = (ключ: string, ширина: number, внутри: React.ReactNode) =>
    НОВЫЙ ? (
      <View
        key={ключ}
        style={[
          styles.ячейка,
          { width: ширина },
          // Как у него: у колонки с названием и у самой правой линии справа
          // нет — линии стоят только между средними столбцами.
          (ключ === 'name' || ключ === последний) && styles.ячейкаБезЛинии,
        ]}
      >
        {внутри}
      </View>
    ) : (
      внутри
    );

  const число = (ключ: string, ширина: number, текст: string, красное = false) =>
    ячейка(
      ключ,
      ширина,
      <Text
        key={ключ}
        style={[
          webText.rowNumber,
          styles.right,
          НОВЫЙ ? null : { width: ширина },
          красное && { color: web.danger },
        ]}
        numberOfLines={1}
      >
        {текст}
      </Text>,
    );

  return (
    <Row onPress={onPress} celled={НОВЫЙ}>
      <View style={НОВЫЙ ? styles.галочкаЯчейка : null}>
        <Checkbox />
      </View>

      {picked.map((column, index) => {
        const ширина = widths[index]?.width ?? column.width;

        // Первая колонка несёт картинку, ссылку и значок вида — по ней
        // открывают товар.
        if (index === 0) {
          return ячейка(
            column.key,
            ширина,
            <View key={column.key} style={[styles.nameCell, НОВЫЙ ? null : { width: ширина }]}>
              <View style={styles.thumb}>
                {product.photo_uri ? (
                  <Image
                    source={{ uri: product.photo_uri }}
                    resizeMode="cover"
                    style={styles.thumbImage}
                  />
                ) : (
                  <WebIcon.products size={Math.round(web.thumbSize / 2)} color="#C4C7CA" />
                )}
              </View>
              <Text style={styles.link} numberOfLines={3}>
                {column.value(product)}
              </Text>
              {НОВЫЙ ? <ЗначокВида вид={product.kind} /> : null}
            </View>,
          );
        }

        // Категория у него не текстом, а плашкой — синей, с рамкой.
        if (НОВЫЙ && (column.key === 'category' || column.key === 'group')) {
          const имя = column.value(product);
          return ячейка(
            column.key,
            ширина,
            имя ? <Чип key={column.key} текст={имя} /> : <Прочерк key={column.key} />,
          );
        }

        const текст = column.value(product);
        if (НОВЫЙ && !текст) return ячейка(column.key, ширина, <Прочерк key={column.key} />);
        if (column.numeric) return число(column.key, ширина, текст);

        return ячейка(
          column.key,
          ширина,
          <Text
            key={column.key}
            style={[webText.rowCell, НОВЫЙ ? null : { width: ширина }]}
            numberOfLines={1}
          >
            {текст}
          </Text>,
        );
      })}

      {locations.map((id, index) => {
        const qty = stock?.get(id) ?? 0;
        const ширина = widths[picked.length + index]?.width ?? 168;
        return число(`loc${id}`, ширина, formatQty(qty), qty < 0);
      })}

      {итого
        ? число(
            итого.key,
            widths[widths.length - 1]?.width ?? итого.width,
            итого.value(product),
            product.stock < 0,
          )
        : null}
    </Row>
  );
}

/**
 * Значок вида позиции сразу за названием: «Т», «У», «К».
 *
 * У него в справочнике он стоит у каждой строки — зелёная буква в рамке для
 * товара, оранжевая для комплекта. Замерено: 19×17, скругление 4, буква
 * 8,75 точки начертанием 500, поля 2×6.
 */
function ЗначокВида({ вид }: { вид: ProductWithStock['kind'] }) {
  const буква = PRODUCT_KIND_LABEL[вид].charAt(0).toUpperCase();
  const цвет =
    вид === 'set'
      ? { фон: web.badgeSetBg, текст: web.badgeSetText }
      : вид === 'service'
        ? { фон: web.badgeServiceBg, текст: web.badgeServiceText }
        : { фон: web.badgeProductBg, текст: web.badgeProductText };

  return (
    <View
      accessibilityLabel={PRODUCT_KIND_LABEL[вид]}
      style={[styles.значок, { backgroundColor: цвет.фон, borderColor: цвет.текст }]}
    >
      <Text style={[styles.значокБуква, { color: цвет.текст }]}>{буква}</Text>
    </View>
  );
}

/** Категория плашкой — как у него в колонке «Категория». */
function Чип({ текст }: { текст: string }) {
  return (
    <View style={styles.чип}>
      <Text style={styles.чипТекст} numberOfLines={1}>
        {текст}
      </Text>
    </View>
  );
}

/** Пустая ячейка у него не пустует, а держит прочерк. */
function Прочерк() {
  return <Text style={webText.rowCell}>—</Text>;
}

/**
 * Выбор колонок хранится в том же месте, что настройки: это настройка одного
 * человека, а не данные склада.
 */
/**
 * У каждого кабинета свой набор по умолчанию и своя память о выбранном.
 *
 * Ключ разный не для порядка: набор прежнего кабинета («Код», «Ед. изм.»,
 * «Себестоимость») в новом смотрелся бы чужим, а человек, один раз
 * настроивший таблицу в прежнем виде, получил бы её же при переходе — и
 * решил бы, что новый кабинет ничем не отличается.
 */
const ПО_УМОЛЧАНИЮ = НОВЫЙ ? НОВЫЕ_КОЛОНКИ : DEFAULT_COLUMNS;
const КЛЮЧ_КОЛОНОК = НОВЫЙ ? `${COLUMNS_KEY}:new` : COLUMNS_KEY;

function readColumns(): string[] {
  try {
    const saved = globalThis.localStorage?.getItem(КЛЮЧ_КОЛОНОК);
    const parsed = saved ? (JSON.parse(saved) as string[]) : null;
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : ПО_УМОЛЧАНИЮ;
  } catch {
    return ПО_УМОЛЧАНИЮ;
  }
}

function writeColumns(columns: string[]): void {
  try {
    globalThis.localStorage?.setItem(КЛЮЧ_КОЛОНОК, JSON.stringify(columns));
  } catch {
    // Приватный режим браузера запрещает запись — выбор просто не запомнится.
  }
}

/**
 * Код товара — короткий номер вроде «01444». Если у товара его не задали,
 * показываем номер записи в том же виде: колонка не должна пустовать, по ней
 * товар ищут вслух.
 */
function codeOf(product: ProductWithStock): string {
  return product.code ?? String(product.id).padStart(5, '0');
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: web.bg },
  /**
   * Таблица занимает то, что осталось между строкой отбора и подвалом.
   *
   * Раньше у неё стоял `maxHeight: 10000` — то есть высота по содержимому, —
   * и последние строки списка уходили **под** подвал «Создать новый товар».
   * Товар там был виден краем, но не нажимался: сверху лежал подвал. У них
   * такого нет, потому что высота таблицы задана прямо:
   * `.fixed-title div.table { height: calc(100vh - 129px - 46px) }`.
   */
  table: { flex: 1 },
  tableContent: { flexGrow: 1 },
  tableInner: { flex: 1 },
  body: { flex: 1 },
  nameCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  thumb: {
    width: web.thumbSize,
    height: web.thumbSize,
    borderRadius: web.thumbRadius,
    backgroundColor: web.placeholder,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  // Название товара — 15 пикселей: в оригинале ссылка в строке крупнее ячеек.
  link: {
    // Не `flex: 1`, а «сколько нужно»: у него значок вида стоит сразу за
    // названием — «Саган Дайля [Т]», — а не улетает к правому краю колонки.
    flexShrink: 1,
    fontFamily: WEB_FONT,
    fontSize: web.rowLinkSize,
    fontWeight: web.rowLinkWeight,
    color: web.rowLink,
    lineHeight: Math.round(web.rowLinkSize * 1.27),
  },
  right: { textAlign: 'right' },
  empty: { padding: 40, fontFamily: WEB_FONT, fontSize: 15, color: web.textMuted },
  createButton: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  createRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: web.border,
  },
  createSign: { fontFamily: WEB_FONT, fontSize: 16, color: web.link },
  createLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.link },
  total: { flex: 1, textAlign: 'right', fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted },

  /** Галочка «Группы» и выбор колонок прижаты к правому краю панели. */
  правыйКрай: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  группы: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  группыКвадрат: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: web.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  группыОтмечен: { backgroundColor: web.action, borderColor: web.action },
  группыПодпись: { fontFamily: WEB_FONT, fontSize: 10.5, fontWeight: '500', color: web.text },

  /** Ячейка нового кабинета: поля `0 7px` и линия справа — замерено у него. */
  ячейка: {
    paddingHorizontal: 7,
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: web.cellBorder,
  },
  ячейкаБезЛинии: { borderRightWidth: 0 },

  /** Строка-папка: та же высота, что у обычной, но без столбцов. */
  папка: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: web.rowHeight,
    borderBottomWidth: 1,
    borderBottomColor: web.gridLine,
  },
  папкаИмя: { fontFamily: WEB_FONT, fontSize: web.rowLinkSize, fontWeight: '600', color: web.text },
  /** Колонка с галочкой: у него она 40 точек шириной. */
  галочкаЯчейка: { width: 40, alignItems: 'center', justifyContent: 'center' },

  значок: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  значокБуква: { fontFamily: WEB_FONT, fontSize: 8.75, fontWeight: '500', lineHeight: 11 },

  чип: {
    alignSelf: 'flex-start',
    backgroundColor: web.chipBg,
    borderWidth: 1,
    borderColor: web.chipBorder,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  чипТекст: { fontFamily: WEB_FONT, fontSize: 9.625, fontWeight: '500', color: web.chipText },
});
