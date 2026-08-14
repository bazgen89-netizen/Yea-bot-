import type { SqlDriver } from './driver';
import { listProducts } from './products';
import type { Id, ProductWithStock } from '../domain/types';

/**
 * Рекомендации на кассе — то, что стоит над чеком строкой «Рекомендации».
 *
 * Список — это правило, по которому к набранному чеку подбираются товары:
 *
 *   — **«Покупают вместе»** считает по прошлым чекам. Ничего не выдумывает:
 *     берёт то, что уже лежало в одном чеке с набранным, и ставит вперёд то,
 *     что попадалось чаще. Пока чеков нет, список пуст — и это честно.
 *   — **свой список** — товары, отобранные руками. Их показывают всегда, чем
 *     бы ни был набран чек: сезонное, новинки, то, что просят продвигать.
 *
 * Списков может быть несколько, у каждого свой размер и свой порядок; их
 * включают и выключают по одному.
 */

export type RecoKind = 'together' | 'manual';

export interface RecoList {
  id: Id;
  name: string;
  kind: RecoKind;
  enabled: number;
  /** Сколько товаров показывать. */
  size: number;
  sort: number;
  /** Сколько товаров отобрано руками; у «Покупают вместе» — 0. */
  picked: number;
  created_at: string;
}

export function listRecoLists(db: SqlDriver): RecoList[] {
  return db.all<RecoList>(
    `SELECT l.*,
            (SELECT COUNT(*) FROM reco_items i WHERE i.list_id = l.id) AS picked
     FROM reco_lists l
     ORDER BY l.sort, l.id`,
  );
}

export function createRecoList(db: SqlDriver, name: string, kind: RecoKind = 'manual'): Id {
  const last = db.get<{ sort: number }>('SELECT COALESCE(MAX(sort), -1) AS sort FROM reco_lists');

  db.run(
    `INSERT INTO reco_lists (name, kind, enabled, size, sort, created_at)
     VALUES (?, ?, 1, 8, ?, ?)`,
    [name.trim() || 'Новый список', kind, (last?.sort ?? -1) + 1, new Date().toISOString()],
  );
  return db.lastInsertId();
}

export interface RecoListPatch {
  name?: string;
  enabled?: boolean;
  /** Сколько товаров показывать; меньше одного не бывает. */
  size?: number;
}

export function updateRecoList(db: SqlDriver, id: Id, patch: RecoListPatch): void {
  const sets: string[] = [];
  const params: (string | number)[] = [];

  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(patch.name.trim() || 'Новый список');
  }
  if (patch.enabled !== undefined) {
    sets.push('enabled = ?');
    params.push(patch.enabled ? 1 : 0);
  }
  if (patch.size !== undefined) {
    sets.push('size = ?');
    params.push(Math.min(Math.max(1, Math.round(patch.size)), 50));
  }
  if (sets.length === 0) return;

  params.push(id);
  db.run(`UPDATE reco_lists SET ${sets.join(', ')} WHERE id = ?`, params);
}

export function deleteRecoList(db: SqlDriver, id: Id): void {
  db.run('DELETE FROM reco_lists WHERE id = ?', [id]);
}

/**
 * Двигает список на одну позицию — за уголок в настройках.
 *
 * Порядок важен: списки показываются подряд, и первый занимает место.
 */
export function moveRecoList(db: SqlDriver, id: Id, direction: -1 | 1): void {
  db.tx(() => {
    const lists = listRecoLists(db);
    const index = lists.findIndex((list) => list.id === id);
    const swap = index + direction;
    if (index < 0 || swap < 0 || swap >= lists.length) return;

    db.run('UPDATE reco_lists SET sort = ? WHERE id = ?', [swap, lists[index].id]);
    db.run('UPDATE reco_lists SET sort = ? WHERE id = ?', [index, lists[swap].id]);
  });
}

/** Товары своего списка. */
export function recoItems(db: SqlDriver, listId: Id): Id[] {
  return db
    .all<{ product_id: Id }>(
      'SELECT product_id FROM reco_items WHERE list_id = ? ORDER BY sort, product_id',
      [listId],
    )
    .map((row) => row.product_id);
}

export function setRecoItems(db: SqlDriver, listId: Id, productIds: Id[]): void {
  db.tx(() => {
    db.run('DELETE FROM reco_items WHERE list_id = ?', [listId]);
    productIds.forEach((productId, index) => {
      db.run('INSERT INTO reco_items (list_id, product_id, sort) VALUES (?, ?, ?)', [
        listId,
        productId,
        index,
      ]);
    });
  });
}

/**
 * Что показать к этому чеку.
 *
 * Товары, уже лежащие в чеке, из подбора исключаются: советовать взять то,
 * что покупатель уже взял, — не совет.
 */
export function recommendedFor(db: SqlDriver, inCart: Id[]): ProductWithStock[] {
  const lists = listRecoLists(db).filter((list) => list.enabled);
  if (lists.length === 0) return [];

  const picked: Id[] = [];

  for (const list of lists) {
    const ids = list.kind === 'together' ? boughtTogether(db, inCart, list.size) : recoItems(db, list.id);

    for (const id of ids) {
      if (picked.length >= list.size * lists.length) break;
      if (inCart.includes(id) || picked.includes(id)) continue;
      picked.push(id);
    }
  }

  if (picked.length === 0) return [];

  // Товары берём обычным списком: у него уже посчитан остаток и подтянута
  // категория, и второй такой же запрос здесь ни к чему.
  const all = listProducts(db);
  return picked
    .map((id) => all.find((product) => product.id === id))
    .filter((product): product is ProductWithStock => Boolean(product));
}

/**
 * Что чаще всего лежало в одном чеке с этими товарами.
 *
 * Пустой чек — тоже вопрос: тогда «вместе» не с чем, и показываем просто
 * самое ходовое. Иначе строка рекомендаций пустовала бы до первого товара,
 * а именно в этот момент подсказка полезнее всего.
 */
function boughtTogether(db: SqlDriver, inCart: Id[], limit: number): Id[] {
  if (inCart.length === 0) {
    return db
      .all<{ product_id: Id }>(
        `SELECT product_id, COUNT(*) AS n
         FROM sale_items
         GROUP BY product_id
         ORDER BY n DESC, product_id
         LIMIT ?`,
        [limit],
      )
      .map((row) => row.product_id);
  }

  const holes = inCart.map(() => '?').join(',');

  return db
    .all<{ product_id: Id }>(
      `SELECT other.product_id, COUNT(*) AS n
       FROM sale_items mine
       JOIN sale_items other
         ON other.sale_id = mine.sale_id AND other.product_id <> mine.product_id
       WHERE mine.product_id IN (${holes})
         AND other.product_id NOT IN (${holes})
       GROUP BY other.product_id
       ORDER BY n DESC, other.product_id
       LIMIT ?`,
      [...inCart, ...inCart, limit],
    )
    .map((row) => row.product_id);
}
