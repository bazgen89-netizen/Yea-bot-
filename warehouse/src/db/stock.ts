import type { SqlDriver, SqlParam } from './driver';
import { currentStaffId } from './staff';
import { DOC_KIND_TYPE, type DocKind, type DocLine, type DocType, type Id, type StockMove } from '../domain/types';

export interface DocInput {
  /**
   * Вид документа. `DocType` тоже принимается — так вызывали раньше, и
   * закупка со списанием от этого не изменились.
   */
  type: DocKind | DocType;
  counterparty?: string | null;
  /**
   * Контрагент ссылкой. Имя остаётся для подписи документа, а по ссылке
   * считается статистика поставщика — имена меняются и повторяются.
   */
  counterpartyId?: Id | null;
  note?: string | null;
  /** Магазин, в котором проводится документ. */
  locationId?: Id | null;
  lines: DocLine[];
}

/**
 * Вид документа средствами SQL — то же правило, что в `docKind()`.
 *
 * Повторено на SQL, а не посчитано после выборки, потому что по виду идут
 * и сортировка, и группировка: разбирать вид в JavaScript значило бы сначала
 * получить строки в неверном порядке, а потом их переставлять.
 *
 * Запросы, которые это используют, обязаны называть таблицу документов `d`.
 */
export const KIND_SQL = `COALESCE(d.subtype, CASE d.type
   WHEN 'receipt'  THEN 'purchase'
   WHEN 'writeoff' THEN 'writeoff'
   ELSE 'adjustment' END)`;

/**
 * Одна сторона документа.
 *
 * У перемещения на каждую позицию два движения — расход в одном магазине и
 * приход в другом. Считать обе значило бы удвоить и число позиций, и сумму,
 * поэтому берётся расходная.
 */
export const ONE_SIDE = `(d.subtype IS NULL OR d.subtype <> 'transfer' OR m.qty_delta < 0)`;

/** Складское действие и вид — из того, что передали. */
function resolveKind(type: DocKind | DocType): { kind: DocKind; docType: DocType } {
  if (type === 'receipt') return { kind: 'purchase', docType: 'receipt' };
  if (type === 'adjust') return { kind: 'adjustment', docType: 'adjust' };
  const kind = type as DocKind;
  return { kind, docType: DOC_KIND_TYPE[kind] };
}

/**
 * Проводит складской документ одной транзакцией:
 * либо появляются и документ, и все движения, либо ничего.
 *
 * Приходующие виды растят остаток (qty_delta > 0), расходные — уменьшают.
 */
export function postDoc(db: SqlDriver, input: DocInput): Id {
  if (input.lines.length === 0) {
    throw new Error('Документ без позиций провести нельзя');
  }

  const { kind, docType } = resolveKind(input.type);

  if (kind === 'inventory') {
    throw new Error('Инвентаризация проводится через postInventory()');
  }
  if (kind === 'adjustment') {
    throw new Error('Корректировка проводится через postAdjustment()');
  }
  if (kind === 'transfer') {
    throw new Error('Перемещение проводится через postTransfer()');
  }

  const sign = docType === 'receipt' ? 1 : -1;
  const now = new Date().toISOString();

  return db.tx(() => {
    db.run(
      `INSERT INTO docs (type, subtype, counterparty, counterparty_id, note,
                         location_id, staff_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        docType,
        kind,
        input.counterparty?.trim() || null,
        input.counterpartyId ?? null,
        input.note?.trim() || null,
        input.locationId ?? null,
        currentStaffId(db),
        now,
      ],
    );
    const docId = db.lastInsertId();

    for (const line of input.lines) {
      if (line.qty <= 0) throw new Error(`Количество должно быть больше нуля: ${line.name}`);

      // Себестоимость усредняется до записи движения: усреднять надо то, что
      // лежало на складе раньше, с тем, что приехало сейчас. Если считать
      // после записи, привезённое попадёт в расчёт дважды.
      if (kind === 'purchase' && line.price > 0) {
        averageCost(db, line.product_id, line.qty, line.price);
        db.run('UPDATE products SET purchase_price = ? WHERE id = ?', [
          line.price,
          line.product_id,
        ]);
      }

      db.run(
        `INSERT INTO stock_moves (product_id, qty_delta, reason, doc_id, price, location_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          line.product_id,
          sign * line.qty,
          docType,
          docId,
          line.price,
          input.locationId ?? null,
          now,
        ],
      );
    }

    return docId;
  });
}

/**
 * Пересчёт себестоимости по среднему — так же, как в исходном приложении.
 * Его собственное объяснение: «себестоимость считается по среднему и
 * корректируется при каждой закупке товара или оприходовании».
 *
 * Считается до записи движения этой закупки: усредняется то, что лежало на
 * складе раньше, с тем, что приехало сейчас.
 *
 *   новая = (остаток × старая + пришло × цена) / (остаток + пришло)
 *
 * Отрицательный остаток в расчёт не берётся: товар «минус двести» с ценой
 * дал бы отрицательную себестоимость, а такой не бывает — при минусе просто
 * запоминаем цену последней закупки.
 */
export function averageCost(db: SqlDriver, productId: Id, incoming: number, price: number): void {
  const row = db.get<{ cost_price: number }>(
    'SELECT cost_price FROM products WHERE id = ?',
    [productId],
  );
  if (!row) return;

  // Остаток по всем магазинам: себестоимость у товара одна и не зависит от
  // того, на какой полке он лежит.
  const before = getStock(db, productId);

  const cost =
    before > 0
      ? Math.round((before * row.cost_price + incoming * price) / (before + incoming))
      : price;

  db.run('UPDATE products SET cost_price = ? WHERE id = ?', [cost, productId]);
}

export interface TransferInput {
  from: Id;
  to: Id;
  note?: string | null;
  lines: DocLine[];
}

/**
 * Перемещение между магазинами: один документ, на каждую позицию два движения.
 *
 * Двумя движениями, а не одним с двумя магазинами: остаток каждой точки — это
 * сумма её движений, и товар должен уйти из одной ровно тогда, когда пришёл
 * в другую. Одной записью такое не выразить, не заведя второй способ считать
 * остаток.
 */
export function postTransfer(db: SqlDriver, input: TransferInput): Id {
  if (input.lines.length === 0) throw new Error('Документ без позиций провести нельзя');
  if (input.from === input.to) throw new Error('Магазины отправителя и получателя совпадают');

  const now = new Date().toISOString();

  return db.tx(() => {
    db.run(
      `INSERT INTO docs (type, subtype, note, location_id, location_to, staff_id, created_at)
       VALUES ('writeoff', 'transfer', ?, ?, ?, ?, ?)`,
      [input.note?.trim() || null, input.from, input.to, currentStaffId(db), now],
    );
    const docId = db.lastInsertId();

    for (const line of input.lines) {
      if (line.qty <= 0) throw new Error(`Количество должно быть больше нуля: ${line.name}`);

      db.run(
        `INSERT INTO stock_moves (product_id, qty_delta, reason, doc_id, price, location_id, created_at)
         VALUES (?, ?, 'writeoff', ?, ?, ?, ?)`,
        [line.product_id, -line.qty, docId, line.price, input.from, now],
      );
      db.run(
        `INSERT INTO stock_moves (product_id, qty_delta, reason, doc_id, price, location_id, created_at)
         VALUES (?, ?, 'receipt', ?, ?, ?, ?)`,
        [line.product_id, line.qty, docId, line.price, input.to, now],
      );
    }

    return docId;
  });
}

/**
 * Инвентаризация: выставляет остаток товара равным факту.
 * Записывает разницу как движение — история пересчёта сохраняется.
 * Возвращает величину корректировки (0, если расхождения нет).
 */
export function adjustStock(db: SqlDriver, productId: Id, actualQty: number, note?: string): number {
  const now = new Date().toISOString();

  return db.tx(() => {
    const current = getStock(db, productId);
    const delta = actualQty - current;
    if (delta === 0) return 0;

    db.run('INSERT INTO docs (type, note, created_at) VALUES (?, ?, ?)', [
      'adjust',
      note?.trim() || null,
      now,
    ]);
    const docId = db.lastInsertId();

    db.run(
      `INSERT INTO stock_moves (product_id, qty_delta, reason, doc_id, created_at)
       VALUES (?, ?, 'adjust', ?, ?)`,
      [productId, delta, docId, now],
    );

    return delta;
  });
}

/** Строка пересчёта: сколько насчитали по факту. */
export interface CountLine {
  product_id: Id;
  name: string;
  unit: string;
  /** Фактическое количество, тысячные. */
  actual: number;
  /** Себестоимость за единицу — по ней оценивается расхождение. */
  price?: number;
}

export interface InventoryInput {
  locationId?: Id | null;
  note?: string | null;
  lines: CountLine[];
}

/**
 * Инвентаризация целым документом.
 *
 * До этого пересчёт делался по одному товару прямо в карточке, и документа
 * после него не оставалось — только россыпь движений «adjust», по которым
 * нельзя сказать, что это была одна ревизия одного дня.
 *
 * Позиции без расхождения тоже записываются, движением на ноль: документ —
 * это ведомость пересчёта, и «пересчитали, сошлось» в ней такой же
 * осмысленный результат, как недостача.
 */
export function postInventory(db: SqlDriver, input: InventoryInput): Id {
  if (input.lines.length === 0) throw new Error('Документ без позиций провести нельзя');

  const now = new Date().toISOString();

  return db.tx(() => {
    db.run(
      `INSERT INTO docs (type, subtype, note, location_id, staff_id, created_at)
       VALUES ('adjust', 'inventory', ?, ?, ?, ?)`,
      [input.note?.trim() || null, input.locationId ?? null, currentStaffId(db), now],
    );
    const docId = db.lastInsertId();

    for (const line of input.lines) {
      if (line.actual < 0) {
        throw new Error(`Фактический остаток не может быть отрицательным: ${line.name}`);
      }

      const current = stockAt(db, line.product_id, input.locationId ?? null);

      db.run(
        `INSERT INTO stock_moves (product_id, qty_delta, reason, doc_id, price, location_id, created_at)
         VALUES (?, ?, 'adjust', ?, ?, ?, ?)`,
        [line.product_id, line.actual - current, docId, line.price ?? 0, input.locationId ?? null, now],
      );
    }

    return docId;
  });
}

/** Строка корректировки: на сколько подвинуть остаток. */
export interface AdjustLine {
  product_id: Id;
  name: string;
  unit: string;
  /** Плюс — прибавить, минус — убавить. Тысячные. */
  delta: number;
  price?: number;
}

/**
 * Корректировка — прямая правка остатка на заданную величину.
 *
 * Отличается от инвентаризации тем, с чего начинается: в инвентаризации
 * называют факт и разницу считает программа, в корректировке называют саму
 * разницу. Смешивать их в одном документе нельзя — по ним по-разному
 * разбирают недостачу.
 */
export function postAdjustment(
  db: SqlDriver,
  input: { locationId?: Id | null; note?: string | null; lines: AdjustLine[] },
): Id {
  if (input.lines.length === 0) throw new Error('Документ без позиций провести нельзя');

  const now = new Date().toISOString();

  return db.tx(() => {
    db.run(
      `INSERT INTO docs (type, subtype, note, location_id, staff_id, created_at)
       VALUES ('adjust', 'adjustment', ?, ?, ?, ?)`,
      [input.note?.trim() || null, input.locationId ?? null, currentStaffId(db), now],
    );
    const docId = db.lastInsertId();

    for (const line of input.lines) {
      if (line.delta === 0) continue;

      db.run(
        `INSERT INTO stock_moves (product_id, qty_delta, reason, doc_id, price, location_id, created_at)
         VALUES (?, ?, 'adjust', ?, ?, ?, ?)`,
        [line.product_id, line.delta, docId, line.price ?? 0, input.locationId ?? null, now],
      );
    }

    return docId;
  });
}

/**
 * Остаток товара в одном магазине; без магазина — общий.
 *
 * Нужен инвентаризации: пересчитывают полку в конкретной точке, и сравнивать
 * найденное с суммой по всем точкам значило бы списать чужой товар.
 */
export function stockAt(db: SqlDriver, productId: Id, locationId: Id | null): number {
  if (locationId == null) return getStock(db, productId);

  const row = db.get<{ stock: number }>(
    `SELECT COALESCE(SUM(qty_delta), 0) AS stock
     FROM stock_moves WHERE product_id = ? AND location_id = ?`,
    [productId, locationId],
  );
  return row?.stock ?? 0;
}

export function getStock(db: SqlDriver, productId: Id): number {
  const row = db.get<{ stock: number }>(
    'SELECT COALESCE(SUM(qty_delta), 0) AS stock FROM stock_moves WHERE product_id = ?',
    [productId],
  );
  return row?.stock ?? 0;
}

export interface MoveWithContext extends StockMove {
  product_name: string;
  unit: string;
  counterparty: string | null;
  /** В каком магазине двигался товар. */
  location_name: string | null;
  /** Кто провёл документ или пробил чек. */
  author: string | null;
  /** Номер документа или чека. */
  document_id: Id | null;
}

/** История движений товара — «откуда взялись эти 3 штуки». */
export function listMoves(db: SqlDriver, productId: Id, limit = 100): MoveWithContext[] {
  return db.all<MoveWithContext>(
    `SELECT m.*, p.name AS product_name, p.unit, d.counterparty,
            -- В каком магазине двигался товар. У движений, записанных до
            -- появления магазинов, точки нет — там останется пусто.
            (SELECT l.name FROM locations l WHERE l.id = m.location_id) AS location_name,
            -- Кто это сделал: у документа свой автор, у чека свой.
            COALESCE(
              (SELECT f.name FROM staff f WHERE f.id = d.staff_id),
              (SELECT f.name FROM staff f WHERE f.id = s.staff_id)
            ) AS author,
            -- Номер документа или чека — по нему движение можно открыть.
            COALESCE(m.doc_id, m.sale_id) AS document_id
     FROM stock_moves m
     JOIN products p ON p.id = m.product_id
     LEFT JOIN docs  d ON d.id = m.doc_id
     LEFT JOIN sales s ON s.id = m.sale_id
     WHERE m.product_id = ?
     ORDER BY m.id DESC
     LIMIT ?`,
    [productId, limit],
  );
}

export interface DocSummary {
  id: Id;
  type: DocType;
  subtype: DocKind | null;
  counterparty: string | null;
  note: string | null;
  created_at: string;
  positions: number;
  /** Сумма документа в закупочных ценах, копейки. */
  amount: number;
}

/** Позиция документа так, как она записана в движениях. */
export interface DocPosition {
  product_id: Id;
  name: string;
  unit: string;
  /** Всегда положительное: направление документа известно из его вида. */
  qty: number;
  price: number;
  /** Цена × количество, копейки. */
  sum: number;
}

export interface DocDetails extends DocSummary {
  location_id: Id | null;
  location_to: Id | null;
  location_name: string | null;
  location_to_name: string | null;
  positions_list: DocPosition[];
}

/**
 * Документ целиком — то, ради чего в журнале нажимают на строку.
 *
 * Позиции восстанавливаются из движений, а не хранятся отдельной таблицей:
 * движение и есть позиция документа, и вторая копия рано или поздно разошлась
 * бы с первой. У перемещения берётся одна сторона — иначе каждая позиция
 * показалась бы дважды.
 */
export function getDoc(db: SqlDriver, id: Id): DocDetails | null {
  const doc = db.get<DocSummary & { location_id: Id | null; location_to: Id | null }>(
    `SELECT d.*,
            COUNT(m.id) AS positions,
            CAST(ROUND(COALESCE(SUM(ABS(m.qty_delta) * m.price), 0) / 1000.0) AS INTEGER) AS amount
     FROM docs d
     LEFT JOIN stock_moves m ON m.doc_id = d.id AND ${ONE_SIDE}
     WHERE d.id = ?
     GROUP BY d.id`,
    [id],
  );
  if (!doc) return null;

  const positions = db.all<DocPosition>(
    `SELECT m.product_id,
            p.name,
            p.unit,
            ABS(m.qty_delta) AS qty,
            m.price,
            CAST(ROUND(ABS(m.qty_delta) * m.price / 1000.0) AS INTEGER) AS sum
     FROM stock_moves m
     JOIN products p ON p.id = m.product_id
     JOIN docs d ON d.id = m.doc_id
     WHERE m.doc_id = ? AND ${ONE_SIDE}
     ORDER BY m.id`,
    [id],
  );

  const names = db.get<{ from_name: string | null; to_name: string | null }>(
    `SELECT lf.name AS from_name, lt.name AS to_name
     FROM docs d
     LEFT JOIN locations lf ON lf.id = d.location_id
     LEFT JOIN locations lt ON lt.id = d.location_to
     WHERE d.id = ?`,
    [id],
  );

  return {
    ...doc,
    location_name: names?.from_name ?? null,
    location_to_name: names?.to_name ?? null,
    positions_list: positions,
  };
}

/**
 * Отмена документа: он и его движения исчезают вместе.
 *
 * Не правкой остатка обратным документом: отменённая закупка не должна
 * оставлять след в отчёте о движении. Правку цены товара закупкой отмена
 * не откатывает — прежнюю цену никто не записывал, и выдумывать её нельзя.
 */
export function cancelDoc(db: SqlDriver, id: Id): void {
  db.tx(() => {
    db.run('DELETE FROM stock_moves WHERE doc_id = ?', [id]);
    db.run('DELETE FROM docs WHERE id = ?', [id]);
  });
}

/** Список складских документов для журнала. */
export function listDocs(db: SqlDriver, limit = 50): DocSummary[] {
  return db.all<DocSummary>(
    `SELECT d.*,
            COUNT(m.id) AS positions,
            CAST(ROUND(COALESCE(SUM(ABS(m.qty_delta) * m.price), 0) / 1000.0) AS INTEGER) AS amount
     FROM docs d
     LEFT JOIN stock_moves m ON m.doc_id = d.id AND ${ONE_SIDE}
     GROUP BY d.id
     ORDER BY d.id DESC
     LIMIT ?`,
    [limit],
  );
}

/**
 * Движение товара по одному товару — его вкладка «История движения».
 *
 * Колонки взяты из их же шаблона
 * (`js/pages/card/catalog/show/blocks/history.html`): дата, документ с
 * автором под ним, себестоимость, цена, приход, расход и остаток после
 * движения. Приход и расход — две отдельные колонки, а не одно число со
 * знаком: так в кабинете видно, чего у товара было больше.
 *
 * Отбор — тот же, что и у него в этой вкладке: дата, магазин, тип
 * документа, сотрудник. И та же листалка «показать еще» по двадцать строк.
 */
export interface ProductMove {
  id: Id;
  created_at: string;
  /** Сколько прибавилось или убавилось, тысячные. */
  qty_delta: number;
  /** Остаток после этого движения, тысячные. */
  qty_after: number;
  /** Цена движения, копейки. */
  price: number;
  /** Себестоимость на момент чека. У складских документов её нет. */
  cost: number | null;
  /** Вид документа — им строка и подписана: «Продажа #45967». */
  kind: JournalMoveKind;
  /** Номер документа или чека — свой, если он есть. */
  number: number | null;
  /** Чем открыть: чек или складской документ. */
  sale_id: Id | null;
  doc_id: Id | null;
  location_name: string | null;
  author: string | null;
}

/** Виды, которыми подписана строка истории. Те же, что в журнале. */
export type JournalMoveKind = DocKind | 'refund';

export interface ProductMovesFilter {
  from?: string;
  to?: string;
  location?: string;
  kind?: JournalMoveKind;
  author?: string;
}

/**
 * Как собирается остаток после движения.
 *
 * Не хранится — считается тем же способом, что и весь остаток: суммой
 * движений по этот момент включительно. Пара «время, номер строки» нужна
 * потому, что за одну секунду движений бывает несколько: у чека на пять
 * позиций время у всех пяти одно.
 *
 * Магазин — единственный отбор, который в этот подсчёт входит: остаток по
 * магазину и остаток по всем магазинам — разные числа, и подписывать одно
 * другим нельзя. Отбор по виду документа в подсчёт не входит вовсе: остаток
 * не зависит от того, что мы решили показать.
 */
function movesWhere(filter: ProductMovesFilter): { sql: string; params: SqlParam[] } {
  const where: string[] = [];
  const params: SqlParam[] = [];

  if (filter.from) {
    where.push('date(m.created_at) >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    where.push('date(m.created_at) <= ?');
    params.push(filter.to);
  }
  if (filter.location) {
    where.push('(SELECT l.name FROM locations l WHERE l.id = m.location_id) = ?');
    params.push(filter.location);
  }
  if (filter.author) {
    where.push(`COALESCE(
      (SELECT f.name FROM staff f WHERE f.id = d.staff_id),
      (SELECT f.name FROM staff f WHERE f.id = s.staff_id),
      s.author
    ) = ?`);
    params.push(filter.author);
  }
  if (filter.kind) {
    where.push(`CASE
      WHEN m.sale_id IS NOT NULL
        THEN (CASE WHEN s.is_return = 1 THEN 'refund' ELSE 'sale' END)
      ELSE ${KIND_SQL} END = ?`);
    params.push(filter.kind);
  }

  return { sql: where.length ? `AND ${where.join(' AND ')}` : '', params };
}

export function productMoves(
  db: SqlDriver,
  productId: Id,
  filter: ProductMovesFilter = {},
  limit = 20,
  offset = 0,
): ProductMove[] {
  const { sql, params } = movesWhere(filter);

  return db.all<ProductMove>(
    `SELECT m.id, m.created_at, m.qty_delta, m.price,
            -- Остаток после движения: сумма всех движений по этот момент.
            (SELECT COALESCE(SUM(e.qty_delta), 0) FROM stock_moves e
              WHERE e.product_id = m.product_id
                ${filter.location ? 'AND e.location_id = m.location_id' : ''}
                AND (e.created_at < m.created_at
                     OR (e.created_at = m.created_at AND e.id <= m.id))) AS qty_after,
            -- Себестоимость записана в строке чека: у складского документа
            -- её нет вовсе, и подставлять нынешнюю из карточки нельзя —
            -- она к тому дню не имеет отношения.
            (SELECT i.cost_price FROM sale_items i
              WHERE i.sale_id = m.sale_id AND i.product_id = m.product_id
              LIMIT 1)                                                    AS cost,
            CASE WHEN m.sale_id IS NOT NULL
                 THEN (CASE WHEN s.is_return = 1 THEN 'refund' ELSE 'sale' END)
                 ELSE ${KIND_SQL} END                                     AS kind,
            COALESCE(s.number, CAST(NULLIF(d.number, '') AS INTEGER))     AS number,
            m.sale_id, m.doc_id,
            (SELECT l.name FROM locations l WHERE l.id = m.location_id)   AS location_name,
            COALESCE(
              (SELECT f.name FROM staff f WHERE f.id = d.staff_id),
              (SELECT f.name FROM staff f WHERE f.id = s.staff_id),
              s.author
            )                                                             AS author
       FROM stock_moves m
       LEFT JOIN docs  d ON d.id = m.doc_id
       LEFT JOIN sales s ON s.id = m.sale_id
      WHERE m.product_id = ? ${sql}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ? OFFSET ?`,
    [productId, ...params, limit, offset],
  );
}

/** Сколько всего движений у товара — его «Всего документов: 128». */
export function productMovesCount(
  db: SqlDriver,
  productId: Id,
  filter: ProductMovesFilter = {},
): number {
  const { sql, params } = movesWhere(filter);

  return (
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n
         FROM stock_moves m
         LEFT JOIN docs  d ON d.id = m.doc_id
         LEFT JOIN sales s ON s.id = m.sale_id
        WHERE m.product_id = ? ${sql}`,
      [productId, ...params],
    )?.n ?? 0
  );
}

/** Что предложить в отборе истории: магазины и сотрудники этого товара. */
export function productMoveOptions(
  db: SqlDriver,
  productId: Id,
): { locations: string[]; authors: string[] } {
  const list = (sql: string) =>
    db
      .all<{ value: string | null }>(sql, [productId])
      .map((row) => row.value)
      .filter((value): value is string => Boolean(value?.trim()));

  return {
    locations: list(
      `SELECT DISTINCT (SELECT l.name FROM locations l WHERE l.id = m.location_id) AS value
         FROM stock_moves m WHERE m.product_id = ? ORDER BY value COLLATE NOCASE`,
    ),
    authors: list(
      `SELECT DISTINCT COALESCE(
                (SELECT f.name FROM staff f WHERE f.id = d.staff_id),
                (SELECT f.name FROM staff f WHERE f.id = s.staff_id),
                s.author
              ) AS value
         FROM stock_moves m
         LEFT JOIN docs  d ON d.id = m.doc_id
         LEFT JOIN sales s ON s.id = m.sale_id
        WHERE m.product_id = ? ORDER BY value COLLATE NOCASE`,
    ),
  };
}
