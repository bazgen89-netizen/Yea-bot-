import type { SqlDriver } from './driver';
import type { Id } from '../domain/types';

/**
 * Категории глазами кассы: цвет, порядок, размер плитки и скрытие.
 *
 * Заводят категории в кабинете — в карточке товара, — а здесь настраивают,
 * как они выглядят на витрине. Так и у него: раздел «Настройки → Категории»
 * ничего не создаёт и не удаляет, он только про показ.
 */

export interface CategoryView {
  id: Id;
  name: string;
  /** Сколько товаров в категории. */
  count: number;
  /** Цвет плитки; `null` — белая, как у только что заведённой. */
  color: string | null;
  /** Скрытая не показывается на витрине. */
  hidden: boolean;
  /** Плитка вдвое шире — «размер» у него, `x1` или `x2`. */
  big: boolean;
  /** Порядок: тот самый номер справа от названия. */
  sort: number;
}

/**
 * Цвета плиток — палитра Material 200, та же, что у него.
 *
 * У него в коде цвета выбираются из готового набора, а не пипеткой: девять
 * пастельных тонов и белый. Пипетка на кассе была бы лишней свободой — в
 * зале важно, чтобы «Шу Пуэр» узнавался по цвету, а не был бы уникален.
 */
export const CATEGORY_COLORS = [
  '#FFFFFF',
  '#EEEEEE',
  '#EF9A9A',
  '#F48FB1',
  '#CE93D8',
  '#B39DDB',
  '#9FA8DA',
  '#90CAF9',
  '#80DEEA',
  '#A5D6A7',
  '#C5E1A5',
  '#E6EE9C',
  '#FFCC80',
];

/**
 * Цвет по названию — пока цвет не назначили руками.
 *
 * Считается из самого названия, а не берётся по порядку: у категории цвет
 * должен быть один и тот же всегда, а не меняться от того, кого добавили
 * выше по списку.
 */
export function colorFromName(name: string): string {
  let value = 0;
  for (let i = 0; i < name.length; i++) value = (value * 31 + name.charCodeAt(i)) >>> 0;

  // Белый и светло-серый из палитры пропускаем: как «цвет по умолчанию» они
  // не читаются — категория выглядела бы неокрашенной.
  const tints = CATEGORY_COLORS.slice(2);
  return tints[value % tints.length];
}

export function listCategoryViews(db: SqlDriver): CategoryView[] {
  const rows = db.all<{
    id: Id;
    name: string;
    count: number;
    color: string | null;
    hidden: number;
    big: number;
    sort: number;
  }>(
    `SELECT c.id,
            c.name,
            c.color,
            c.hidden,
            c.big,
            c.sort,
            (SELECT COUNT(*) FROM products p
              WHERE p.category_id = c.id AND p.archived = 0) AS count
     FROM categories c
     ORDER BY c.sort, c.name COLLATE NOCASE`,
  );

  return rows.map((row) => ({
    ...row,
    hidden: row.hidden === 1,
    big: row.big === 1,
  }));
}

export function setCategoryColor(db: SqlDriver, id: Id, color: string): void {
  db.run('UPDATE categories SET color = ? WHERE id = ?', [color, id]);
}

export function setCategoryHidden(db: SqlDriver, id: Id, hidden: boolean): void {
  db.run('UPDATE categories SET hidden = ? WHERE id = ?', [hidden ? 1 : 0, id]);
}

export function setCategoryBig(db: SqlDriver, id: Id, big: boolean): void {
  db.run('UPDATE categories SET big = ? WHERE id = ?', [big ? 1 : 0, id]);
}

/**
 * Переставить категорию на новое место.
 *
 * Номера присваиваются заново подряд, а не сдвигаются по одному: список
 * короткий, а «дырки» в нумерации потом читаются как ошибка.
 */
export function reorderCategories(db: SqlDriver, ids: Id[]): void {
  db.tx(() => {
    ids.forEach((id, index) => {
      db.run('UPDATE categories SET sort = ? WHERE id = ?', [index, id]);
    });
  });
}

/** Скрытые категории — их товары прячутся с витрины, если не сказано иначе. */
export function hiddenCategoryIds(db: SqlDriver): Id[] {
  return db.all<{ id: Id }>('SELECT id FROM categories WHERE hidden = 1').map((row) => row.id);
}
