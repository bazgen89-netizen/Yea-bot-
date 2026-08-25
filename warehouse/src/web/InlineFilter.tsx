import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, ScrollView } from 'react-native';
import { Text, TextInput } from './Translated';

import { WebIcon } from '../ui/icons';
import { web, WEB_FONT } from '../ui/webTheme';

/**
 * Строка отбора над журналом — его `inline-filter`.
 *
 * Устроена она у него не так, как я сделал сперва. У меня в строке стояли
 * несколько готовых полей, а за кнопкой «Фильтр» открывался ящик со всеми
 * полями сразу. У него наоборот:
 *
 *   - в строке стоят только те поля, что заведены (`show`) или уже с
 *     значением;
 *   - крестик поле **убирает из строки**, а не просто чистит значение
 *     (`t.delete = ... values.filter(...)`);
 *   - кнопка «Фильтр» — это список **оставшихся** полей, и выбор из него
 *     добавляет поле в строку и сразу открывает его
 *     (`dropdown.filter()`, `dropdown.select`);
 *   - поле с `required` крестика не имеет вовсе — его правило
 *     `.inline-filter-item.required a.label{display:none!important}`.
 *
 * Отсюда и размеры: рамка `#f2f2f2`, скругление 3, высота поля 57, подпись
 * на `#fafafa` кеглем 12 цветом `#666` строчными буквами, значение кеглем
 * 12 в тридцати пикселях высоты, крестик 12 цветом `#999`.
 */

export type FilterValue = string | string[] | undefined;

export interface BoxOption {
  value: string;
  label: string;
}

export interface InlineField {
  /** Ключ значения в наборе отбора. У даты — `${key}From` и `${key}To`. */
  key: string;
  /** Подпись поля. Выводится строчными: у них так делает CSS. */
  label: string;
  kind: 'text' | 'date' | 'select';
  /** Что предлагать для `select`. */
  options?: BoxOption[];
  /** Стоит в строке с самого начала. */
  show?: boolean;
  /** Снять нельзя: крестика нет. */
  required?: boolean;
  /** Подсказка в пустом поле. */
  placeholder?: string;
  width?: number;
}

export function InlineFilter({
  fields,
  values,
  onChange,
}: {
  fields: InlineField[];
  values: Record<string, FilterValue>;
  onChange: (key: string, value: FilterValue) => void;
}) {
  const filled = (field: InlineField) =>
    field.kind === 'date'
      ? values[`${field.key}From`] != null || values[`${field.key}To`] != null
      : values[field.key] != null && values[field.key] !== '';

  const [shown, setShown] = useState<string[]>(() =>
    fields.filter((field) => field.show || filled(field)).map((field) => field.key),
  );
  /** Только что добавленное поле открывается само — как у него. */
  const [opened, setOpened] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const hidden = fields
    .filter((field) => !shown.includes(field.key))
    .sort((a, b) => a.label.localeCompare(b.label, 'ru'));

  const remove = (field: InlineField) => {
    setShown((current) => current.filter((key) => key !== field.key));
    if (field.kind === 'date') {
      onChange(`${field.key}From`, undefined);
      onChange(`${field.key}To`, undefined);
      return;
    }
    onChange(field.key, undefined);
  };

  return (
    <View style={styles.row}>
      {shown.map((key) => {
        const field = fields.find((item) => item.key === key);
        if (!field) return null;

        return (
          <Chip
            key={key}
            field={field}
            values={values}
            onChange={onChange}
            onRemove={() => remove(field)}
            autoOpen={opened === key}
            onOpened={() => setOpened(null)}
          />
        );
      })}

      {hidden.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Фильтр"
          onPress={(event) => {
            const target = event.currentTarget as unknown as {
              measureInWindow?: (
                callback: (x: number, y: number, width: number, height: number) => void,
              ) => void;
            };
            target.measureInWindow?.((x, y, _width, height) => setMenu({ x, y: y + height + 5 }));
          }}
          style={styles.filterButton}
        >
          <WebIcon.funnel color="#666666" size={15} />
          <Text style={styles.filterLabel}>Фильтр</Text>
        </Pressable>
      ) : null}

      <Modal visible={menu !== null} transparent animationType="none" onRequestClose={() => setMenu(null)}>
        <View style={styles.backdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть список полей"
            style={StyleSheet.absoluteFill}
            onPress={() => setMenu(null)}
          />

          <View style={[styles.menu, { left: menu?.x ?? 0, top: menu?.y ?? 0 }]}>
            {hidden.map((field) => (
              <Pressable
                key={field.key}
                accessibilityRole="button"
                onPress={() => {
                  setShown((current) => [...current, field.key]);
                  setOpened(field.key);
                  setMenu(null);
                }}
                style={(state) => [styles.item, isHovered(state) && styles.itemHover]}
              >
                <Text style={styles.itemText}>{field.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Одно поле строки отбора: подпись, значение и крестик. */
function Chip({
  field,
  values,
  onChange,
  onRemove,
  autoOpen,
  onOpened,
}: {
  field: InlineField;
  values: Record<string, FilterValue>;
  onChange: (key: string, value: FilterValue) => void;
  onRemove: () => void;
  autoOpen: boolean;
  onOpened: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0, width: 0 });
  const box = useRef<View | null>(null);

  // Поле, добавленное из списка «Фильтр», открывается само: у него это
  // `setTimeout(... dropdown("show"))` после добавления.
  useEffect(() => {
    if (!autoOpen) return;
    onOpened();
    if (field.kind === 'text') return;

    const target = box.current as unknown as {
      measureInWindow?: (
        callback: (x: number, y: number, width: number, height: number) => void,
      ) => void;
    } | null;
    target?.measureInWindow?.((x, y, width, height) =>
      setAnchor({ x, y: y + height + 5, width }),
    );
    setOpen(true);
  }, [autoOpen, field.kind, onOpened]);

  const measure = (event: { currentTarget: unknown }) => {
    const target = event.currentTarget as {
      measureInWindow?: (
        callback: (x: number, y: number, width: number, height: number) => void,
      ) => void;
    };
    target.measureInWindow?.((x, y, width, height) => setAnchor({ x, y: y + height + 5, width }));
  };

  const selected =
    field.kind === 'select'
      ? field.options?.find((option) => option.value === values[field.key])?.label
      : undefined;

  const from = values[`${field.key}From`] as string | undefined;
  const to = values[`${field.key}To`] as string | undefined;
  const dates = from || to ? `${shortDay(from)} — ${shortDay(to)}` : '';

  return (
    <View ref={box} style={[styles.chip, { width: field.width ?? 168 }]}>
      <View style={styles.labelStrip}>
        <Text style={styles.label}>{field.label.toLowerCase()}</Text>
      </View>

      {field.kind === 'text' ? (
        <TextInput
          value={(values[field.key] as string) ?? ''}
          onChangeText={(text) => onChange(field.key, text || undefined)}
          accessibilityLabel={field.label}
          style={styles.input}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={field.label}
          accessibilityState={{ expanded: open }}
          onPress={(event) => {
            measure(event);
            setOpen(true);
          }}
          style={styles.valueArea}
        >
          <Text
            style={[
              styles.value,
              !(field.kind === 'date' ? dates : selected) && styles.placeholder,
            ]}
            numberOfLines={1}
          >
            {field.kind === 'date'
              ? dates || 'выберите дату'
              : (selected ?? field.placeholder ?? 'Выберите')}
          </Text>
        </Pressable>
      )}

      {field.required ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Убрать отбор: ${field.label}`}
          hitSlop={8}
          onPress={onRemove}
          style={styles.clear}
        >
          <Text style={styles.clearMark}>✕</Text>
        </Pressable>
      )}

      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть список"
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
          />

          {field.kind === 'select' ? (
            <View
              style={[
                styles.menu,
                { left: anchor.x, top: anchor.y, minWidth: Math.max(anchor.width, 170) },
              ]}
            >
              <ScrollView>
                {[{ value: '', label: 'Все' }, ...(field.options ?? [])].map((option) => (
                  <Pressable
                    key={option.value || 'all'}
                    accessibilityRole="button"
                    onPress={() => {
                      onChange(field.key, option.value || undefined);
                      setOpen(false);
                    }}
                    style={(state) => [styles.item, isHovered(state) && styles.itemHover]}
                  >
                    <Text style={styles.itemText}>{option.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : (
            <View style={[styles.dates, { left: anchor.x, top: anchor.y }]}>
              <View style={styles.datesRow}>
                <TextInput
                  value={from ?? ''}
                  onChangeText={(text) => onChange(`${field.key}From`, text || undefined)}
                  placeholder="2026-08-01"
                  placeholderTextColor={web.textMuted}
                  accessibilityLabel="Дата с"
                  style={styles.dateInput}
                />
                <TextInput
                  value={to ?? ''}
                  onChangeText={(text) => onChange(`${field.key}To`, text || undefined)}
                  placeholder="2026-08-31"
                  placeholderTextColor={web.textMuted}
                  accessibilityLabel="Дата по"
                  style={styles.dateInput}
                />
              </View>

              <View style={styles.quick}>
                {QUICK.map((item) => (
                  <Pressable
                    key={item.label}
                    accessibilityRole="button"
                    onPress={() => {
                      const { from: a, to: b } = item.range();
                      onChange(`${field.key}From`, a);
                      onChange(`${field.key}To`, b);
                      setOpen(false);
                    }}
                    style={(state) => [styles.quickItem, isHovered(state) && styles.itemHover]}
                  >
                    <Text style={styles.itemText}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

/**
 * Быстрые промежутки — те же семь и в том же порядке, что у него в
 * `daterange`: `TODAY`, `YESTERDAY`, `7_DAYS`, `30_DAYS`, `THIS_MONTH`,
 * `LAST_MONTH`, `QUARTER`.
 */
const QUICK: { label: string; range: () => { from: string; to: string } }[] = [
  { label: 'сегодня', range: () => back(0) },
  { label: 'Вчера', range: () => ({ from: day(shiftDays(1)), to: day(shiftDays(1)) }) },
  { label: '7 дней', range: () => back(6) },
  { label: '30 дней', range: () => back(29) },
  { label: 'Этот месяц', range: () => month(0) },
  { label: 'Прошлый месяц', range: () => month(-1) },
  { label: 'квартал', range: () => quarter() },
];

function back(days: number): { from: string; to: string } {
  return { from: day(shiftDays(days)), to: day(new Date()) };
}

function shiftDays(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function month(offset: number): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: day(first), to: day(last) };
}

function quarter(): { from: string; to: string } {
  const now = new Date();
  const start = Math.floor(now.getMonth() / 3) * 3;
  return {
    from: day(new Date(now.getFullYear(), start, 1)),
    to: day(new Date(now.getFullYear(), start + 3, 0)),
  };
}

function day(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const MONTHS = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

/**
 * «2026-08-14» → «14 авг», а из прошлого года — «14 авг, 2025».
 *
 * Год он дописывает ровно так же и по тому же условию:
 * `moment(t).format('YYYY') != moment().format('YYYY') && (n = 'D MMM, YYYY')`.
 */
export function shortDay(value?: string): string {
  if (!value) return '…';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  const short = `${parsed.getDate()} ${MONTHS[parsed.getMonth()]}`;
  return parsed.getFullYear() === new Date().getFullYear()
    ? short
    : `${short}, ${parsed.getFullYear()}`;
}

/** См. `Dropdown`: `hovered` есть только в вебе, и в типах React Native его нет. */
function isHovered(state: { pressed: boolean }): boolean {
  return (state as { hovered?: boolean }).hovered === true;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },

  /** Их `.inline-filter-item`: рамка #f2f2f2, скругление 3, высота 57. */
  chip: {
    position: 'relative',
    minHeight: 57,
    borderWidth: 1,
    borderColor: '#F2F2F2',
    borderRadius: 3,
    marginRight: 10,
    marginBottom: 5,
    backgroundColor: '#FFFFFF',
  },
  labelStrip: { backgroundColor: '#FAFAFA', paddingVertical: 3, paddingHorizontal: 10 },
  label: { fontFamily: WEB_FONT, fontSize: 12, color: '#666666' },

  valueArea: { height: 30, justifyContent: 'center', paddingLeft: 10, paddingRight: 30 },
  value: { fontFamily: WEB_FONT, fontSize: 12, color: web.text },
  placeholder: { color: web.textMuted },
  input: {
    height: 30,
    paddingLeft: 10,
    paddingRight: 10,
    fontFamily: WEB_FONT,
    fontSize: 12,
    color: web.text,
  },

  /** Их крестик: `top:21px; right:4px`, кегль 12, цвет #999. */
  clear: { position: 'absolute', top: 21, right: 4, paddingHorizontal: 4, paddingVertical: 2 },
  clearMark: { fontFamily: WEB_FONT, fontSize: 12, color: '#999999' },

  /** Их `.inline-filter > .dropdown`: высота 48, цвет #666. */
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 48,
    paddingHorizontal: 10,
    marginBottom: 5,
  },
  filterLabel: { fontFamily: WEB_FONT, fontSize: 14, color: '#666666' },

  backdrop: { flex: 1 },
  menu: {
    position: 'absolute',
    zIndex: 1,
    maxHeight: 320,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 4,
    paddingVertical: 4,
  },
  item: { paddingHorizontal: 14, paddingVertical: 9 },
  itemHover: { backgroundColor: web.rowHover },
  itemText: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },

  dates: {
    position: 'absolute',
    zIndex: 1,
    width: 300,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 4,
    padding: 14,
    gap: 10,
  },
  datesRow: { flexDirection: 'row', gap: 8 },
  dateInput: {
    flex: 1,
    height: 36,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 4,
    paddingHorizontal: 10,
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
  },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  quickItem: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 3 },
});
