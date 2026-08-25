import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './Translated';

import { MiniChart } from './MiniChart';
import { visiblePages } from './pagination';
import { say } from '../ui/alert';
import { WebIcon } from '../ui/icons';
import { web, webText, WEB_FONT } from '../ui/webTheme';

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
  /** Шапка отчёта — прописные синие; в справочнике и журналах она другая. */
  report?: boolean;
  /** Числовые колонки прижимаются вправо. */
  numeric?: boolean;
  /** Кружок «?» рядом с названием: текст подсказки, как считается колонка. */
  help?: string;
  /** Итог по колонке — у него он стоит прямо в шапке, под названием. */
  total?: string;
  /** Значения для полоски-графика в шапке: у него так в отчётах по датам. */
  chart?: number[];
  /** Подчёркнутый заголовок — по этой колонке можно сортировать. */
  sortable?: boolean;
}

/** Что сейчас отсортировано и в какую сторону. */
export interface Sorting {
  key: string;
  reverse: boolean;
}

/**
 * Шапка таблицы.
 *
 * `onSort` — нажатие по названию сортируемой колонки. Без него подчёркнутый
 * заголовок был бы обещанием без исполнения: у него шапка не просто
 * подчёркнута, она сортирует (`sortable-table-link` в их разметке).
 */
export function HeadRow({
  columns,
  lead,
  sorting,
  onSort,
  celled,
}: {
  columns: Column[];
  lead?: ReactNode;
  sorting?: Sorting;
  onSort?: (key: string) => void;
  /**
   * Столбцы разделены вертикальными линиями — как в его таблицах.
   *
   * У них это `ui small celled table`: `.fixed-title .ui.table thead th`
   * несёт `border-right: 1px solid #f2f2f2`, и такая же линия идёт по
   * строкам. Без них таблица на девять столбцов читается как каша.
   */
  celled?: boolean;
}) {
  return (
    <View style={[styles.headRow, celled && styles.rowCelled]}>
      {lead}
      {columns.map((column) => (
        <View key={column.key} style={[{ width: column.width }, celled && styles.celledCell]}>
          <View style={[styles.headCell, column.numeric && styles.headCellRight]}>
            <Text
              accessibilityRole={column.sortable && onSort ? 'button' : 'text'}
              onPress={column.sortable && onSort ? () => onSort(column.key) : undefined}
              style={[
                column.report ? webText.reportColumn : webText.column,
                column.numeric && styles.right,
                column.sortable && styles.sortable,
              ]}
              numberOfLines={1}
            >
              {column.title}
              {sorting?.key === column.key ? (sorting.reverse ? ' ▼' : ' ▲') : ''}
            </Text>
            {column.help ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Как считается «${column.title}»`}
                onPress={() => say(column.title, column.help)}
                hitSlop={6}
              >
                <Text style={styles.help}>?</Text>
              </Pressable>
            ) : null}
          </View>

          {column.chart ? <MiniChart values={column.chart} /> : null}

          {/* Итог под названием — так у него: сумма по колонке видна сразу,
              не приходится искать её строкой в таблице. */}
          {column.total !== undefined ? (
            <Text
              style={[styles.headTotal, column.numeric && styles.right]}
              numberOfLines={1}
            >
              {column.total}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function Row({
  children,
  onPress,
  celled,
}: {
  children: ReactNode;
  onPress?: () => void;
  /** Столбцы разделены линиями: тогда отступ между ними даёт сама ячейка. */
  celled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={(state) => [
        styles.row,
        celled && styles.rowCelled,
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

  /**
   * Листалка — его: «« ‹ 1 2 3 … 65 › »». Слова «Страницы» у него нет,
   * зато есть четыре стрелки: к первой, на шаг назад, на шаг вперёд и к
   * последней. Без них на шестидесяти пяти страницах до конца не добраться.
   */
  const step = (to: number, label: string, hint: string, off: boolean) => (
    <Pressable
      key={hint}
      accessibilityRole="button"
      accessibilityLabel={hint}
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={() => onPage(to)}
      style={[styles.pageButton, off && styles.pageStepOff]}
    >
      <Text style={[styles.pageLabel, off && styles.pageStepOffLabel]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.pager}>
      {step(1, '«', 'К первой странице', page === 1)}
      {step(page - 1, '‹', 'Предыдущая страница', page === 1)}
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
      {step(page + 1, '›', 'Следующая страница', page === pages)}
      {step(pages, '»', 'К последней странице', page === pages)}
    </View>
  );
}

export const CELL = {
  paddingLeft: 9,
  paddingRight: 11,
  borderRightWidth: 1,
  borderRightColor: '#F2F2F2',
} as const;

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
  searchInput: { flex: 1, fontFamily: WEB_FONT, fontSize: 15, color: web.text, outlineStyle: 'none' } as object,
  searchIcon: { fontFamily: WEB_FONT, fontSize: 19, color: web.textMuted },
  button: {
    height: 44,
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  buttonLabel: { fontFamily: WEB_FONT, fontSize: 15 },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 22,
    height: 40,
    backgroundColor: web.tableHead,
    borderBottomWidth: 1,
    borderBottomColor: web.border,
  },
  right: { textAlign: 'right' },
  sortable: { textDecorationLine: 'underline' },
  headCell: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headCellRight: { justifyContent: 'flex-end' },
  /** Кружок с вопросом — у него он серый, тонкой рамкой, 11 пикселей. */
  headTotal: {
    fontFamily: WEB_FONT,
    fontSize: 14,
    color: web.text,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  help: {
    width: 17,
    height: 17,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#C7CBCF',
    color: '#9AA0A6',
    fontFamily: WEB_FONT,
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 22,
    // Их `.ui.table td` — `padding: .78571429em` от 12,6 точек, то есть
    // около десяти сверху и снизу; строка выходит в 38 точек, а не в 46.
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: web.gridLine,
  },
  rowHover: { backgroundColor: web.rowHover },
  pageStepOff: { opacity: 0.4 },
  pageStepOffLabel: { color: web.textMuted },
  /** Разделённые столбцы: промежуток даёт не `gap`, а поля самой ячейки. */
  rowCelled: { gap: 0, paddingHorizontal: 0 },
  /** Та же ячейка для строк таблицы — экспортируется через `CELL`. */
  celledCell: {
    // Их `th > div`: `padding: 11px 11px 11px 9px`, линия справа.
    paddingLeft: 9,
    paddingRight: 11,
    borderRightWidth: 1,
    borderRightColor: '#F2F2F2',
    justifyContent: 'center',
  },
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
  pagerLabel: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted, marginRight: 12 },
  pagerGap: { fontFamily: WEB_FONT, fontSize: 14, color: web.textMuted, paddingHorizontal: 6 },
  pageButton: {
    minWidth: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  pageButtonActive: { backgroundColor: '#FBF7E8' },
  pageLabel: { fontFamily: WEB_FONT, fontSize: 15, color: web.link },
  pageLabelActive: { color: web.text },
});
