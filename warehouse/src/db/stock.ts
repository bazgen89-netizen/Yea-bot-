import type { SqlDriver } from './driver';
import { DOC_KIND_TYPE, type DocKind, type DocLine, type DocType, type Id, type StockMove } from '../domain/types';

export interface DocInput {
  /**
   * Вид документа. `DocType` тоже принимается — так вызывали раньше, и
   * закупка со списанием от этого не изменились.
   */
  type: DocKind | DocType;
  counterparty?: string | null;
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

  if (kind === 'adjustment' || kind === 'inventory') {
    throw new Error('Инвентаризация проводится через adjustStock()');
  }
  if (kind === 'transfer') {
    throw new Error('Перемещение проводится через postTransfer()');
  }

  const sign = docType === 'receipt' ? 1 : -1;
  const now = new Date().toISOString();

  return db.tx(() => {
    db.run(
      `INSERT INTO docs (type, subtype, counterparty, note, location_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        docType,
        kind,
        input.counterparty?.trim() || null,
        input.note?.trim() || null,
        input.locationId ?? null,
        now,
      ],
    );
    const docId = db.lastInsertId();

    for (const line of input.lines) {
      if (line.qty <= 0) throw new Error(`Количество должно быть больше нуля: ${line.name}`);

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

      // Закупка по новой цене обновляет закупочную цену товара: следующая продажа
      // должна считать прибыль по тому, что реально заплачено поставщику.
      // Оприходование цену не трогает — там она взята из головы, а не из счёта.
      if (kind === 'purchase' && line.price > 0) {
        db.run('UPDATE products SET cost_price = ? WHERE id = ?', [line.price, line.product_id]);
      }
    }

    return docId;
  });
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
      `INSERT INTO docs (type, subtype, note, location_id, location_to, created_at)
       VALUES ('writeoff', 'transfer', ?, ?, ?, ?)`,
      [input.note?.trim() || null, input.from, input.to, now],
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
}

/** История движений товара — «откуда взялись эти 3 штуки». */
export function listMoves(db: SqlDriver, productId: Id, limit = 100): MoveWithContext[] {
  return db.all<MoveWithContext>(
    `SELECT m.*, p.name AS product_name, p.unit, d.counterparty
     FROM stock_moves m
     JOIN products p ON p.id = m.product_id
     LEFT JOIN docs d ON d.id = m.doc_id
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
