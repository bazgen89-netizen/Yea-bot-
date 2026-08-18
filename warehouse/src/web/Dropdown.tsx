import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './Translated';

import { WebIcon } from '../ui/icons';
import { FORM_BORDER, web, WEB_FONT } from '../ui/webTheme';

/**
 * Выпадающий список кабинета.
 *
 * Список рисуется в `Modal`, а не рядом с кнопкой: иначе он обрезался бы
 * прокруткой страницы, внутри которой стоит — а в кабинете эти списки
 * попадаются и в самом низу таблиц.
 *
 * Прозрачная подложка на весь экран нужна не для красоты: без неё список
 * нечем закрыть, кроме повторного нажатия на саму кнопку.
 */

export interface Option<T extends string> {
  value: T;
  label: string;
}

export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  variant = 'chip',
  width,
  label,
  placeholder,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  /**
   * `chip` — рамка, как у «неделю»; `dotted` — пунктир внутри заголовка;
   * `header` — белым по синему, для шапки; `field` — во всю ширину поля
   * формы, вровень с соседними полями ввода.
   */
  variant?: 'chip' | 'dotted' | 'header' | 'field';
  width?: number;
  label?: string;
  /** Что показать, когда ничего не выбрано. */
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  // Куда положить список: под кнопкой, которую нажали.
  const [anchor, setAnchor] = useState({ x: 0, y: 0, width: 0 });

  const current = options.find((option) => option.value === value);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? current?.label}
        accessibilityState={{ expanded: open }}
        onPress={(event) => {
          const target = event.currentTarget as unknown as {
            measureInWindow?: (
              callback: (x: number, y: number, width: number, height: number) => void,
            ) => void;
          };
          target.measureInWindow?.((x, y, boxWidth, height) =>
            setAnchor({ x, y: y + height + 4, width: boxWidth }),
          );
          setOpen(true);
        }}
        style={(state) => [
          styles[variant],
          width ? { width } : null,
          isHovered(state) && (variant === 'chip' || variant === 'field') && styles.chipHover,
        ]}
      >
        <Text
          style={[styles[`${variant}Text`], !current && styles.placeholder]}
          numberOfLines={1}
        >
          {current?.label ?? placeholder ?? ''}
        </Text>
        <WebIcon.chevronDown size={14} color={CHEVRON[variant]} />
      </Pressable>

      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        {/* Подложка — отдельный слой под списком, а не обёртка вокруг него:
            вложенная кнопка в вебе перехватывает нажатия у пунктов внутри. */}
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
              { left: anchor.x, top: anchor.y, minWidth: Math.max(anchor.width, 150) },
            ]}
          >
            <ScrollView>
              {options.map((option) => (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: option.value === value }}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  style={(state) => [
                    styles.item,
                    isHovered(state) && styles.itemHover,
                    option.value === value && styles.itemActive,
                  ]}
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

/** См. `Sidebar`: `hovered` есть только в вебе, и в типах React Native его нет. */
function isHovered(state: { pressed: boolean }): boolean {
  return (state as { hovered?: boolean }).hovered === true;
}

/** Цвет стрелки в каждом варианте. */
const CHEVRON: Record<'chip' | 'dotted' | 'header' | 'field', string> = {
  chip: web.textMuted,
  dotted: web.text,
  header: web.headerText,
  field: web.textMuted,
};

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  chipHover: { backgroundColor: web.rowHover },
  // Поле формы: та же высота и рамка, что у ввода рядом — иначе строка
  // «Тип маркировки · Система налогообложения» выглядит ступенькой.
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    height: 38,
    borderWidth: 1,
    borderColor: FORM_BORDER,
    borderRadius: 4,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
  },
  fieldText: { flex: 1, fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  placeholder: { color: web.textMuted },
  chipText: { fontFamily: WEB_FONT, fontSize: 14, color: web.text },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerText: { fontFamily: WEB_FONT, fontSize: 15, color: web.headerText },
  dotted: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dottedText: {
    fontFamily: WEB_FONT, fontSize: 30,
    color: web.text,
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
  },
  backdrop: { flex: 1 },
  menu: {
    position: 'absolute',
    // См. панель кассира: подложка тоже абсолютная, и без явного порядка
    // она оказывается поверх списка.
    zIndex: 1,
    maxHeight: 320,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    paddingVertical: 4,
    // Тень у оригинала мягкая и почти не заметна — но без неё список
    // сливается с таблицей под ним.
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  item: { paddingHorizontal: 16, paddingVertical: 11 },
  itemHover: { backgroundColor: web.rowHover },
  itemActive: { backgroundColor: web.sidebarActive },
  itemText: { fontFamily: WEB_FONT, fontSize: 15, color: web.text },
});
