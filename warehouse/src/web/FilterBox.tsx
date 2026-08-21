import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './Translated';

import { WebIcon } from '../ui/icons';
import { web, WEB_FONT } from '../ui/webTheme';

/**
 * Поле отбора в строке над журналом — «дата», «статус», «оплата», «тип».
 *
 * В кабинете отбор стоит прямо над таблицей отдельными полями: у каждого
 * серая подпись сверху, значение под ней и крестик, чтобы снять. У нас всё
 * это пряталось за одной кнопкой «Фильтр», и чтобы отобрать чеки за неделю,
 * приходилось открывать ящик, листать его и закрывать. Он это и назвал
 * «не исправил»: смотрит он на строку отбора, а не на кнопку.
 *
 * Кнопка «Фильтр» остаётся: за ней то, чему в строке места нет —
 * отправитель, получатель, автор, счёт.
 */
export interface BoxOption {
  value: string;
  label: string;
}

export function FilterBox({
  label,
  value,
  placeholder,
  options,
  onPick,
  onClear,
  width = 168,
}: {
  label: string;
  /** Что показать в поле. Пусто — стоит серая подсказка. */
  value?: string;
  placeholder: string;
  /** Список для выбора. Пусто — поле только показывает и снимается крестиком. */
  options?: BoxOption[];
  onPick?: (value: string | undefined) => void;
  onClear: () => void;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0, width: 0 });

  return (
    <>
      <View style={[styles.box, { width }]}>
        <Text style={styles.label}>{label}</Text>

        <View style={styles.line}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ expanded: open }}
            disabled={!options}
            onPress={(event) => {
              const target = event.currentTarget as unknown as {
                measureInWindow?: (
                  callback: (x: number, y: number, width: number, height: number) => void,
                ) => void;
              };
              target.measureInWindow?.((x, y, boxWidth, height) =>
                setAnchor({ x, y: y + height + 6, width: boxWidth }),
              );
              setOpen(true);
            }}
            style={styles.valueArea}
          >
            <Text style={[styles.value, !value && styles.placeholder]} numberOfLines={1}>
              {value || placeholder}
            </Text>
          </Pressable>

          {/* Крестик стоит всегда — как у него; при пустом поле он просто
              бледный и ничего не меняет. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Снять отбор: ${label}`}
            hitSlop={6}
            onPress={onClear}
            style={styles.clear}
          >
            <Text style={[styles.clearMark, !value && styles.clearPale]}>✕</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        {/* Подложка отдельным слоем под списком: вложенная кнопка в вебе
            перехватывает нажатия у пунктов внутри. */}
        <View style={styles.backdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть список"
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
          />

          <View
            style={[
              styles.menu,
              { left: anchor.x, top: anchor.y, minWidth: Math.max(anchor.width, 170) },
            ]}
          >
            <ScrollView>
              {[{ value: '', label: 'Все' }, ...(options ?? [])].map((option) => (
                <Pressable
                  key={option.value || 'all'}
                  accessibilityRole="button"
                  onPress={() => {
                    onPick?.(option.value || undefined);
                    setOpen(false);
                  }}
                  style={(state) => [styles.item, isHovered(state) && styles.itemHover]}
                >
                  <Text style={styles.itemText}>{option.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

/**
 * Поле даты: два дня подряд, «14 авг — 20 авг».
 *
 * Правится вводом, а показывается коротко — как в кабинете. Ввод открывается
 * по нажатию: держать два поля с датами в строке отбора негде.
 */
export function DateBox({
  from,
  to,
  onChange,
  onClear,
}: {
  from?: string;
  to?: string;
  onChange: (key: 'from' | 'to', value: string | undefined) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });

  const shown = from || to ? `${shortDay(from)} — ${shortDay(to)}` : '';

  return (
    <>
      <View style={[styles.box, { width: 186 }]}>
        <Text style={styles.label}>дата</Text>

        <View style={styles.line}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Дата"
            onPress={(event) => {
              const target = event.currentTarget as unknown as {
                measureInWindow?: (
                  callback: (x: number, y: number, width: number, height: number) => void,
                ) => void;
              };
              target.measureInWindow?.((x, y, _w, height) => setAnchor({ x, y: y + height + 6 }));
              setOpen(true);
            }}
            style={styles.valueArea}
          >
            <Text style={[styles.value, !shown && styles.placeholder]} numberOfLines={1}>
              {shown || 'выберите'}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Снять отбор: дата"
            hitSlop={6}
            onPress={onClear}
            style={styles.clear}
          >
            <Text style={[styles.clearMark, !shown && styles.clearPale]}>✕</Text>
          </Pressable>
        </View>
      </View>

      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть выбор дат"
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
          />

          <View style={[styles.dates, { left: anchor.x, top: anchor.y }]}>
            <Text style={styles.datesHead}>С какого по какое</Text>

            <View style={styles.datesRow}>
              <TextInput
                value={from ?? ''}
                onChangeText={(text) => onChange('from', text || undefined)}
                placeholder="2026-08-01"
                placeholderTextColor={web.textMuted}
                style={styles.dateInput}
              />
              <TextInput
                value={to ?? ''}
                onChangeText={(text) => onChange('to', text || undefined)}
                placeholder="2026-08-31"
                placeholderTextColor={web.textMuted}
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
                    onChange('from', a);
                    onChange('to', b);
                    setOpen(false);
                  }}
                  style={(state) => [styles.quickItem, isHovered(state) && styles.itemHover]}
                >
                  <Text style={styles.itemText}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

/** Быстрые промежутки — те же слова, что в его выпадающем списке. */
const QUICK = [
  { label: 'сегодня', range: () => shift(0) },
  { label: 'неделю', range: () => shift(6) },
  { label: 'месяц', range: () => shift(29) },
  { label: 'квартал', range: () => shift(89) },
];

function shift(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);

  return { from: day(from), to: day(to) };
}

function day(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const MONTHS = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

/** «2026-08-14» → «14 авг». Пусто — многоточие: промежуток открыт с краю. */
function shortDay(value?: string): string {
  if (!value) return '…';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return `${parsed.getDate()} ${MONTHS[parsed.getMonth()]}`;
}

/** См. `Dropdown`: `hovered` есть только в вебе, и в типах React Native его нет. */
function isHovered(state: { pressed: boolean }): boolean {
  return (state as { hovered?: boolean }).hovered === true;
}

const styles = StyleSheet.create({
  box: {
    height: 62,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    paddingHorizontal: 12,
    paddingTop: 7,
    backgroundColor: '#FFFFFF',
    justifyContent: 'flex-start',
  },
  label: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  valueArea: { flex: 1 },
  value: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  placeholder: { color: web.textMuted },
  clear: { paddingHorizontal: 2 },
  clearMark: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },
  clearPale: { opacity: 0.45 },

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
  datesHead: { fontFamily: WEB_FONT, fontSize: 13, color: web.textMuted },
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
