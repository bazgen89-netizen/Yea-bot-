import type { SqlDriver } from './driver';
import type { Kopecks } from '../domain/money';
import type { Id } from '../domain/types';

/**
 * Действия сразу над списком товаров — то, что у него в меню «Действия».
 *
 * Списком, а не по одному: в справочнике шестьсот позиций, и поднять цены
 * на десять процентов, открывая шестьсот карточек, — не работа, а наказание.
 *
 * Сами вычисления живут в `domain/price`: здесь только записи в базу.
 */

/** Новая цена для одного товара. */
export interface PriceChange {
  id: Id;
  price: Kopecks;
}

/**
 * Записать новые цены.
 *
 * Одной транзакцией: половина товаров с новыми ценами, половина со старыми —
 * то самое состояние, из которого потом не разобрать, что произошло.
 */
export function applyPrices(db: SqlDriver, changes: PriceChange[]): void {
  db.tx(() => {
    for (const change of changes) {
      db.run('UPDATE products SET sale_price = ? WHERE id = ?', [
        change.price,
        change.id,
      ]);
    }
  });
}

/** Перенести товары в категорию; `null` — вынуть из категории вовсе. */
export function setCategoryFor(db: SqlDriver, ids: Id[], categoryId: Id | null): void {
  db.tx(() => {
    for (const id of ids) {
      db.run('UPDATE products SET category_id = ? WHERE id = ?', [
        categoryId,
        id,
      ]);
    }
  });
}

/**
 * Отправить товары в архив.
 *
 * Не `DELETE`: за товаром тянутся движения склада и строки чеков, и удалить
 * его — значит переписать историю продаж. У него «Удалить» из этого меню
 * тоже прячет товар, а не стирает: удалённые лежат в «Корзине».
 */
export function archiveProducts(db: SqlDriver, ids: Id[]): void {
  db.tx(() => {
    for (const id of ids) {
      db.run('UPDATE products SET archived = 1 WHERE id = ?', [id]);
    }
  });
}

/**
 * Поля, которые он правит списком, а не по одному.
 *
 * В его меню это пункт «Другое»: срок годности, НДС и признаки — то, что в
 * карточке лежит по одному полю, а в жизни меняется у целой полки сразу.
 * Пустое поле означает «не трогать»: окно правит то, что заполнено, и
 * ничего больше.
 */
export interface BulkFields {
  /** Срок годности, «ГГГГ-ММ-ДД». */
  expiresAt?: string | null;
  /** Ставка НДС в сотых долях процента: 20 % — это 2000. */
  vatBp?: number | null;
  /** Весовой товар. */
  weighted?: boolean;
  /** Подакцизный. */
  excisable?: boolean;
  /** Свободная цена: кассир вводит её сам. */
  freePrice?: boolean;
}

export function setFieldsFor(db: SqlDriver, ids: Id[], fields: BulkFields): void {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  const put = (column: string, value: string | number | null) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };

  if (fields.expiresAt !== undefined) put('expires_at', fields.expiresAt);
  if (fields.vatBp !== undefined) put('vat_bp', fields.vatBp);
  if (fields.weighted !== undefined) put('weighted', fields.weighted ? 1 : 0);
  if (fields.excisable !== undefined) put('excisable', fields.excisable ? 1 : 0);
  if (fields.freePrice !== undefined) put('free_price', fields.freePrice ? 1 : 0);

  if (sets.length === 0) return;

  db.tx(() => {
    for (const id of ids) {
      db.run(`UPDATE products SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [
        ...values,
        new Date().toISOString(),
        id,
      ]);
    }
  });
}
