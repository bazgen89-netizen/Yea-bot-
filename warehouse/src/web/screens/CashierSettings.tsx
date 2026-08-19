import { useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../Translated';

import {
  CATEGORY_COLORS,
  colorFromName,
  listCategoryViews,
  reorderCategories,
  setCategoryBig,
  setCategoryColor,
  setCategoryHidden,
  type CategoryView,
} from '../../db/categories';
import { POS_DEFAULTS, type PosSettings } from '../../db/posSettings';
import { findByBarcode } from '../../db/products';
import { parseMarking } from '../../domain/marking';
import { DEFAULT_LANGUAGE, LANGUAGES, type LanguageCode } from '../../i18n/languages';
import { useLanguage } from '../../state/LanguageProvider';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
import { usePosSettings } from '../../state/PosSettingsProvider';
import { Scrollable } from '../Scrollable';
import { say } from '../../ui/alert';
import { WebIcon } from '../../ui/icons';
import { applyPosTheme, pos } from '../../ui/webTheme';

/**
 * «Настройки» кассы — четыре раздела слева, сами настройки справа.
 *
 * Сохраняется сразу, без кнопки «Сохранить»: это не форма с ИНН, где половина
 * набранного не имеет смысла, а переключатели, каждый из которых закончен сам
 * по себе. Нажал «не показывать нулевые остатки» — витрина изменилась.
 */

type Section = 'main' | 'hardware' | 'categories' | 'display';

const SECTIONS: { id: Section; label: string; icon: ReactNode }[] = [
  { id: 'main', label: 'Основные', icon: <WebIcon.menu size={24} color={pos.muted} /> },
  { id: 'hardware', label: 'Оборудование', icon: <WebIcon.plug size={24} color={pos.muted} /> },
  { id: 'categories', label: 'Категории', icon: <WebIcon.tag size={24} color={pos.muted} /> },
  {
    id: 'display',
    label: 'Отображение товаров',
    icon: <WebIcon.cards size={24} color={pos.muted} />,
  },
];

/** Флаги языков — ими подписаны строки в его списке. */
const FLAGS: Record<string, string> = {
  en: '🇬🇧',
  ru: '🇷🇺',
  hy: '🇦🇲',
  kk: '🇰🇿',
  ky: '🇰🇬',
  uz: '🇺🇿',
};

export function CashierSettings() {
  const { settings: saved, set: save, reset } = usePosSettings();
  const { language, setLanguage } = useLanguage();

  const [section, setSection] = useState<Section>('main');

  /**
   * Меняем одно поле — и сразу пишем: настройка закончена нажатием.
   *
   * Никакого общего `refresh()`: он поднял бы ревизию базы и заставил
   * перечитать всё приложение — от витрины до списка клиентов. Настройки
   * живут своим состоянием, и нажатие видно мгновенно.
   */
  const set = (patch: Partial<PosSettings>) => {
    save(patch);
    // Оформление — единственное, что нельзя просто сохранить: цвета живут
    // переменными CSS, и их надо переставить сразу, а не при следующем входе.
    if (patch.theme) applyPosTheme(patch.theme);
  };

  return (
    <View style={styles.root}>
      <View style={styles.menu}>
        {SECTIONS.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityState={{ selected: section === item.id }}
            onPress={() => setSection(item.id)}
            style={[styles.menuItem, section === item.id && styles.menuItemOn]}
          >
            <View style={styles.menuIcon}>{item.icon}</View>
            <Text style={styles.menuLabel}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      <Scrollable style={styles.body} contentContainerStyle={styles.bodyInner} toTop>
        <View style={styles.card}>
          {section === 'main' ? (
            <>
              {/*
                На всех трёх снимках слева подсвечены «Основные», а справа
                подряд идут Оформление, Звук, Язык, Печать, нулевые остатки и
                сортировка — то есть это **один** прокручиваемый лист, а не
                четыре раздела. Сначала я разложил их по разделам сам, и это
                была отсебятина.
              */}
              <Block title="Оформление">
                <Radio
                  label="Автоматически"
                  on={saved.theme === 'auto'}
                  onPress={() => set({ theme: 'auto' })}
                />
                <Radio
                  label="Светлое"
                  on={saved.theme === 'light'}
                  onPress={() => set({ theme: 'light' })}
                />
                <Radio
                  label="Тёмное"
                  on={saved.theme === 'dark'}
                  onPress={() => set({ theme: 'dark' })}
                />
              </Block>
              <Note>«Автоматически» — как в системе: ночью касса потемнеет сама.</Note>

              <Block title="Звук">
                <Radio
                  label="Включить"
                  on={saved.sound}
                  onPress={() => set({ sound: true })}
                />
                <Radio
                  label="Отключить"
                  on={!saved.sound}
                  onPress={() => set({ sound: false })}
                />
              </Block>
              <Note>Короткий сигнал, когда товар попадает в чек.</Note>

              <Block title="Язык интерфейса">
                {LANGUAGES.map((item) => (
                  <Radio
                    key={item.code}
                    label={item.label}
                    flag={FLAGS[item.code]}
                    on={language === item.code}
                    onPress={() => setLanguage(item.code as LanguageCode)}
                  />
                ))}
              </Block>


              <Text style={styles.title}>Печать</Text>

              <Check
                label="Печатать чек по умолчанию"
                on={saved.printByDefault}
                onPress={() => set({ printByDefault: !saved.printByDefault })}
              />

              <View style={styles.group}>
                <Radio
                  label="Принтер A4"
                  on={saved.printer === 'a4'}
                  onPress={() => set({ printer: 'a4' })}
                />
                <Radio
                  label="Принтер чеков"
                  on={saved.printer === 'receipt'}
                  onPress={() => set({ printer: 'receipt' })}
                />
              </View>

              {/* Три поля в строку — как у него, с подписью в рамке и «мм». */}
              <View style={styles.fields}>
                <Field
                  label="Ширина ленты"
                  value={saved.tapeWidth}
                  onChange={(tapeWidth) => set({ tapeWidth })}
                />
                <Field
                  label="Размер шрифта"
                  value={saved.tapeFont}
                  onChange={(tapeFont) => set({ tapeFont })}
                />
                <Field
                  label="Отступ по краям"
                  value={saved.tapeMargin}
                  onChange={(tapeMargin) => set({ tapeMargin })}
                />
              </View>
              <Note>
                Этими мерками печатается чек из журнала: ширина ленты задаёт лист, отступ —
                поля, размер шрифта — буквы.
              </Note>

              <Block title="Товары с нулевым остатком">
                <Radio
                  label="Показывать"
                  on={saved.showZeroStocks}
                  onPress={() => set({ showZeroStocks: true })}
                />
                <Radio
                  label="Не показывать"
                  on={!saved.showZeroStocks}
                  onPress={() => set({ showZeroStocks: false })}
                />
              </Block>

              <Text style={styles.title}>Сортировка товара по</Text>
              <View style={styles.group}>
                <Radio
                  label="Наименованию"
                  on={saved.sortBy === 'name'}
                  onPress={() => set({ sortBy: 'name' })}
                />
                <Radio
                  label="Цене"
                  on={saved.sortBy === 'price'}
                  onPress={() => set({ sortBy: 'price' })}
                />
                <Radio
                  label="Дате изменения"
                  on={saved.sortBy === 'changed'}
                  onPress={() => set({ sortBy: 'changed' })}
                />
              </View>

              <View style={styles.group}>
                <Radio
                  label="По возрастанию"
                  on={saved.sortAsc}
                  onPress={() => set({ sortAsc: true })}
                />
                <Radio
                  label="По убыванию"
                  on={!saved.sortAsc}
                  onPress={() => set({ sortAsc: false })}
                />
              </View>
            </>
          ) : null}

          {/* Что лежит в остальных трёх разделах, я не видел: на снимках
              открыты только «Основные». Придумывать их содержимое не стану —
              лучше пустой раздел с честной строкой, чем выдуманный. */}
          {section === 'hardware' ? <Hardware /> : null}

          {section === 'categories' ? <Categories /> : null}

          {section === 'display' ? (
            <>
              <Block title="Группировка модификаций">
                <Radio label="Да" on={saved.groupVariants} disabled onPress={() => {}} />
                <Radio label="Нет" on={!saved.groupVariants} disabled onPress={() => {}} />
              </Block>
              <Note>
                Модификаций — «тот же чай, но 100 и 300 грамм» — в справочнике пока нет:
                из CloudShop они приходят отдельными позициями, собирать нечего.
              </Note>

              <Block title="Отображение товаров">
                <Radio
                  label="Сетка"
                  on={saved.view === 'grid'}
                  onPress={() => set({ view: 'grid' })}
                />
                <Radio
                  label="Список"
                  on={saved.view === 'list'}
                  onPress={() => set({ view: 'list' })}
                />
              </Block>

              {/* Галочки, а не переключатели: это не выбор одного из двух,
                  а набор — что показывать на карточке. */}
              <Block title="Карточка товара">
                <Tick
                  label="остаток на складе"
                  on={saved.cardStock}
                  onPress={() => set({ cardStock: !saved.cardStock })}
                />
                <Tick
                  label="изображение"
                  on={saved.cardImage}
                  onPress={() => set({ cardImage: !saved.cardImage })}
                />
                <Tick
                  label="код товара"
                  on={saved.cardCode}
                  onPress={() => set({ cardCode: !saved.cardCode })}
                />
                <Tick
                  label="артикул"
                  on={saved.cardSku}
                  onPress={() => set({ cardSku: !saved.cardSku })}
                />
                <Tick
                  label="штрих-код"
                  on={saved.cardBarcode}
                  onPress={() => set({ cardBarcode: !saved.cardBarcode })}
                />
              </Block>

              <Sample settings={saved} />
            </>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Настройки по умолчанию</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              reset();
              applyPosTheme(POS_DEFAULTS.theme);
              setLanguage(DEFAULT_LANGUAGE);
              say('Готово', 'Настройки кассы вернулись к тому, какими были при установке.');
            }}
            style={styles.reset}
          >
            <Text style={styles.resetLabel}>УСТАНОВИТЬ НАСТРОЙКИ ПО УМОЛЧАНИЮ</Text>
          </Pressable>
        </View>

        <Text style={styles.version}>Версия: {VERSION}</Text>
      </Scrollable>
    </View>
  );
}

/** Своя версия, а не их 4.0.1: подписывать чужой номер было бы неправдой. */
const VERSION = '1.0.0';

/**
 * «Оборудование» — три карточки, как у него.
 *
 * Первая рассказывает про приложение для Windows, вторая собирает
 * безналичные приёмы оплаты, третья проверяет железо. Порядок и подписи — с
 * его экрана; отличие одно и важное: там, где у него подключение работает, а
 * у нас нет, кнопка честно об этом говорит, а не притворяется рабочей.
 */
function Hardware() {
  const { db } = useDatabase();

  /** Что отсканировали в поля проверки. */
  const [barcode, setBarcode] = useState('');
  const [marking, setMarking] = useState('');

  const found = useQuery(
    (database) => (barcode.trim() ? findByBarcode(database, barcode.trim()) : null),
    [barcode],
  );
  const parsed = parseMarking(marking);
  const byGtin = useQuery(
    (database) => (parsed.gtin ? findByBarcode(database, parsed.gtin.replace(/^0+/, '')) : null),
    [parsed.gtin],
  );
  void db;

  return (
    <>
      {/* Карточка первая: возможности приложения для Windows. */}
      <View style={styles.hwCard}>
        <Text style={styles.hwTitle}>Возможности Windows кассы</Text>
        <Text style={styles.hwLine}>Подключение ККТ АТОЛ</Text>
        <Text style={styles.hwLine}>Подключение весов МАССА-К и CAS</Text>
        <Text style={styles.hwLine}>
          Подключение 2D сканеров штрих-кодов для считывания кодов маркировки
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          disabled
          style={styles.hwButton}
        >
          <Text style={styles.hwButtonLabel}>СКАЧАТЬ ПРИЛОЖЕНИЕ WINDOWS КАССЫ</Text>
        </Pressable>
        <Text style={styles.hwCaption}>Windows 7 64-bit и более новые</Text>

        <Note>
          Отдельного приложения для Windows у нас пока нет: касса работает в браузере, и
          сканер она уже принимает — он печатает как клавиатура. Фискальный регистратор и
          весы требуют программы, которая говорит с ними по кабелю.
        </Note>
      </View>

      {/* Карточка вторая: безналичные. */}
      <View style={styles.hwCard}>
        <Text style={styles.hwHeading}>Безналичные</Text>

        {['Яндекс Пэй', 'Сбербанк', 'Альфа-Банк', 'Mertech QR'].map((name) => (
          <Integration key={name} name={name} />
        ))}
      </View>

      {/* Карточка третья: проверка железа. */}
      <View style={styles.hwCard}>
        <Text style={styles.hwHeading}>Диагностика оборудования</Text>

        <Text style={styles.hwSub}>Сканер штрих-кодов</Text>
        <Text style={styles.hwHint}>Отсканируйте код для проверки</Text>

        <Text style={styles.hwLabel}>Штрих-код:</Text>
        {/* Значок внутри поля — как у него: слева от места ввода. */}
        <View style={styles.hwField}>
          <WebIcon.info size={20} color={pos.bar} />
          <TextInput
            value={barcode}
            onChangeText={setBarcode}
            accessibilityLabel="Штрих-код"
            style={styles.hwInput}
          />
        </View>
        {barcode.trim() ? (
          <Text style={styles.hwResult}>
            {found ? `Нашёлся товар: ${found.name}` : 'Такого штрих-кода в справочнике нет'}
          </Text>
        ) : null}

        <Text style={styles.hwLabel}>Маркировка:</Text>
        <View style={styles.hwField}>
          <WebIcon.barcode size={20} color={pos.bar} />
          <TextInput
            value={marking}
            onChangeText={setMarking}
            accessibilityLabel="Маркировка"
            style={styles.hwInput}
          />
        </View>
        {marking.trim() ? (
          <Text style={styles.hwResult}>
            {parsed.gtin
              ? `Код товара: ${parsed.gtin}` +
                (parsed.serial ? ` · номер экземпляра: ${parsed.serial}` : '') +
                (byGtin ? ` · это «${byGtin.name}»` : '')
              : 'Это не код маркировки: в нём нет поля 01 с кодом товара'}
          </Text>
        ) : null}

        <Text style={styles.hwSub}>Весы</Text>
        <Text style={styles.hwHint}>Положите товар на весы</Text>
        <View style={[styles.hwField, styles.hwFieldOff]}>
          <WebIcon.scales size={20} color={pos.muted} />
          <Text style={styles.hwFieldOffLabel}>Весы не подключены</Text>
        </View>
        <Note>
          Весы касса в браузере не слышит: чтобы читать вес, нужен доступ к кабелю — либо
          программа для Windows, либо весы с сетевым выходом. Скажите, какие у вас стоят
          (МАССА-К, CAS, модель) — посмотрю, что из этого можно сделать.
        </Note>
      </View>
    </>
  );
}

/** Плашка «Требуется настройка» — по одной на каждый приём оплаты. */
function Integration({ name }: { name: string }) {
  return (
    <>
      <Text style={styles.hwSub}>Интеграция {name}</Text>
      <View style={styles.warn}>
        <View style={styles.warnHead}>
          <Text style={styles.warnGlyph}>⚠</Text>
          <Text style={styles.warnTitle}>Требуется настройка</Text>
        </View>
        <Text style={styles.warnText}>
          Для приема платежей через {name} необходимо создать интеграцию.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            say(
              `Интеграция ${name}`,
              'Подключение делается не в программе: сперва договор и ключи от ' +
                'самой службы. Пришлите ключи — заведу приём оплаты, и кнопка ' +
                'станет рабочей.',
            )
          }
          style={styles.warnButton}
        >
          <Text style={styles.warnButtonLabel}>⊕ СОЗДАТЬ ИНТЕГРАЦИЮ</Text>
        </Pressable>
      </View>
    </>
  );
}

/**
 * «Категории» — как они выглядят на витрине.
 *
 * Раздел ничего не заводит и не удаляет: категории приходят из справочника, а
 * здесь им назначают цвет, порядок, размер плитки и скрывают с витрины. То же
 * и у него — и подписи те же, из его словаря: «Показывать товары из скрытых
 * категорий», «Скрыть категорию», «Цвет», «Размер».
 */
function Categories() {
  const { db, refresh } = useDatabase();
  const { settings, set } = usePosSettings();
  const rows = useQuery((database) => listCategoryViews(database));

  // Какой строке открыта палитра. Одна на весь список: две открытые сразу —
  // это уже не выбор цвета, а рябь.
  const [palette, setPalette] = useState<number | null>(null);

  /** Перетаскивание: какую строку держат и куда ведут. */
  const [drag, setDrag] = useState<{ id: number; from: number; to: number } | null>(null);
  const startY = useRef(0);

  const order = drag
    ? move(rows.map((row) => row.id as number), drag.from, drag.to)
    : rows.map((row) => row.id as number);
  const shown = order
    .map((id) => rows.find((row) => (row.id as number) === id))
    .filter((row): row is CategoryView => Boolean(row));

  return (
    <>
      <Text style={styles.title}>Категории</Text>

      <View style={styles.hiddenBand}>
        <View style={styles.segment}>
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: settings.showHiddenCategories }}
            onPress={() => set({ showHiddenCategories: true })}
            style={[styles.segmentPart, settings.showHiddenCategories && styles.segmentOn]}
          >
            <Text
              style={[
                styles.segmentLabel,
                settings.showHiddenCategories && styles.segmentLabelOn,
              ]}
            >
              Да
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: !settings.showHiddenCategories }}
            onPress={() => set({ showHiddenCategories: false })}
            style={[styles.segmentPart, !settings.showHiddenCategories && styles.segmentOn]}
          >
            <Text
              style={[
                styles.segmentLabel,
                !settings.showHiddenCategories && styles.segmentLabelOn,
              ]}
            >
              Нет
            </Text>
          </Pressable>
        </View>
        <Text style={styles.hiddenLabel}>Показывать товары из скрытых категорий</Text>
      </View>

      {shown.map((row, index) => (
        <View key={row.id}>
          <View
            style={[
              styles.catRow,
              { backgroundColor: row.color ?? colorFromName(row.name) },
              row.hidden && styles.catRowOff,
              drag?.id === row.id && styles.catRowDrag,
            ]}
          >
            {/* Рукоятка: строку держат за неё и ведут вверх или вниз. */}
            <View
              accessible
              accessibilityLabel={`Переставить категорию «${row.name}»`}
              style={styles.catHandle}
              onStartShouldSetResponder={() => true}
              onResponderGrant={(event) => {
                startY.current = event.nativeEvent.pageY;
                setDrag({ id: row.id as number, from: index, to: index });
              }}
              onResponderMove={(event) => {
                // Через сколько строк увели рукоятку от места, где её взяли.
                const shift = Math.round((event.nativeEvent.pageY - startY.current) / ROW_STEP);
                setDrag((current) =>
                  current
                    ? { ...current, to: clamp(current.from + shift, 0, rows.length - 1) }
                    : current,
                );
              }}
              onResponderRelease={() => {
                if (drag) reorderCategories(db, order);
                setDrag(null);
                refresh();
              }}
            >
              <WebIcon.drag size={20} color={pos.muted} />
            </View>

            <Text style={styles.catName}>
              {row.name} - {row.sort}
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={row.hidden ? 'Показать категорию' : 'Скрыть категорию'}
              onPress={() => {
                setCategoryHidden(db, row.id, !row.hidden);
                refresh();
              }}
              style={styles.catButton}
            >
              {row.hidden ? (
                <WebIcon.eyeOff size={22} color={pos.text} />
              ) : (
                <WebIcon.eye size={22} color={pos.text} />
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Цвет"
              onPress={() => setPalette((open) => (open === row.id ? null : (row.id as number)))}
              style={styles.catButton}
            >
              <WebIcon.fill size={22} color={pos.text} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Размер"
              onPress={() => {
                setCategoryBig(db, row.id, !row.big);
                refresh();
              }}
              style={styles.catButton}
            >
              {row.big ? (
                <WebIcon.collapse size={22} color={pos.text} />
              ) : (
                <WebIcon.expand size={22} color={pos.text} />
              )}
            </Pressable>
          </View>

          {palette === row.id ? (
            <View style={styles.paletteBox}>
              <Text style={styles.paletteTitle}>Цвет</Text>
              <View style={styles.paletteRow}>
                {CATEGORY_COLORS.map((color) => (
                  <Pressable
                    key={color}
                    accessibilityRole="button"
                    accessibilityLabel={`Цвет ${color}`}
                    onPress={() => {
                      setCategoryColor(db, row.id, color);
                      setPalette(null);
                      refresh();
                    }}
                    style={[styles.paletteItem, { backgroundColor: color }]}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ))}

      {rows.length === 0 ? (
        <Note>Категорий пока нет — их заводят в карточке товара, в кабинете.</Note>
      ) : (
        <Note>
          Номер справа от названия — порядок на витрине: строку держат за рукоятку слева и
          ведут вверх или вниз. Глаз убирает категорию с витрины, ведро красит плитку,
          стрелки делают её вдвое шире.
        </Note>
      )}
    </>
  );
}

/** Высота строки с промежутком — по ней считается, через сколько строк ведут. */
const ROW_STEP = 56;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Переставить элемент списка с места на место. */
function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.group}>{children}</View>
    </>
  );
}

function Radio({
  label,
  flag,
  on,
  disabled,
  onPress,
}: {
  label: string;
  flag?: string;
  on: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled }}
      onPress={disabled ? undefined : onPress}
      style={styles.radioRow}
    >
      <View style={[styles.radio, on && styles.radioOn, disabled && styles.radioOff]}>
        {on ? <View style={styles.radioDot} /> : null}
      </View>
      <Text style={[styles.radioLabel, disabled && styles.radioLabelOff]}>{label}</Text>
      {flag ? <Text style={styles.flag}>{flag}</Text> : null}
    </Pressable>
  );
}

function Check({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={styles.checkRow}
    >
      <View style={[styles.check, on && styles.checkOn]}>
        {on ? <WebIcon.done size={16} color="#FFFFFF" /> : null}
      </View>
      <Text style={styles.radioLabel}>{label}</Text>
    </Pressable>
  );
}

/** Поле с подписью в рамке и мерой справа — так у него в «Оборудовании». */
function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldRow}>
        <TextInput
          value={text}
          onChangeText={(next) => {
            const digits = next.replace(/\D/g, '').slice(0, 3);
            setText(digits);
            const number = Number(digits);
            if (number > 0) onChange(number);
          }}
          keyboardType="number-pad"
          accessibilityLabel={label}
          style={styles.fieldInput}
        />
        <Text style={styles.fieldUnit}>мм</Text>
      </View>
    </View>
  );
}

/** Строка-галочка: отмечено — серая птичка слева, нет — пусто. */
function Tick({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.radioRow}
    >
      <View style={styles.tick}>
        {on ? <WebIcon.done size={20} color={pos.muted} /> : null}
      </View>
      <Text style={styles.radioLabel}>{label}</Text>
    </Pressable>
  );
}

/**
 * «Пример товара» — та же плитка, что и на витрине, только с выдуманным
 * товаром.
 *
 * Она здесь не для красоты: отметки «что показывать на карточке» иначе
 * пришлось бы проверять, уходя в кассу и возвращаясь. А так видно сразу.
 */
function Sample({ settings }: { settings: PosSettings }) {
  return (
    <View style={styles.sampleBox}>
      <Text style={styles.sampleTitle}>Пример товара</Text>

      <View style={styles.sample}>
        <View style={styles.sampleHead}>
          <View style={styles.sampleBadge}>
            <Text style={styles.sampleBadgeLabel}>5%</Text>
          </View>
          {settings.cardStock ? <Text style={styles.sampleStock}>84 шт</Text> : null}
        </View>

        {settings.cardImage ? (
          <View style={styles.sampleImage}>
            <View style={styles.glyph}>
              <View style={styles.glyphSquare} />
              <View style={styles.glyphDiamond} />
              <View style={styles.glyphSquare} />
              <View style={styles.glyphSquare} />
            </View>
          </View>
        ) : null}

        <Text style={styles.sampleName}>Название товара</Text>
        {settings.cardCode ? <Text style={styles.sampleSmall}>00592</Text> : null}
        {settings.cardSku ? <Text style={styles.sampleSmall}>70316re2014</Text> : null}
        {settings.cardBarcode ? <Text style={styles.sampleSmall}>4600000000012</Text> : null}

        <View style={styles.samplePrice}>
          <Text style={styles.samplePriceLabel}>1 987,00 руб</Text>
        </View>
      </View>
    </View>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <Text style={styles.note}>{children}</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: pos.bg, padding: 16, gap: 16 },

  // Слева — белая карточка с четырьмя разделами.
  menu: {
    width: 260,
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: 'flex-start',
    backgroundColor: pos.tile,
    borderRadius: 8,
    paddingVertical: 8,
    shadowColor: pos.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, minHeight: 52 },
  menuItemOn: { backgroundColor: pos.select },
  menuIcon: { width: 26, alignItems: 'center' },
  menuLabel: { flex: 1, fontFamily: pos.font, fontSize: 15, lineHeight: 21, color: pos.text },

  body: { flex: 1, minHeight: 0 },
  bodyInner: { gap: 16, paddingBottom: 24, maxWidth: 650 },
  card: {
    backgroundColor: pos.tile,
    borderRadius: 8,
    padding: 24,
    shadowColor: pos.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },

  title: {
    fontFamily: pos.font,
    fontSize: 18,
    color: pos.text,
    marginTop: 18,
    marginBottom: 12,
  },

  // Переключатели лежат на светло-серой подложке, а не на белом.
  group: { backgroundColor: pos.bg, borderRadius: 6, paddingVertical: 8 },

  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, height: 44 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: pos.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: pos.muted },
  radioOff: { borderColor: '#C7CDD4' },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: pos.muted },
  radioLabel: { flex: 1, fontFamily: pos.font, fontSize: 14, color: pos.text },
  radioLabelOff: { color: '#AEB6BE' },
  flag: { fontSize: 14 },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 16, height: 44 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 3,
    borderWidth: 2,
    borderColor: pos.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: pos.bar, borderColor: pos.bar },

  fields: { flexDirection: 'row', gap: 16, marginTop: 16 },
  field: { flex: 1 },
  fieldLabel: { fontFamily: pos.font, fontSize: 13, color: pos.muted, marginBottom: 4 },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 6,
  },
  fieldInput: {
    flex: 1,
    outlineWidth: 0,
    fontFamily: pos.font,
    fontSize: 15,
    color: pos.text,
    fontVariant: ['tabular-nums'],
  },
  fieldUnit: { fontFamily: pos.font, fontSize: 13, color: pos.muted },

  note: { fontFamily: pos.font, fontSize: 13, color: pos.muted, marginTop: 8, lineHeight: 20 },

  // Раздел «Оборудование»: три карточки, у каждой своя рамка.
  hwCard: {
    backgroundColor: pos.tile,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 6,
    padding: 24,
    marginBottom: 16,
  },
  hwTitle: {
    fontFamily: pos.font,
    fontSize: 18,
    fontWeight: '700',
    color: pos.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  hwHeading: { fontFamily: pos.font, fontSize: 22, color: pos.text, marginBottom: 16 },
  hwLine: { fontFamily: pos.font, fontSize: 15, color: pos.text, marginBottom: 10 },
  hwButton: {
    alignSelf: 'center',
    marginTop: 12,
    paddingHorizontal: 24,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: pos.bar,
    borderRadius: 4,
    // Кнопка видна, но не нажимается: приложения для Windows у нас нет.
    opacity: 0.5,
  },
  hwButtonLabel: { fontFamily: pos.font, fontSize: 14, color: '#FFFFFF', letterSpacing: 0.4 },
  hwCaption: {
    fontFamily: pos.font,
    fontSize: 13,
    color: pos.muted,
    textAlign: 'center',
    marginTop: 8,
  },
  hwSub: { fontFamily: pos.font, fontSize: 17, color: pos.text, marginTop: 20, marginBottom: 4 },
  hwHint: { fontFamily: pos.font, fontSize: 14, color: pos.muted, marginBottom: 12 },
  hwLabel: { fontFamily: pos.font, fontSize: 14, color: pos.text, marginTop: 12, marginBottom: 6 },
  hwField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 46,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: pos.bar,
    borderRadius: 4,
    fontFamily: pos.font,
    fontSize: 15,
    color: pos.text,
    outlineWidth: 0,
    justifyContent: 'center',
  },
  hwInput: {
    flex: 1,
    fontFamily: pos.font,
    fontSize: 15,
    color: pos.text,
    outlineWidth: 0,
  },
  hwFieldOff: { borderColor: pos.border },
  hwFieldOffLabel: { fontFamily: pos.font, fontSize: 15, color: pos.muted },
  hwResult: { fontFamily: pos.font, fontSize: 13, color: pos.muted, marginTop: 6 },

  // Жёлтая плашка «Требуется настройка».
  warn: { backgroundColor: '#FDF3E3', borderRadius: 4, padding: 16, marginBottom: 8 },
  warnHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  warnGlyph: { fontSize: 16, color: '#ED6C02' },
  warnTitle: { fontFamily: pos.font, fontSize: 15, color: '#8A5A00' },
  warnText: { fontFamily: pos.font, fontSize: 14, color: '#6B4E16', lineHeight: 20 },
  warnButton: { alignSelf: 'flex-start', marginTop: 12, paddingVertical: 6 },
  warnButtonLabel: { fontFamily: pos.font, fontSize: 14, color: pos.bar, letterSpacing: 0.3 },

  // Раздел «Категории».
  //
  // Полоса с переключателем «Да / Нет» — серая, подпись синяя: у него она
  // выглядит ссылкой, хотя ею не является, и это тоже часть облика.
  hiddenBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: pos.bg,
    borderRadius: 6,
    padding: 12,
    marginBottom: 16,
  },
  segment: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: pos.bar,
    borderRadius: 4,
    overflow: 'hidden',
  },
  segmentPart: { paddingHorizontal: 18, height: 34, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: pos.select },
  segmentLabel: { fontFamily: pos.font, fontSize: 14, color: pos.text },
  segmentLabelOn: { color: pos.bar },
  hiddenLabel: { flex: 1, fontFamily: pos.font, fontSize: 14, color: pos.bar },

  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    marginBottom: 8,
    borderRadius: 4,
    paddingHorizontal: 12,
    gap: 6,
  },
  // Скрытая категория бледнеет — как строка, которой на витрине нет.
  catRowOff: { opacity: 0.45 },
  catRowDrag: { opacity: 0.85, transform: [{ scale: 0.995 }] },
  catHandle: { width: 28, alignItems: 'center', justifyContent: 'center' },
  catName: { flex: 1, fontFamily: pos.font, fontSize: 15, color: '#1F2328' },
  catButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  paletteBox: {
    backgroundColor: pos.tile,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 6,
    padding: 12,
    marginBottom: 8,
  },
  paletteTitle: { fontFamily: pos.font, fontSize: 13, color: pos.muted, marginBottom: 8 },
  paletteRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  paletteItem: {
    width: 34,
    height: 34,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: pos.border,
  },

  tick: { width: 22, alignItems: 'center' },

  // Пример товара — на такой же серой подложке, как остальные блоки.
  sampleBox: { backgroundColor: pos.bg, borderRadius: 6, paddingVertical: 24, marginTop: 24 },
  sampleTitle: {
    fontFamily: pos.font,
    fontSize: 14,
    color: pos.muted,
    textAlign: 'center',
    marginBottom: 16,
  },
  sample: {
    alignSelf: 'center',
    width: 200,
    backgroundColor: pos.tile,
    paddingBottom: 10,
  },
  sampleHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 10,
    minHeight: 34,
  },
  // Оранжевая метка скидки — у него в левом верхнем углу плитки.
  sampleBadge: {
    backgroundColor: pos.accent,
    borderRadius: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  sampleBadgeLabel: { fontFamily: pos.font, fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  sampleStock: { fontFamily: pos.font, fontSize: 14, color: pos.muted },
  sampleImage: {
    height: 140,
    margin: 10,
    backgroundColor: pos.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { width: 62, height: 62, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  glyphSquare: { width: 28, height: 28, backgroundColor: pos.faint },
  glyphDiamond: {
    width: 28,
    height: 28,
    backgroundColor: pos.faint,
    transform: [{ rotate: '45deg' }, { scale: 0.78 }],
  },
  sampleName: {
    fontFamily: pos.font,
    fontSize: 15,
    color: pos.text,
    textAlign: 'center',
    paddingHorizontal: 10,
  },
  sampleSmall: {
    fontFamily: pos.font,
    fontSize: 13,
    color: pos.muted,
    textAlign: 'center',
    marginTop: 2,
  },
  samplePrice: {
    marginTop: 10,
    paddingTop: 10,
    marginHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: pos.border,
  },
  samplePriceLabel: {
    fontFamily: pos.font,
    fontSize: 15,
    fontWeight: '700',
    color: pos.text,
    textAlign: 'center',
  },

  reset: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: 20,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: pos.red,
    borderRadius: 4,
  },
  resetLabel: { fontFamily: pos.font, fontSize: 13, color: pos.red, letterSpacing: 0.4 },

  version: {
    fontFamily: pos.font,
    fontSize: 14,
    color: pos.muted,
    textAlign: 'center',
    marginTop: 8,
  },
});
