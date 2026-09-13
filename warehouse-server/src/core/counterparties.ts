import { randomUUID } from 'node:crypto';

import type { SqlDb } from '../db/driver.ts';
import { badRequest, notFound } from './errors.ts';
import { nextSeq } from './seq.ts';

export type PartyKind = 'customer' | 'supplier' | 'both';

export interface Counterparty {
  id: string;
  org_id: string;
  kind: PartyKind;
  name: string;
  phone: string | null;
  email: string | null;
  note: string | null;
  archived: boolean;
  seq: number;
}

export interface CounterpartyWithBalance extends Counterparty {
  /**
   * Долг в копейках. Плюс — нам должны (клиент взял в долг),
   * минус — должны мы (поставщику не заплачено).
   */
  balance: number;
}

export interface PartyInput {
  id?: string;
  kind: PartyKind;
  name: string;
  phone?: string | null;
  email?: string | null;
  note?: string | null;
}

/**
 * Долг считается из первички, а не хранится числом: чеки в долг минус платежи
 * клиента, поставки минус платежи поставщику. По той же причине, по которой
 * остаток считается из движений — сумму, которую можно рассинхронизировать
 * с историей, невозможно объяснить.
 */
const BALANCE_SQL = `
  COALESCE((
    SELECT SUM(s.total) FROM sales s
    WHERE s.customer_id = p.id AND s.payment = 'credit' AND s.refunded_at IS NULL
  ), 0)
  - COALESCE((
      SELECT SUM(ABS(m.qty_delta) * m.price) / 1000 FROM stock_moves m
      JOIN docs d ON d.id = m.doc_id
      WHERE d.supplier_id = p.id AND d.type = 'receipt'
    ), 0)
  - COALESCE((
      SELECT SUM(pay.amount) FROM counterparty_payments pay
      WHERE pay.counterparty_id = p.id
    ), 0)
`;

export async function listCounterparties(
  db: SqlDb,
  orgId: string,
  filter: { kind?: PartyKind; search?: string; includeArchived?: boolean; withDebtOnly?: boolean } = {},
): Promise<CounterpartyWithBalance[]> {
  const params: unknown[] = [orgId];
  const where = ['p.org_id = $1'];

  if (!filter.includeArchived) where.push('p.archived = false');

  if (filter.kind) {
    params.push(filter.kind);
    // Запись «и клиент, и поставщик» попадает в оба списка.
    where.push(`(p.kind = $${params.length} OR p.kind = 'both')`);
  }

  if (filter.search?.trim()) {
    params.push(`%${filter.search.trim().toLowerCase()}%`);
    where.push(`(lower(p.name) LIKE $${params.length} OR p.phone LIKE $${params.length})`);
  }

  const having = filter.withDebtOnly ? 'WHERE balance <> 0' : '';

  return db.query<CounterpartyWithBalance>(
    `SELECT * FROM (
       SELECT p.*, (${BALANCE_SQL})::bigint AS balance
       FROM counterparties p
       WHERE ${where.join(' AND ')}
     ) rows
     ${having}
     ORDER BY name`,
    params,
  );
}

export async function getCounterparty(
  db: SqlDb,
  orgId: string,
  id: string,
): Promise<CounterpartyWithBalance> {
  const row = await db.one<CounterpartyWithBalance>(
    `SELECT p.*, (${BALANCE_SQL})::bigint AS balance
     FROM counterparties p
     WHERE p.org_id = $1 AND p.id = $2`,
    [orgId, id],
  );
  if (!row) throw notFound('Контрагент не найден');
  return row;
}

export async function createCounterparty(
  db: SqlDb,
  orgId: string,
  input: PartyInput,
): Promise<Counterparty> {
  return db.tx(async (tx) => {
    const seq = await nextSeq(tx, orgId);
    const row = await tx.one<Counterparty>(
      `INSERT INTO counterparties (id, org_id, kind, name, phone, email, note, seq)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        input.id ?? randomUUID(),
        orgId,
        input.kind,
        input.name.trim(),
        blank(input.phone),
        blank(input.email),
        blank(input.note),
        seq,
      ],
    );
    return row!;
  });
}

export async function updateCounterparty(
  db: SqlDb,
  orgId: string,
  id: string,
  patch: Partial<PartyInput> & { archived?: boolean },
): Promise<Counterparty> {
  const sets: string[] = [];
  const params: unknown[] = [id, orgId];

  const assign = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (patch.kind !== undefined) assign('kind', patch.kind);
  if (patch.name !== undefined) assign('name', patch.name.trim());
  if (patch.phone !== undefined) assign('phone', blank(patch.phone));
  if (patch.email !== undefined) assign('email', blank(patch.email));
  if (patch.note !== undefined) assign('note', blank(patch.note));
  if (patch.archived !== undefined) assign('archived', patch.archived);

  if (sets.length === 0) return getCounterparty(db, orgId, id);

  return db.tx(async (tx) => {
    const seq = await nextSeq(tx, orgId);
    params.push(seq);

    const row = await tx.one<Counterparty>(
      `UPDATE counterparties SET ${sets.join(', ')}, updated_at = now(), seq = $${params.length}
       WHERE id = $1 AND org_id = $2 RETURNING *`,
      params,
    );
    if (!row) throw notFound('Контрагент не найден');
    return row;
  });
}

export interface Payment {
  id: string;
  counterparty_id: string;
  amount: number;
  note: string | null;
  created_at: string;
}

/** Погашение долга: клиент вернул деньги или мы заплатили поставщику. */
export async function addPayment(
  db: SqlDb,
  orgId: string,
  userId: string | null,
  input: { id?: string; counterparty_id: string; amount: number; note?: string },
): Promise<Payment> {
  if (!Number.isInteger(input.amount) || input.amount === 0) {
    throw badRequest('Сумма платежа должна быть целым числом копеек и не нулём');
  }

  await getCounterparty(db, orgId, input.counterparty_id);

  return db.tx(async (tx) => {
    const seq = await nextSeq(tx, orgId);
    const row = await tx.one<Payment>(
      `INSERT INTO counterparty_payments
         (id, org_id, counterparty_id, amount, note, created_by, created_at, seq)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [
        input.id ?? randomUUID(),
        orgId,
        input.counterparty_id,
        input.amount,
        input.note?.trim() || null,
        userId,
        new Date().toISOString(),
        seq,
      ],
    );
    if (!row) throw badRequest('Такой платёж уже зарегистрирован');
    return row;
  });
}

export async function listPayments(
  db: SqlDb,
  orgId: string,
  counterpartyId: string,
  limit = 100,
): Promise<Payment[]> {
  return db.query<Payment>(
    `SELECT * FROM counterparty_payments
     WHERE org_id = $1 AND counterparty_id = $2
     ORDER BY seq DESC LIMIT $3`,
    [orgId, counterpartyId, Math.min(limit, 500)],
  );
}

export interface PartyHistoryEntry {
  kind: 'sale' | 'receipt' | 'payment';
  id: string;
  amount: number;
  created_at: string;
  note: string | null;
}

/** Единая лента по контрагенту: продажи, поставки и платежи вперемешку. */
export async function partyHistory(
  db: SqlDb,
  orgId: string,
  counterpartyId: string,
  limit = 100,
): Promise<PartyHistoryEntry[]> {
  return db.query<PartyHistoryEntry>(
    `SELECT 'sale' AS kind, s.id, s.total AS amount, s.created_at,
            CASE WHEN s.payment = 'credit' THEN 'в долг' ELSE NULL END AS note
     FROM sales s
     WHERE s.org_id = $1 AND s.customer_id = $2 AND s.refunded_at IS NULL

     UNION ALL

     SELECT 'receipt', d.id,
            COALESCE((
              SELECT ROUND(SUM(ABS(m.qty_delta) * m.price) / 1000.0)
              FROM stock_moves m WHERE m.doc_id = d.id
            ), 0)::bigint,
            d.created_at, d.note
     FROM docs d
     WHERE d.org_id = $1 AND d.supplier_id = $2 AND d.type = 'receipt'

     UNION ALL

     SELECT 'payment', pay.id, pay.amount, pay.created_at, pay.note
     FROM counterparty_payments pay
     WHERE pay.org_id = $1 AND pay.counterparty_id = $2

     ORDER BY created_at DESC
     LIMIT $3`,
    [orgId, counterpartyId, Math.min(limit, 500)],
  );
}

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
