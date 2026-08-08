import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { visiblePages } from './pagination';
import { WebIcon } from '../ui/icons';
import { web, webText } from '../ui/webTheme';

/**
 * Кирпичи таблиц кабинета: панель действий сверху, шапка колонок, строки,
 * постраничная навигация. Таблиц в кабинете почти десяток, и все они устроены
 * одинаково — собираем их из одних и тех же частей, чтобы отступы и цвета
 * не разъезжались от экрана к экрану.
 */

/** Полоса с кнопками над таблицей. */
export function Toolbar({ children }: { children: ReactNode }) {
  return <View style={styles.toolbar}>{children}</View>;
}

export function SearchBox({
  value,
  onChange,
  placeholder,
  width = 316,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  width?: number;
}) {
  return (
    <View style={[styles.search, { width }]}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={web.textMuted}
        style={styles.searchInput}
      />
      <WebIcon.funnel size={0} color="transparent" />
      <Text style={styles.searchIcon}>⌕</Text>
    </View>
  );
}

export type ButtonTone = 'plain' | 'green' | 'greenOutline' | 'orangeOutline' | 'blueOutline';

export function ToolButton({
  label,
  tone = 'plain',
  icon,
  trailing,
  onPress,
  soon,
}: {
  label: string;
  tone?: ButtonTone;
  icon?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  /** Ещё не сделано: кнопка видна, но приглушена и не нажимается. */
  soon?: boolean;
}) {
  const palette = TONES[tone];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: soon }}
      disabled={soon || !onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border },
        pressed && { opacity: 0.85 },
        soon && { opacity: 0.45 },
      ]}
    >
      {icon}
      <Text style={[styles.buttonLabel, { color: palette.text }]}>{label}</Text>
      {trailing}
    </Pressable>
  );
}

const TONES: Record<ButtonTone, { bg: string; border: string; text: string }> = {
  plain: { bg: '#FFFFFF', border: web.border, text: web.text },
  green: { bg: web.green, border: web.green, text: '#FFFFFF' },
  greenOutline: { bg: '#FFFFFF', border: web.green, text: web.greenText },
  orangeOutline: { bg: '#FFFFFF', border: web.orange, text: web.orange },
  blueOutline: { bg: '#FFFFFF', border: web.link, text: web.link },
};

/** Ширины колонок задаются на экране: у каждой таблицы они свои. */
export interface Column {
  key: string;
  title: string;
  width: number;
  /** Числовые колонки прижимаются вправо. */
  numeric?: boolean;
  /** Подчёркнутый заголовок — по этой колонке можно сортировать. */
  sortable?: boolean;
}

export function HeadRow({ columns, lead }: { columns: Column[]; lead?: ReactNode }) {
  return (
    <View style={styles.headRow}>
      {lead}
      {columns.map((column) => (
        <View key={column.key} style={{ width: column.width }}>
          <Text
            style={[
              webText.column,
              column.numeric && styles.right,
              column.sortable && styles.sortable,
            ]}
            numberOfLines={1}
          >
            {column.title}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function Row({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={(state) => [
        styles.row,
        (state as { hovered?: boolean }).hovered && styles.rowHover,
      ]}
    >
      {children}
    </Pressable>
  );
}

/** Пустой квадратик выбора строки. Массовые действия ещё не сделаны. */
export function Checkbox() {
  return <View style={styles.checkbox} />;
}

export function Pager({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) return null;

  return (
    <View style={styles.pager}>
      <Text style={styles.pagerLabel}>Страницы</Text>
      {visiblePages(page, pages).map((item, index) =>
        item === null ? (
          <Text key={`gap${index}`} style={styles.pagerGap}>
            …
          </Text>
        ) : (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: item === page }}
            onPress={() => onPage(item)}
            style={[styles.pageButton, item === page && styles.pageButtonActive]}
          >
            <Text style={[styles.pageLabel, item === page && styles.pageLabelActive]}>{item}</Text>
          </Pressable>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 22,
    paddingVertical: 18,
  },
  search: {
    height: 44,
    borderWidth: 1,
    borderColor: web.border,
    borderRadius: 3,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: { flex: 1, fontSize: 15, color: web.text, outlineStyle: 'none' } as object,
  searchIcon: { fontSize: 19, color: web.textMuted },
  button: {
    height: 44,
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  buttonLabel: { fontSize: 15 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 22,
    height: 46,
    borderBottomWidth: 1,
    borderBottomColor: web.border,
  },
  right: { textAlign: 'right' },
  sortable: { textDecorationLine: 'underline' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: web.gridLine,
  },
  rowHover: { backgroundColor: web.rowHover },
  checkbox: {
    width: 17,
    height: 17,
    borderWidth: 1,
    borderColor: '#B0B4B8',
    borderRadius: 2,
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: web.border,
  },
  pagerLabel: { fontSize: 14, color: web.textMuted, marginRight: 12 },
  pagerGap: { fontSize: 14, color: web.textMuted, paddingHorizontal: 6 },
  pageButton: {
    minWidth: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  pageButtonActive: { backgroundColor: '#FBF7E8' },
  pageLabel: { fontSize: 15, color: web.link },
  pageLabelActive: { color: web.text },
});
