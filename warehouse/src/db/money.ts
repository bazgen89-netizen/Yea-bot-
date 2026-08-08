import type { SqlDriver } from './driver';
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

export function createMoneyDoc(db: SqlDriver, input: MoneyDocInput): Id {
  if (input.amount <= 0) throw new Error('Сумма должна быть больше нуля');
  if (!input.account.trim()) throw new Error('Не выбран счёт');
  if (input.type === 'transfer') {
    if (!input.accountTo?.trim()) throw new Error('Не выбран счёт получателя');
    if (input.accountTo.trim() === input.account.trim()) {
      throw new Error('Счета отправителя и получателя совпадают');
    }
  }

  db.run(
    `INSERT INTO money_docs
       (type, amount, account, account_to, counterparty_id, counterparty,
        category, note, location_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      new Date().toISOString(),
    ],
  );

  return db.lastInsertId();
}
