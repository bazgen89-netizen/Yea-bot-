import type { SqlDriver } from './driver';
import { openShiftAnywhere } from './shifts';
import type { Kopecks } from '../domain/money';
import type { Id } from '../domain/types';

/**
 * Деньги, не рождённые чеком.
 *
 * Приход по продаже отдельно не заводится — он берётся из самого чека, иначе
 * пришлось бы сверять две записи об одном и том же событии. А вот аренда,
 * зарплата, инкассация и перевод между счетами чеком не сопровождаются:
 * для них и нужен документ.
 */

export type MoneyType = 'income' | 'expense' | 'transfer';

export const MONEY_TYPE_LABEL: Record<MoneyType, string> = {
  income: 'Приход',
  expense: 'Расход',
  transfer: 'Перевод',
};

/** Счета, между которыми ходят деньги. Те же, что показывает движение денег. */
export const ACCOUNTS = ['Касса магазина', 'Терминал / Счет в банке', 'Счет в банке'] as const;

/** Статьи платежей — то, что в кабинете называется «категория платежа». */
export const CATEGORIES: Record<MoneyType, string[]> = {
  income: ['Оплата от клиента', 'Возврат от поставщика', 'Внесение наличных', 'Прочий доход'],
  expense: ['Оплата поставщику', 'Аренда', 'Зарплата', 'Инкассация', 'Прочий расход'],
  transfer: ['Перевод между счетами'],
};

export interface MoneyDocInput {
  type: MoneyType;
  /** Сумма в копейках, всегда положительная: знак задаёт тип. */
  amount: Kopecks;
  account: string;
  /** Счёт-получатель. Только у перевода. */
  accountTo?: string | null;
  counterpartyId?: Id | null;
  counterparty?: string | null;
  category?: string | null;
  note?: string | null;
  locationId?: Id | null;
}

export interface AccountBalance {
  name: string;
  /** Пришло с чеков, копейки. */
  fromSales: Kopecks;
  /** Пришло документами прихода, копейки. */
  income: Kopecks;
  /** Ушло документами расхода, копейки. */
  expense: Kopecks;
  /** Пришло переводами с других счетов, копейки. */
  transferIn: Kopecks;
  /** Ушло переводами на другие счета, копейки. */
  transferOut: Kopecks;
  /** Остаток на счёте, копейки. */
  balance: Kopecks;
}

/** Какой способ оплаты кладёт деньги на какой счёт. */
const SALE_ACCOUNT: Record<string, string> = {
  cash: 'Касса магазина',
  card: 'Терминал / Счет в банке',
  transfer: 'Счет в банке',
};

/**
 * Остатки по счетам.
 *
 * Нигде не хранятся — считаются из чеков и денежных документов, по той же
 * причине, по которой не хранится остаток товара: число, которое кто-то
 * увеличивает, рано или поздно разойдётся с тем, из чего оно должно
 * складываться, и объяснить расхождение будет нечем.
 */
export function accountBalances(db: SqlDriver): AccountBalance[] {
  const totals = new Map<string, AccountBalance>();
  const at = (name: string): AccountBalance => {
    let row = totals.get(name);
    if (!row) {
      row = {
        name,
        fromSales: 0,
        income: 0,
        expense: 0,
        transferIn: 0,
        transferOut: 0,
        balance: 0,
      };
      totals.set(name, row);
    }
    return row;
  };

  for (const name of ACCOUNTS) at(name);

  for (const row of db.all<{ payment: string; total: number }>(
    `SELECT payment, COALESCE(SUM(total), 0) AS total
     FROM sales s
     WHERE NOT EXISTS (
       SELECT 1 FROM stock_moves m WHERE m.sale_id = s.id AND m.reason = 'return'
     )
     GROUP BY payment`,
  )) {
    at(SALE_ACCOUNT[row.payment] ?? row.payment).fromSales += row.total;
  }

  for (const row of db.all<{
    type: MoneyType;
    account: string;
    account_to: string | null;
    total: number;
  }>(
    `SELECT type, account, account_to, COALESCE(SUM(amount), 0) AS total
     FROM money_docs
     GROUP BY type, account, account_to`,
  )) {
    if (row.type === 'income') at(row.account).income += row.total;
    if (row.type === 'expense') at(row.account).expense += row.total;
    if (row.type === 'transfer') {
      at(row.account).transferOut += row.total;
      if (row.account_to) at(row.account_to).transferIn += row.total;
    }
  }

  const result = [...totals.values()];
  for (const row of result) {
    row.balance = row.fromSales + row.income + row.transferIn - row.expense - row.transferOut;
  }
  return result;
}

export function createMoneyDoc(db: SqlDriver, input: MoneyDocInput): Id {
  if (input.amount <= 0) throw new Error('Сумма должна быть больше нуля');
  if (!input.account.trim()) throw new Error('Не выбран счёт');
  if (input.type === 'transfer') {
    if (!input.accountTo?.trim()) throw new Error('Не выбран счёт получателя');
    if (input.accountTo.trim() === input.account.trim()) {
      throw new Error('Счета отправителя и получателя совпадают');
    }
  }

  // Как и чек, документ привязывается к открытой смене: без этого инкассация
  // не попала бы в Z-отчёт, и ящик «не сошёлся» бы ровно на её сумму.
  const shift = openShiftAnywhere(db);

  db.run(
    `INSERT INTO money_docs
       (type, amount, account, account_to, counterparty_id, counterparty,
        category, note, location_id, shift_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.type,
      input.amount,
      input.account.trim(),
      input.type === 'transfer' ? (input.accountTo?.trim() ?? null) : null,
      input.counterpartyId ?? null,
      input.counterparty?.trim() || null,
      input.category?.trim() || null,
      input.note?.trim() || null,
      input.locationId ?? null,
      shift?.id ?? null,
      new Date().toISOString(),
    ],
  );

  return db.lastInsertId();
}
