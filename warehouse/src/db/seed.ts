import type { SqlDriver } from './driver';
import { ensureLocation } from './locations';
import CATALOG from './seed/products.json';

/**
 * Первичное наполнение базы каталогом WAYSTEA.
 *
 * Чтобы приложение было на чём проверять, оно приходит с настоящим каталогом:
 * 661 позиция и остатки по трём магазинам — та же выгрузка, что и в рабочей
 * программе. Загружается один раз: отметка в `app_state` не даёт повторить
 * загрузку при следующем запуске и затереть то, что успели наработать.
 *
 * Числа в файле уже приведены к внутренним единицам: цены — копейки,
 * количества — тысячные. Так разбор не повторяется на каждом запуске телефона.
 */

interface SeedProduct {
  /** Наименование. */
  n: string;
  /** Код. */
  c: string | null;
  /** Артикул. */
  s: string | null;
  /** Единица измерения. */
  u: string;
  /** Цена продажи, копейки. */
  p: number;
  /** Скидка, сотые доли процента. */
  d: number;
  /** Остатки: название магазина → количество в тысячных. */
  q: Record<string, number>;
}

const DONE_KEY = 'catalog_seeded';

export function seedCatalog(db: SqlDriver): void {
  const done = db.get<{ value: string }>('SELECT value FROM app_state WHERE key = ?', [DONE_KEY]);
  if (done) return;

  const products = CATALOG as SeedProduct[];
  const now = new Date().toISOString();

  db.tx(() => {
    const locations = new Map<string, number>();

    for (const item of products) {
      const search = [item.n, item.s, item.c]
        .filter((v): v is string => Boolean(v?.trim()))
        .map((v) => v.trim().toLowerCase())
        .join(' ');

      db.run(
        `INSERT INTO products
           (name, sku, barcode, category_id, unit, cost_price, sale_price, min_qty,
            photo_uri, created_at, search_text)
         VALUES (?, ?, NULL, NULL, ?, 0, ?, 0, NULL, ?, ?)`,
        [item.n, item.s, item.u, item.p, now, search],
      );
      const productId = db.lastInsertId();

      for (const [store, qty] of Object.entries(item.q)) {
        // Ноль остатка движением не записываем: движения нет — и строки быть
        // не должно, иначе история засоряется пустыми записями.
        if (qty === 0) continue;

        let locationId = locations.get(store);
        if (locationId === undefined) {
          locationId = ensureLocation(db, store);
          locations.set(store, locationId);
        }

        // Инвентаризация, а не приход: в выгрузке остаток уже итоговый,
        // и «сколько пришло» из неё неизвестно.
        db.run(
          `INSERT INTO stock_moves (product_id, qty_delta, reason, price, created_at, location_id)
           VALUES (?, ?, 'adjust', 0, ?, ?)`,
          [productId, qty, now, locationId],
        );
      }
    }

    db.run('INSERT INTO app_state (key, value) VALUES (?, ?)', [DONE_KEY, now]);
  });
}

/** Сколько позиций в поставляемом каталоге — для сообщений и тестов. */
export const SEED_SIZE = (CATALOG as SeedProduct[]).length;
