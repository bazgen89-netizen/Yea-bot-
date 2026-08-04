import { randomUUID } from 'node:crypto';

import type { SqlDb } from '../db/driver.ts';
import { assertLocation } from './catalog.ts';
import { badRequest, notFound } from './errors.ts';
import { reserveSeq } from './seq.ts';

export type DocType = 'receipt' | 'writeoff' | 'adjust' | 'transfer';
export type MoveReason = 'receipt' | 'writeoff' | 'sale' | 'adjust' | 'return' | 'transfer';

export interface DocLineInput {
  product_id: string;
  /** Тысячные, всегда положительное: направление задаёт тип документа. */
  qty: number;
  /** Закупочная цена за единицу, копейки. */
  price?: number;
}

export interface DocInput {
  id?: string;
  type: Exclude<DocType, 'adjust'>;
  location_id: string;
  /** Только для перемещения — точка назначения. */
  to_location_id?: string | null;
  counterparty?: string | null;
  /** Поставщик из справочника. Название в counterparty остаётся для разовых. */
  supplier_id?: string | null;
  note?: string | null;
  lines: DocLineInput[];
  created_at?: string;
}

export interface Doc {
  id: string;
  org_id: string;
  location_id: string;
  type: DocType;
  to_location_id: string | null;
  counterparty: string | null;
  supplier_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  seq: number;
}

/**
 * Проводит приход, списание или перемещение одной транзакцией: либо появляются
 * и документ, и все движения, либо ничего.
 *
 * Перемещение пишет два движения на позицию — минус на исходной точке и плюс
 * на целевой. Общий остаток по организации при этом не меняется, что и должно
 * быть: товар не появился и не исчез, он переехал.
 */
export async function postDoc(
  db: SqlDb,
  orgId: string,
  userId: string | null,
  input: DocInput,
): Promise<Doc> {
  if (input.lines.length === 0) throw badRequest('Документ без позиций провести нельзя');

  for (const line of input.lines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw badRequest('Количество в позиции должно быть целым числом больше нуля');
    }
  }

  if (input.type === 'transfer') {
    if (!input.to_location_id) throw badRequest('Для перемещения нужна точка назначения');
    if (input.to_location_id === input.location_id) {
      throw badRequest('Точка назначения совпадает с исходной');
    }
    await assertLocation(db, orgId, input.to_location_id);
  }

  await assertLocation(db, orgId, input.location_id);

  const createdAt = input.created_at ?? new Date().toISOString();
  const movesPerLine = input.type === 'transfer' ? 2 : 1;

  return db.tx(async (tx) => {
    const seqs = await reserveSeq(tx, orgId, 1 + input.lines.length * movesPerLine);
    let cursor = 0;

    const doc = await tx.one<Doc>(
      `INSERT INTO docs (id, org_id, location_id, type, to_location_id,
                         counterparty, supplier_id, note, created_by, created_at, seq)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        input.id ?? randomUUID(),
        orgId,
        input.location_id,
        input.type,
        input.to_location_id ?? null,
        input.counterparty?.trim() || null,
        input.supplier_id ?? null,
        input.note?.trim() || null,
        userId,
        createdAt,
        seqs[cursor++],
      ],
    );

    for (const line of input.lines) {
      const price = line.price ?? 0;
      const sign = input.type === 'receipt' ? 1 : -1;

      await insertMove(tx, {
        orgId,
        locationId: input.location_id,
        productId: line.product_id,
        qtyDelta: sign * line.qty,
        reason: input.type === 'transfer' ? 'transfer' : input.type,
        docId: doc!.id,
        price,
        userId,
        createdAt,
        seq: seqs[cursor++],
      });

      if (input.type === 'transfer') {
        await insertMove(tx, {
          orgId,
          locationId: input.to_location_id!,
          productId: line.product_id,
          qtyDelta: line.qty,
          reason: 'transfer',
          docId: doc!.id,
          price,
          userId,
          createdAt,
          seq: seqs[cursor++],
        });
      }

      // Приход по новой цене обновляет закупочную цену товара: прибыль должна
      // считаться по тому, что реально заплачено поставщику.
      if (input.type === 'receipt' && price > 0) {
        const seqForProduct = await reserveSeq(tx, orgId, 1);
        await tx.query(
          'UPDATE products SET cost_price = $3, updated_at = now(), seq = $4 WHERE id = $1 AND org_id = $2',
          [line.product_id, orgId, price, seqForProduct[0]],
        );
      }
    }

    return doc!;
  });
}

interface MoveInsert {
  orgId: string;
  locationId: string;
  productId: string;
  qtyDelta: number;
  reason: MoveReason;
  docId?: string | null;
  saleId?: string | null;
  price: number;
  userId: string | null;
  createdAt: string;
  seq: number;
  id?: string;
}

async function insertMove(db: SqlDb, move: MoveInsert): Promise<void> {
  await db.query(
    `INSERT INTO stock_moves
       (id, org_id, location_id, product_id, qty_delta, reason, doc_id, sale_id,
        price, created_by, created_at, seq)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      move.id ?? randomUUID(),
      move.orgId,
      move.locationId,
      move.productId,
      move.qtyDelta,
      move.reason,
      move.docId ?? null,
      move.saleId ?? null,
      move.price,
      move.userId,
      move.createdAt,
      move.seq,
    ],
  );
}

export { insertMove };

/**
 * Инвентаризация: выставляет остаток товара на точке равным факту.
 * Пишет разницу движением, поэтому пересчёт остаётся в истории.
 * Возвращает величину корректировки (0, если расхождения нет).
 */
export async function adjustStock(
  db: SqlDb,
  orgId: string,
  userId: string | null,
  input: { product_id: string; location_id: string; actual_qty: number; note?: string },
): Promise<{ delta: number; doc: Doc | null }> {
  if (!Number.isInteger(input.actual_qty) || input.actual_qty < 0) {
    throw badRequest('Фактический остаток должен быть целым числом не меньше нуля');
  }
  await assertLocation(db, orgId, input.location_id);

  return db.tx(async (tx) => {
    const current = await getStock(tx, orgId, input.product_id, input.location_id);
    const delta = input.actual_qty - current;
    if (delta === 0) return { delta: 0, doc: null };

    const createdAt = new Date().toISOString();
    const seqs = await reserveSeq(tx, orgId, 2);

    const doc = await tx.one<Doc>(
      `INSERT INTO docs (id, org_id, location_id, type, note, created_by, created_at, seq)
       VALUES ($1, $2, $3, 'adjust', $4, $5, $6, $7)
       RETURNING *`,
      [randomUUID(), orgId, input.location_id, input.note?.trim() || null, userId, createdAt, seqs[0]],
    );

    await insertMove(tx, {
      orgId,
      locationId: input.location_id,
      productId: input.product_id,
      qtyDelta: delta,
      reason: 'adjust',
      docId: doc!.id,
      price: 0,
      userId,
      createdAt,
      seq: seqs[1],
    });

    return { delta, doc: doc! };
  });
}

export async function getStock(
  db: SqlDb,
  orgId: string,
  productId: string,
  locationId?: string,
): Promise<number> {
  const params: unknown[] = [orgId, productId];
  let filter = '';
  if (locationId) {
    params.push(locationId);
    filter = ' AND location_id = $3';
  }

  const row = await db.one<{ stock: number }>(
    `SELECT COALESCE(SUM(qty_delta), 0)::bigint AS stock
     FROM stock_moves
     WHERE org_id = $1 AND product_id = $2${filter}`,
    params,
  );
  return Number(row?.stock ?? 0);
}

export interface StockByLocation {
  location_id: string;
  location_name: string;
  stock: number;
}

/** Остатки одного товара в разрезе точек — «где именно лежит этот чай». */
export async function stockByLocation(
  db: SqlDb,
  orgId: string,
  productId: string,
): Promise<StockByLocation[]> {
  return db.query<StockByLocation>(
    `SELECT l.id AS location_id, l.name AS location_name,
            COALESCE(SUM(m.qty_delta), 0)::bigint AS stock
     FROM locations l
     LEFT JOIN stock_moves m ON m.location_id = l.id AND m.product_id = $2
     WHERE l.org_id = $1 AND l.archived = false
     GROUP BY l.id, l.name
     ORDER BY l.name`,
    [orgId, productId],
  );
}

export interface MoveWithContext {
  id: string;
  product_id: string;
  product_name: string;
  unit: string;
  location_id: string;
  location_name: string;
  qty_delta: number;
  reason: MoveReason;
  price: number;
  created_at: string;
  counterparty: string | null;
  user_name: string | null;
}

export async function listMoves(
  db: SqlDb,
  orgId: string,
  filter: { productId?: string; locationId?: string; limit?: number },
): Promise<MoveWithContext[]> {
  const params: unknown[] = [orgId];
  const where = ['m.org_id = $1'];

  if (filter.productId) {
    params.push(filter.productId);
    where.push(`m.product_id = $${params.length}`);
  }
  if (filter.locationId) {
    params.push(filter.locationId);
    where.push(`m.location_id = $${params.length}`);
  }

  params.push(Math.min(filter.limit ?? 100, 500));

  return db.query<MoveWithContext>(
    `SELECT m.id, m.product_id, p.name AS product_name, p.unit,
            m.location_id, l.name AS location_name,
            m.qty_delta, m.reason, m.price, m.created_at,
            d.counterparty, u.name AS user_name
     FROM stock_moves m
     JOIN products p  ON p.id = m.product_id
     JOIN locations l ON l.id = m.location_id
     LEFT JOIN docs d ON d.id = m.doc_id
     LEFT JOIN users u ON u.id = m.created_by
     WHERE ${where.join(' AND ')}
     ORDER BY m.seq DESC
     LIMIT $${params.length}`,
    params,
  );
}

export interface DocSummary extends Doc {
  location_name: string;
  to_location_name: string | null;
  user_name: string | null;
  positions: number;
  /** Сумма документа в закупочных ценах, копейки. */
  amount: number;
}

export async function listDocs(
  db: SqlDb,
  orgId: string,
  filter: { locationId?: string; limit?: number } = {},
): Promise<DocSummary[]> {
  const params: unknown[] = [orgId];
  const where = ['d.org_id = $1'];

  if (filter.locationId) {
    params.push(filter.locationId);
    where.push(`d.location_id = $${params.length}`);
  }
  params.push(Math.min(filter.limit ?? 100, 500));

  return db.query<DocSummary>(
    `SELECT d.*,
            l.name  AS location_name,
            tl.name AS to_location_name,
            u.name  AS user_name,
            (SELECT COUNT(DISTINCT m.product_id) FROM stock_moves m WHERE m.doc_id = d.id)
              ::int AS positions,
            COALESCE((
              SELECT ROUND(SUM(ABS(m.qty_delta) * m.price) / 1000.0)
              FROM stock_moves m
              WHERE m.doc_id = d.id
                -- У перемещения на каждую позицию два движения; считаем только
                -- расход, иначе сумма документа удвоится.
                AND (d.type <> 'transfer' OR m.qty_delta < 0)
            ), 0)::bigint AS amount
     FROM docs d
     JOIN locations l       ON l.id = d.location_id
     LEFT JOIN locations tl ON tl.id = d.to_location_id
     LEFT JOIN users u      ON u.id = d.created_by
     WHERE ${where.join(' AND ')}
     ORDER BY d.seq DESC
     LIMIT $${params.length}`,
    params,
  );
}

export async function getDoc(db: SqlDb, orgId: string, id: string): Promise<DocSummary> {
  const rows = await db.query<DocSummary>(
    `SELECT d.*, l.name AS location_name, tl.name AS to_location_name, u.name AS user_name,
            0::int AS positions, 0::bigint AS amount
     FROM docs d
     JOIN locations l       ON l.id = d.location_id
     LEFT JOIN locations tl ON tl.id = d.to_location_id
     LEFT JOIN users u      ON u.id = d.created_by
     WHERE d.org_id = $1 AND d.id = $2`,
    [orgId, id],
  );
  if (rows.length === 0) throw notFound('Документ не найден');
  return rows[0];
}
