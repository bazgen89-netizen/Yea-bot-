import type { SqlDriver } from './driver';
import type { DocLine, DocType, Id, StockMove } from '../domain/types';

export interface DocInput {
  type: DocType;
  counterparty?: string | null;
  note?: string | null;
  lines: DocLine[];
}

/**
 * Проводит документ прихода или списания одной транзакцией:
 * либо появляются и документ, и все движения, либо ничего.
 *
 * receipt  -> остаток растёт (qty_delta > 0)
 * writeoff -> остаток падает (qty_delta < 0)
 */
export function postDoc(db: SqlDriver, input: DocInput): Id {
  if (input.lines.length === 0) {
    throw new Error('Документ без позиций провести нельзя');
  }
  if (input.type === 'adjust') {
    throw new Error('Инвентаризация проводится через adjustStock()');
  }

  const sign = input.type === 'receipt' ? 1 : -1;
  const now = new Date().toISOString();

  return db.tx(() => {
    db.run('INSERT INTO docs (type, counterparty, note, created_at) VALUES (?, ?, ?, ?)', [
      input.type,
      input.counterparty?.trim() || null,
      input.note?.trim() || null,
      now,
    ]);
    const docId = db.lastInsertId();

    for (const line of input.lines) {
      if (line.qty <= 0) throw new Error(`Количество должно быть больше нуля: ${line.name}`);

      db.run(
        `INSERT INTO stock_moves (product_id, qty_delta, reason, doc_id, price, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [line.product_id, sign * line.qty, input.type, docId, line.price, now],
      );

      // Приход по новой цене обновляет закупочную цену товара: следующая продажа
      // должна считать прибыль по тому, что реально заплачено поставщику.
      if (input.type === 'receipt' && line.price > 0) {
        db.run('UPDATE products SET cost_price = ? WHERE id = ?', [line.price, line.product_id]);
      }
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
  counterparty: string | null;
  note: string | null;
  created_at: string;
  positions: number;
  /** Сумма документа в закупочных ценах, копейки. */
  amount: number;
}

/** Список документов прихода/списания/инвентаризации для журнала. */
export function listDocs(db: SqlDriver, limit = 50): DocSummary[] {
  return db.all<DocSummary>(
    `SELECT d.*,
            COUNT(m.id) AS positions,
            CAST(ROUND(COALESCE(SUM(ABS(m.qty_delta) * m.price), 0) / 1000.0) AS INTEGER) AS amount
     FROM docs d
     LEFT JOIN stock_moves m ON m.doc_id = d.id
     GROUP BY d.id
     ORDER BY d.id DESC
     LIMIT ?`,
    [limit],
  );
}
