import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Text, TextInput } from './Translated';
import { applyPrices, setCategoryFor, setFieldsFor, type BulkFields } from '../db/bulk';
import { listCategoryViews } from '../db/categories';
import { formatMoneyWeb, parseMoney } from '../domain/money';
import { repricedTo } from '../domain/pricing';
import { SCALE_TITLE, scaleFile, scaleSelect, type ScaleModel } from '../domain/scales';
import { saveFile } from '../ui/download';
import type { Id } from '../domain/types';
import type { ProductWithStock } from '../domain/types';
import { useDatabase, useQuery } from '../state/DatabaseProvider';
import { say } from '../ui/alert';
import { web, WEB_FONT } from '../ui/webTheme';

/**
 * Окна из меню «Действия»: цены и категории сразу для списка товаров.
 *
 * Оба показывают, к скольким позициям применятся, и оба пересчитывают на
 * глазах: «плюс 10%» видно на первом товаре списка до того, как нажата
 * кнопка. Действие над шестьюстами карточками должно быть предсказуемым.
 */

export function PricesDialog({
  visible,
  products,
  onClose,
}: {
  visible: boolean;
  products: ProductWithStock[];
  onClose: () => void;
}) {
  const { db, refresh } = useDatabase();

  const [mode, setMode] = useState<'set' | 'percent' | 'amount'>('percent');
  const [value, setValue] = useState('');

  const number = parseValue(mode, value);
  const sample = products[0];
  const preview =
    sample && number !== null
      ? repricedTo(sample.sale_price, { mode, value: number })
      : sample?.sale_price;

  return (
    <Sheet visible={visible} title="Цены и скидки" onClose={onClose}>
      <Text style={styles.note}>Изменится {products.length} поз.</Text>

      <View style={styles.tabs}>
        <Tab label="Задать цену" on={mode === 'set'} onPress={() => setMode('set')} />
        <Tab label="Проценты" on={mode === 'percent'} onPress={() => setMode('percent')} />
        <Tab label="Рубли" on={mode === 'amount'} onPress={() => setMode('amount')} />
      </View>

      <Text style={styles.label}>
        {mode === 'set' ? 'Новая цена' : mode === 'percent' ? 'На сколько процентов' : 'На сколько рублей'}
      </Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder={mode === 'percent' ? '10 или -10' : '100 или -100'}
        style={styles.input}
      />

      {sample ? (
        <Text style={styles.note}>
          Например, «{sample.name}»: {formatMoneyWeb(sample.sale_price)} →{' '}
          {formatMoneyWeb(preview ?? sample.sale_price)}
        </Text>
      ) : null}

      <View style={styles.buttons}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.plain}>
          <Text style={styles.plainLabel}>Отмена</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={number === null}
          onPress={() => {
            if (number === null) return;

            applyPrices(
              db,
              products.map((product) => ({
                id: product.id,
                price: repricedTo(product.sale_price, { mode, value: number }),
              })),
            );
            refresh();
            onClose();
            say('Готово', `Цены изменились у ${products.length} поз.`);
          }}
          style={[styles.green, number === null && styles.greenOff]}
        >
          <Text style={styles.greenLabel}>Применить</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

export function CategoryDialog({
  visible,
  products,
  onClose,
}: {
  visible: boolean;
  products: ProductWithStock[];
  onClose: () => void;
}) {
  const { db, refresh } = useDatabase();
  const categories = useQuery((database) => listCategoryViews(database));
  const [picked, setPicked] = useState<Id | null>(null);

  return (
    <Sheet visible={visible} title="Категории и группы" onClose={onClose}>
      <Text style={styles.note}>Перенесётся {products.length} поз.</Text>

      <View style={styles.list}>
        {categories.map((category) => (
          <Pressable
            key={category.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: picked === category.id }}
            onPress={() => setPicked(category.id)}
            style={[styles.row, picked === category.id && styles.rowOn]}
          >
            <Text style={styles.rowLabel}>{category.name}</Text>
            <Text style={styles.rowCount}>{category.count} поз.</Text>
          </Pressable>
        ))}

        {categories.length === 0 ? (
          <Text style={styles.note}>Категорий пока нет — их заводят в карточке товара.</Text>
        ) : null}
      </View>

      <View style={styles.buttons}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.plain}>
          <Text style={styles.plainLabel}>Отмена</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={picked === null}
          onPress={() => {
            if (picked === null) return;

            setCategoryFor(
              db,
              products.map((product) => product.id),
              picked,
            );
            refresh();
            onClose();
            say('Готово', `${products.length} поз. перенесены в категорию.`);
          }}
          style={[styles.green, picked === null && styles.greenOff]}
        >
          <Text style={styles.greenLabel}>Перенести</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

/**
 * «Другое» — то, что в карточке лежит по одному полю, а меняется полкой.
 *
 * У него за этим пунктом сроки годности, НДС и признаки товара. Пустое
 * поле здесь значит «не трогать»: окно правит только заполненное, иначе
 * одно нажатие обнулило бы НДС у шестисот позиций.
 */
export function OtherDialog({
  visible,
  products,
  onClose,
}: {
  visible: boolean;
  products: ProductWithStock[];
  onClose: () => void;
}) {
  const { db, refresh } = useDatabase();

  const [expires, setExpires] = useState('');
  const [vat, setVat] = useState('');
  const [weighted, setWeighted] = useState<boolean | null>(null);
  const [excisable, setExcisable] = useState<boolean | null>(null);
  const [freePrice, setFreePrice] = useState<boolean | null>(null);

  const fields: BulkFields = {};
  if (expires.trim()) fields.expiresAt = expires.trim();
  const vatBp = vatFrom(vat);
  if (vatBp !== undefined) fields.vatBp = vatBp;
  if (weighted !== null) fields.weighted = weighted;
  if (excisable !== null) fields.excisable = excisable;
  if (freePrice !== null) fields.freePrice = freePrice;

  const nothing = Object.keys(fields).length === 0;

  return (
    <Sheet visible={visible} title="Другое" onClose={onClose}>
      <Text style={styles.note}>Изменится {products.length} поз.</Text>

      <Text style={styles.label}>Срок годности</Text>
      <TextInput
        value={expires}
        onChangeText={setExpires}
        placeholder="2026-12-31 — пусто, чтобы не трогать"
        placeholderTextColor={web.textMuted}
        style={styles.input}
      />

      <Text style={styles.label}>НДС</Text>
      <TextInput
        value={vat}
        onChangeText={setVat}
        placeholder="20, 10, 0 или «без» — пусто, чтобы не трогать"
        placeholderTextColor={web.textMuted}
        style={styles.input}
      />

      <Text style={styles.label}>Признаки</Text>
      <Triple label="Весовой товар" value={weighted} onChange={setWeighted} />
      <Triple label="Подакцизный" value={excisable} onChange={setExcisable} />
      <Triple label="Свободная цена" value={freePrice} onChange={setFreePrice} />

      <View style={styles.buttons}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.plain}>
          <Text style={styles.plainLabel}>Отмена</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={nothing}
          onPress={() => {
            if (nothing) return;

            setFieldsFor(
              db,
              products.map((product) => product.id),
              fields,
            );
            refresh();
            onClose();
            say('Готово', `Поля изменились у ${products.length} поз.`);
          }}
          style={[styles.green, nothing && styles.greenOff]}
        >
          <Text style={styles.greenLabel}>Применить</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

/**
 * «Файл для весов».
 *
 * В списке у меня стояло «нужны марка и модель весов» — и это была
 * отговорка: кабинет ничего не выясняет, он даёт выбрать модель из трёх и
 * отдаёт таблицу с нужными колонками. Наборы колонок лежат в их же
 * собранной странице, разбор — в `domain/scales.ts`.
 */
export function ScalesDialog({
  visible,
  products,
  onClose,
}: {
  visible: boolean;
  products: ProductWithStock[];
  onClose: () => void;
}) {
  const [model, setModel] = useState<ScaleModel>('massak');
  const [weightedOnly, setWeightedOnly] = useState(false);
  const [pluOnly, setPluOnly] = useState(false);

  const forScales = products.map((product) => ({
    name: product.name,
    code: product.code ?? null,
    plu: product.plu_code ?? null,
    price: product.sale_price,
    weighted: product.weighted === 1,
    expiresAt: product.expires_at ?? null,
  }));
  const count = scaleSelect(forScales, { weightedOnly, pluOnly }).length;

  return (
    <Sheet visible={visible} title="Выгрузка файла для весов" onClose={onClose}>
      <Text style={styles.label}>Выберите вашу модель весов</Text>
      <View style={styles.list}>
        {(['massak', 'mertech', 'rongta'] as ScaleModel[]).map((one) => (
          <Pressable
            key={one}
            accessibilityRole="radio"
            accessibilityState={{ selected: model === one }}
            onPress={() => setModel(one)}
            style={[styles.row, model === one && styles.rowOn]}
          >
            <Text style={styles.rowLabel}>{SCALE_TITLE[one]}</Text>
            <Text style={styles.rowCount}>{one === 'rongta' ? 'scale.txp' : 'scale.csv'}</Text>
          </Pressable>
        ))}
      </View>

      {/* Здесь выбор из двух, а не из трёх: это отбор перед выгрузкой, а
          не правка поля, и «не трогать» тут значило бы ровно то же, что
          «все». */}
      <View style={styles.triple}>
        <Text style={styles.tripleLabel}>Какие товары выгружать</Text>
        <View style={styles.tabs}>
          <Tab label="Все" on={!weightedOnly} onPress={() => setWeightedOnly(false)} />
          <Tab
            label="Только весовые"
            on={weightedOnly}
            onPress={() => setWeightedOnly(true)}
          />
        </View>
      </View>

      <View style={styles.triple}>
        <Text style={styles.tripleLabel}>Товары без PLU</Text>
        <View style={styles.tabs}>
          <Tab label="Выгружать" on={!pluOnly} onPress={() => setPluOnly(false)} />
          <Tab label="Пропустить" on={pluOnly} onPress={() => setPluOnly(true)} />
        </View>
      </View>

      <Text style={styles.note}>
        В файл попадёт {count} поз. из {products.length}.
      </Text>

      <View style={styles.buttons}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.plain}>
          <Text style={styles.plainLabel}>Отмена</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={count === 0}
          onPress={() => {
            const file = scaleFile(model, forScales, { weightedOnly, pluOnly });
            void saveFile(file.name, file.text, file.mime);
            onClose();
          }}
          style={[styles.green, count === 0 && styles.greenOff]}
        >
          <Text style={styles.greenLabel}>Скачать файл</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

/**
 * Переключатель на три положения: «да», «нет» и «не трогать».
 *
 * Обычная галочка здесь врёт: снятая означала бы «сделать всё штучным», а
 * человек просто не собирался трогать признак.
 */
function Triple({
  label,
  value,
  onChange,
  yes = 'Да',
  no = 'Нет',
}: {
  label: string;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
  yes?: string;
  no?: string;
}) {
  return (
    <View style={styles.triple}>
      <Text style={styles.tripleLabel}>{label}</Text>
      <View style={styles.tabs}>
        <Tab label="Не трогать" on={value === null} onPress={() => onChange(null)} />
        <Tab label={yes} on={value === true} onPress={() => onChange(true)} />
        <Tab label={no} on={value === false} onPress={() => onChange(false)} />
      </View>
    </View>
  );
}

/**
 * «20» → 2000, «без» → пусто в базе, пустая строка → не трогать вовсе.
 *
 * Возвращает `undefined` именно для «не трогать»: `null` здесь занят —
 * это «НДС не задан».
 */
function vatFrom(input: string): number | null | undefined {
  const text = input.trim().toLowerCase();
  if (!text) return undefined;
  if (text.startsWith('без') || text === '-') return null;

  const percent = Number(text.replace(',', '.').replace('%', ''));
  if (!Number.isFinite(percent) || percent < 0) return undefined;

  return Math.round(percent * 100);
}

/** Разбор введённого: проценты и рубли — со знаком, цена — без. */
function parseValue(mode: 'set' | 'percent' | 'amount', input: string): number | null {
  const text = input.trim().replace(',', '.');
  if (!text) return null;

  if (mode === 'percent') {
    const percent = Number(text);
    if (!Number.isFinite(percent)) return null;
    // Проценты — в сотых долях процента, как и везде в расчётах.
    return Math.round(percent * 100);
  }

  const negative = text.startsWith('-');
  const money = parseMoney(negative ? text.slice(1) : text);
  if (money === null) return null;

  return negative ? -money : money;
}

function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.shade}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть окно"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function Tab({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.tab, on && styles.tabOn]}
    >
      <Text style={[styles.tabLabel, on && styles.tabLabelOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shade: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    width: 460,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    padding: 24,
    gap: 12,
  },
  title: { fontFamily: WEB_FONT, fontSize: 20, color: web.text },
  note: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },
  label: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },

  tabs: { flexDirection: 'row', gap: 8 },
  tab: {
    paddingHorizontal: 14,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D4D4D5',
    borderRadius: 4,
  },
  tabOn: { borderColor: '#2185D0', backgroundColor: '#EAF3FC' },
  tabLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  tabLabelOn: { color: '#2185D0' },

  input: {
    height: 38,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#D4D4D5',
    borderRadius: 4,
    fontFamily: WEB_FONT,
    fontSize: 15,
    color: web.text,
    outlineWidth: 0,
  },

  list: { maxHeight: 320, gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 4,
  },
  rowOn: { backgroundColor: '#EAF3FC' },
  rowLabel: { flex: 1, fontFamily: WEB_FONT, fontSize: 15, color: web.text },
  rowCount: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },

  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  plain: {
    paddingHorizontal: 18,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D4D4D5',
    borderRadius: 4,
  },
  plainLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  green: {
    paddingHorizontal: 18,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: '#21BA45',
  },
  greenOff: { opacity: 0.5 },
  greenLabel: { fontFamily: WEB_FONT, fontSize: 14, color: '#FFFFFF' },

  triple: { gap: 6, marginTop: 12 },
  tripleLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
});
