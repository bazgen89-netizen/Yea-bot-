import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  getPosSettings,
  POS_DEFAULTS,
  resetPosSettings,
  savePosSettings,
  type PosSettings,
} from '../../db/posSettings';
import { DEFAULT_LANGUAGE, LANGUAGES, type LanguageCode } from '../../i18n/languages';
import { useLanguage } from '../../state/LanguageProvider';
import { useDatabase, useQuery } from '../../state/DatabaseProvider';
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
  const { db, refresh } = useDatabase();
  const saved = useQuery((database) => getPosSettings(database));
  const { language, setLanguage } = useLanguage();

  const [section, setSection] = useState<Section>('main');

  /** Меняем одно поле — и сразу пишем: настройка закончена нажатием. */
  const set = (patch: Partial<PosSettings>) => {
    savePosSettings(db, { ...saved, ...patch });
    // Оформление — единственное, что нельзя просто сохранить: цвета живут
    // переменными CSS, и их надо переставить сразу, а не при следующем входе.
    if (patch.theme) applyPosTheme(patch.theme);
    refresh();
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
          {section === 'hardware' ? (
            <>
              <Text style={styles.title}>Оборудование</Text>
              <Note>
                Сканер штрихкодов уже работает — касса принимает его как клавиатуру, настраивать
                нечего. Что в этом разделе у CloudShop (весы, терминал, денежный ящик), я не
                видел: пришлите снимок — сделаю.
              </Note>
            </>
          ) : null}

          {section === 'categories' ? (
            <>
              <Text style={styles.title}>Категории</Text>
              <Note>
                Категории заводятся в кабинете: «Товары и услуги» → карточка товара →
                «Категория», а касса берёт их оттуда — плитка «Категории» слева сверху.
                Здесь у CloudShop, судя по подписям в его коде, можно прятать категории
                с витрины. Пришлите снимок этого раздела — сделаю так же.
              </Note>
            </>
          ) : null}

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
              resetPosSettings(db);
              applyPosTheme(POS_DEFAULTS.theme);
              setLanguage(DEFAULT_LANGUAGE);
              refresh();
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
    width: 300,
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingVertical: 8,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: 20, minHeight: 64 },
  menuItemOn: { backgroundColor: '#EEF3FB' },
  menuIcon: { width: 26, alignItems: 'center' },
  menuLabel: { flex: 1, fontFamily: pos.font, fontSize: 19, lineHeight: 25, color: pos.text },

  body: { flex: 1, minHeight: 0 },
  bodyInner: { gap: 16, paddingBottom: 24 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 24,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },

  title: {
    fontFamily: pos.font,
    fontSize: 26,
    color: pos.text,
    marginTop: 18,
    marginBottom: 12,
  },

  // Переключатели лежат на светло-серой подложке, а не на белом.
  group: { backgroundColor: pos.bg, borderRadius: 6, paddingVertical: 8 },

  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingHorizontal: 20, height: 52 },
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
  radioLabel: { flex: 1, fontFamily: pos.font, fontSize: 17, color: pos.text },
  radioLabelOff: { color: '#AEB6BE' },
  flag: { fontSize: 17 },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 16, height: 52 },
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
    height: 52,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: pos.border,
    borderRadius: 6,
  },
  fieldInput: {
    flex: 1,
    outlineWidth: 0,
    fontFamily: pos.font,
    fontSize: 19,
    color: pos.text,
    fontVariant: ['tabular-nums'],
  },
  fieldUnit: { fontFamily: pos.font, fontSize: 15, color: pos.muted },

  note: { fontFamily: pos.font, fontSize: 14, color: pos.muted, marginTop: 8, lineHeight: 20 },

  tick: { width: 22, alignItems: 'center' },

  // Пример товара — на такой же серой подложке, как остальные блоки.
  sampleBox: { backgroundColor: pos.bg, borderRadius: 6, paddingVertical: 24, marginTop: 24 },
  sampleTitle: {
    fontFamily: pos.font,
    fontSize: 15,
    color: pos.muted,
    textAlign: 'center',
    marginBottom: 16,
  },
  sample: {
    alignSelf: 'center',
    width: 200,
    backgroundColor: '#FFFFFF',
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
  sampleBadgeLabel: { fontFamily: pos.font, fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  sampleStock: { fontFamily: pos.font, fontSize: 15, color: pos.muted },
  sampleImage: {
    height: 140,
    margin: 10,
    backgroundColor: pos.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { width: 62, height: 62, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  glyphSquare: { width: 28, height: 28, backgroundColor: '#B9BDC2' },
  glyphDiamond: {
    width: 28,
    height: 28,
    backgroundColor: '#B9BDC2',
    transform: [{ rotate: '45deg' }, { scale: 0.78 }],
  },
  sampleName: {
    fontFamily: pos.font,
    fontSize: 16,
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
    fontSize: 17,
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
  resetLabel: { fontFamily: pos.font, fontSize: 15, color: pos.red, letterSpacing: 0.4 },

  version: {
    fontFamily: pos.font,
    fontSize: 15,
    color: pos.muted,
    textAlign: 'center',
    marginTop: 8,
  },
});
