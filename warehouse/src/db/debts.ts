import type { SqlDriver } from './driver';
import { normalize } from './counterparties';
import { createMoneyDoc, SALE_ACCOUNT } from './money';
import { currentStaffId } from './staff';
import { allocateDebt, type DebtSlice } from '../domain/debt';
import type { Kopecks } from '../domain/money';
import type { Id, PaymentMethod } from '../domain/types';

/**
 * Долги покупателей — то, что открывает пункт кассы «Возврат долга».
 *
 * Долг не хранится числом у клиента. Он считается из чеков: сколько по чеку
 * приняли отсрочкой минус сколько по нему потом занесли. Причина та же, по
 * которой не хранится остаток товара, — число, которое кто-то увеличивает и
 * уменьшает, однажды разойдётся с тем, из чего складывается, и объяснить
 * расхождение будет нечем.
 */

/** Долг по одному чеку: сколько взяли отсрочкой и сколько ещё не отдали. */
export interface SaleDebt extends DebtSlice {
  /** Сумма чека, копейки. */
  total: Kopecks;
  /** Сколько по чеку ушло в отсрочку, копейки. */
  debt: Kopecks;
  created_at: string;
}

export interface Debtor {
  /** Клиент. */
  id: Id;
  name: string;
  phone: string | null;
  /** Сколько должен всего, копейки. */
  debt: Kopecks;
  /** Дата самого старого непогашенного чека. */
  since: string;
}

/** Непогашенное по чекам клиента, от старого к новому. */
export function debtSales(db: SqlDriver, customerId: Id): SaleDebt[] {
  return db.all<SaleDebt>(
    `SELECT s.id,
            s.total,
            s.debt,
            s.created_at,
            s.debt - COALESCE((
              SELECT SUM(p.amount) FROM debt_payments p WHERE p.sale_id = s.id
            ), 0) AS left
     FROM sales s
     WHERE s.customer_id = ? AND s.debt > 0
     ORDER BY s.id`,
    [customerId],
  ).filter((sale) => sale.left > 0);
}

/** Сколько должен этот клиент, копейки. */
export function customerDebt(db: SqlDriver, customerId: Id): Kopecks {
  const row = db.get<{ debt: number }>(
    `SELECT COALESCE(SUM(s.debt), 0) - COALESCE((
              SELECT SUM(p.amount) FROM debt_payments p WHERE p.customer_id = ?
            ), 0) AS debt
     FROM sales s
     WHERE s.customer_id = ?`,
    [customerId, customerId],
  );
  return Math.max(0, row?.debt ?? 0);
}

/**
 * Должники — список, который показывает касса.
 *
 * Ищет по имени и телефону: покупатель у прилавка называет себя, а не номер
 * чека.
 */
export function listDebtors(db: SqlDriver, search = ''): Debtor[] {
  // Ищем по той же готовой строке, что и справочник контрагентов: в ней имя,
  // телефоны и почта уже приведены к нижнему регистру. `LOWER` в SQLite
  // кириллицу не трогает — «Иванов» так и остался бы «Иванов».
  const like = `%${normalize(search)}%`;

  return db.all<Debtor>(
    `SELECT * FROM (
       SELECT c.id,
              c.name,
              c.phone,
              COALESCE(SUM(s.debt), 0) - COALESCE((
                SELECT SUM(p.amount) FROM debt_payments p WHERE p.customer_id = c.id
              ), 0) AS debt,
              MIN(s.created_at) AS since
       FROM counterparties c
       JOIN sales s ON s.customer_id = c.id AND s.debt > 0
       WHERE c.search_text LIKE ?
       GROUP BY c.id
     )
     WHERE debt > 0
     ORDER BY debt DESC`,
    [like],
  );
}

/** Сколько всего за покупателями, копейки. */
export function totalDebt(db: SqlDriver): Kopecks {
  const row = db.get<{ debt: number }>(
    `SELECT COALESCE((SELECT SUM(debt) FROM sales), 0)
            - COALESCE((SELECT SUM(amount) FROM debt_payments), 0) AS debt`,
  );
  return Math.max(0, row?.debt ?? 0);
}

export interface DebtPaymentInput {
  customerId: Id;
  /** Сколько приняли, копейки. */
  amount: Kopecks;
  payment?: PaymentMethod;
  locationId?: Id | null;
}

/**
 * Принять деньги в счёт долга.
 *
 * Деньги приходят настоящим приходным документом, а не просто уменьшают долг:
 * в ящике после этого физически лежит больше, и остаток кассы в конце смены
 * должен это учитывать.
 */
export function payDebt(db: SqlDriver, input: DebtPaymentInput): Kopecks {
  const payment = input.payment ?? 'cash';
  const now = new Date().toISOString();

  return db.tx(() => {
    const debts = debtSales(db, input.customerId);
    if (debts.length === 0) throw new Error('За покупателем долга нет');

    const parts = allocateDebt(debts, input.amount);
    if (parts.length === 0) throw new Error('Сумма погашения — больше нуля');

    const staffId = currentStaffId(db);
    let taken = 0;

    for (const part of parts) {
      db.run(
        `INSERT INTO debt_payments (sale_id, customer_id, amount, payment, location_id, staff_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [part.id, input.customerId, part.amount, payment, input.locationId ?? null, staffId, now],
      );
      taken += part.amount;
    }

    const name = db.get<{ name: string }>('SELECT name FROM counterparties WHERE id = ?', [
      input.customerId,
    ]);

    createMoneyDoc(db, {
      type: 'income',
      amount: taken,
      account: SALE_ACCOUNT[payment] ?? 'Касса магазина',
      category: 'Оплата от клиента',
      counterpartyId: input.customerId,
      counterparty: name?.name ?? null,
      note: `Возврат долга${parts.length === 1 ? ` по чеку №${parts[0].id}` : ''}`,
      locationId: input.locationId ?? null,
    });

    return taken;
  });
}
