import { randomUUID } from 'node:crypto';

import type { SqlDb } from '../db/driver.ts';
import { saleTotals, type SaleLineInput } from './amounts.ts';
import { assertLocation } from './catalog.ts';
import { badRequest, conflict, notFound } from './errors.ts';
import { insertMove } from './stock.ts';
import { reserveSeq } from './seq.ts';

export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'credit';

export interface SaleInput {
  id?: string;
  location_id: string;
  /** Покупатель. Обязателен для продажи в долг — иначе долг не за кем числить. */
  customer_id?: string | null;
  lines: SaleLineInput[];
  /** Скидка на весь чек, копейки. */
  discount?: number;
  payment?: PaymentMethod;
  created_at?: string;
}

export interface Sale {
  id: string;
  org_id: string;
  location_id: string;
  discount: number;
  total: number;
  cost_total: number;
  payment: PaymentMethod;
  customer_id: string | null;
  created_by: string | null;
  created_at: string;
  refunded_at: string | null;
  seq: number;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  qty: number;
  price: number;
  cost_price: number;
}

export interface Shortage {
  product_id: string;
  name: string;
  requested: number;
  available: number;
}

export class OutOfStockError extends Error {
  readonly shortages: Shortage[];

  constructor(shortages: Shortage[]) {
    super('Не хватает товара на складе');
    this.name = 'OutOfStockError';
    this.shortages = shortages;
  }
}

/**
 * Проводит продажу: чек, позиции и списание остатков — одной транзакцией.
 *
 * Остаток берётся из базы прямо здесь, а не из того, что прислал клиент.
 * Телефон мог быть офлайн полдня, и его представление об остатке устарело;
 * решение о том, хватает ли товара, принимает сервер.
 */
export async function createSale(
  db: SqlDb,
  orgId: string,
  userId: string | null,
  input: SaleInput,
): Promise<Sale> {
  if (input.lines.length === 0) throw badRequest('Пустой чек провести нельзя');

  for (const line of input.lines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw badRequest('Количество в позиции должно быть целым числом больше нуля');
    }
  }

  if (input.payment === 'credit' && !input.customer_id) {
    throw badRequest('Для продажи в долг нужно выбрать покупателя');
  }

  await assertLocation(db, orgId, input.location_id);

  const saleId = input.id ?? randomUUID();
  const createdAt = input.created_at ?? new Date().toISOString();

  return db.tx(async (tx) => {
    const existing = await tx.one<Sale>('SELECT * FROM sales WHERE id = $1 AND org_id = $2', [
      saleId,
      orgId,
    ]);
    // Идемпотентность: телефон мог отправить чек, не получить ответ и повторить.
    // Второй раз списывать остаток нельзя.
    if (existing) return existing;

    const { shortages, costByProduct } = await checkStock(tx, orgId, input.location_id, input.lines);
    if (shortages.length > 0) throw new OutOfStockError(shortages);

    // Себестоимость берём из карточки товара, а не из того, что прислал клиент:
    // устройство продавца её вообще не видит, а доверять присланной цифре
    // нельзя — от неё считается прибыль.
    const lines = input.lines.map((line) => ({
      ...line,
      cost_price: costByProduct.get(line.product_id) ?? 0,
    }));

    const totals = saleTotals(lines, input.discount ?? 0);
    const seqs = await reserveSeq(tx, orgId, 1 + input.lines.length * 2);
    let cursor = 0;

    const sale = await tx.one<Sale>(
      `INSERT INTO sales (id, org_id, location_id, discount, total, cost_total,
                          payment, customer_id, created_by, created_at, seq)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        saleId,
        orgId,
        input.location_id,
        totals.discount,
        totals.total,
        totals.costTotal,
        input.payment ?? 'cash',
        input.customer_id ?? null,
        userId,
        createdAt,
        seqs[cursor++],
      ],
    );

    for (const line of lines) {
      await tx.query(
        `INSERT INTO sale_items (id, org_id, sale_id, product_id, qty, price, cost_price, seq)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          orgId,
          saleId,
          line.product_id,
          line.qty,
          line.price,
          line.cost_price,
          seqs[cursor++],
        ],
      );

      await insertMove(tx, {
        orgId,
        locationId: input.location_id,
        productId: line.product_id,
        qtyDelta: -line.qty,
        reason: 'sale',
        saleId,
        price: line.price,
        userId,
        createdAt,
        seq: seqs[cursor++],
      });
    }

    return sale!;
  });
}

/**
 * Одним запросом проверяет все позиции чека и заодно достаёт закупочные цены.
 * Отдельный запрос на позицию означал бы N обращений к базе на каждую продажу.
 */
async function checkStock(
  db: SqlDb,
  orgId: string,
  locationId: string,
  lines: SaleLineInput[],
): Promise<{ shortages: Shortage[]; costByProduct: Map<string, number> }> {
  const ids = lines.map((line) => line.product_id);

  const rows = await db.query<{ id: string; name: string; cost_price: number; stock: number }>(
    `SELECT p.id, p.name, p.cost_price,
            COALESCE((
              SELECT SUM(m.qty_delta) FROM stock_moves m
              WHERE m.product_id = p.id AND m.location_id = $3
            ), 0)::bigint AS stock
     FROM products p
     WHERE p.org_id = $1 AND p.id = ANY($2::uuid[])`,
    [orgId, ids, locationId],
  );

  const stockById = new Map(rows.map((row) => [row.id, Number(row.stock)]));
  const nameById = new Map(rows.map((row) => [row.id, row.name]));
  const costByProduct = new Map(rows.map((row) => [row.id, Number(row.cost_price)]));

  const shortages: Shortage[] = [];

  // Один товар может встретиться в чеке дважды — проверяем по суммарному
  // количеству, иначе две строки по 3 кг пройдут при остатке 4 кг.
  const requested = new Map<string, number>();
  for (const line of lines) {
    requested.set(line.product_id, (requested.get(line.product_id) ?? 0) + line.qty);
  }

  for (const [productId, qty] of requested) {
    if (!stockById.has(productId)) throw notFound(`Товар ${productId} не найден`);

    const available = stockById.get(productId)!;
    if (qty > available) {
      shortages.push({
        product_id: productId,
        name: nameById.get(productId) ?? productId,
        requested: qty,
        available,
      });
    }
  }

  return { shortages, costByProduct };
}

/**
 * Возврат чека: товар возвращается на склад компенсирующими движениями,
 * а суммы чека обнуляются, чтобы он выпал из выручки.
 * Сам чек и его позиции остаются — история не должна исчезать.
 */
export async function refundSale(
  db: SqlDb,
  orgId: string,
  userId: string | null,
  saleId: string,
): Promise<Sale> {
  return db.tx(async (tx) => {
    const sale = await tx.one<Sale>('SELECT * FROM sales WHERE id = $1 AND org_id = $2', [
      saleId,
      orgId,
    ]);
    if (!sale) throw notFound('Чек не найден');
    if (sale.refunded_at) throw conflict('Возврат по этому чеку уже оформлен');

    const items = await tx.query<SaleItem>('SELECT * FROM sale_items WHERE sale_id = $1', [saleId]);
    const createdAt = new Date().toISOString();
    const seqs = await reserveSeq(tx, orgId, items.length + 1);

    for (const [index, item] of items.entries()) {
      await insertMove(tx, {
        orgId,
        locationId: sale.location_id,
        productId: item.product_id,
        qtyDelta: item.qty,
        reason: 'return',
        saleId,
        price: item.price,
        userId,
        createdAt,
        seq: seqs[index],
      });
    }

    const updated = await tx.one<Sale>(
      `UPDATE sales SET refunded_at = $3, total = 0, cost_total = 0, seq = $4
       WHERE id = $1 AND org_id = $2 RETURNING *`,
      [saleId, orgId, createdAt, seqs[items.length]],
    );
    return updated!;
  });
}

export interface SaleWithItems extends Sale {
  location_name: string;
  user_name: string | null;
  items: (SaleItem & { name: string; unit: string })[];
}

export async function getSale(db: SqlDb, orgId: string, id: string): Promise<SaleWithItems> {
  const sale = await db.one<SaleWithItems>(
    `SELECT s.*, l.name AS location_name, u.name AS user_name
     FROM sales s
     JOIN locations l  ON l.id = s.location_id
     LEFT JOIN users u ON u.id = s.created_by
     WHERE s.org_id = $1 AND s.id = $2`,
    [orgId, id],
  );
  if (!sale) throw notFound('Чек не найден');

  sale.items = await db.query(
    `SELECT i.*, p.name, p.unit
     FROM sale_items i
     JOIN products p ON p.id = i.product_id
     WHERE i.sale_id = $1`,
    [id],
  );
  return sale;
}

export interface SaleSummary extends Sale {
  location_name: string;
  user_name: string | null;
  positions: number;
}

export async function listSales(
  db: SqlDb,
  orgId: string,
  filter: { locationId?: string; limit?: number } = {},
): Promise<SaleSummary[]> {
  const params: unknown[] = [orgId];
  const where = ['s.org_id = $1'];

  if (filter.locationId) {
    params.push(filter.locationId);
    where.push(`s.location_id = $${params.length}`);
  }
  params.push(Math.min(filter.limit ?? 100, 500));

  return db.query<SaleSummary>(
    `SELECT s.*, l.name AS location_name, u.name AS user_name,
            (SELECT COUNT(*) FROM sale_items i WHERE i.sale_id = s.id)::int AS positions
     FROM sales s
     JOIN locations l  ON l.id = s.location_id
     LEFT JOIN users u ON u.id = s.created_by
     WHERE ${where.join(' AND ')}
     ORDER BY s.seq DESC
     LIMIT $${params.length}`,
    params,
  );
}
