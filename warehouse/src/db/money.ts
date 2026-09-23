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
export const SALE_ACCOUNT: Record<string, string> = {
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

  // Из чека вычитается отсрочка: она — долг покупателя, а не деньги на счёте.
  // Занесённое по долгу приходит отдельным приходным документом, поэтому
  // дважды одни и те же деньги не считаются.
  for (const row of db.all<{ payment: string; total: number }>(
    `SELECT payment, COALESCE(SUM(total - debt), 0) AS total
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

/** Откуда взялся приход: заведён руками или пришёл вместе с чеком. */
export type MoneySource = 'doc' | 'sale';

/** Денежный документ со всем, чем он подписан на своей странице. */
export interface MoneyDoc {
  id: Id;
  source: MoneySource;
  /** Свой номер прихода: у перенесённых — тот, что был в CloudShop. */
  number: number | null;
  type: MoneyType;
  amount: Kopecks;
  account: string;
  account_to: string | null;
  counterparty_id: Id | null;
  counterparty: string | null;
  category: string | null;
  note: string | null;
  created_at: string;
  /** Касса и смена — как в его документе: «Касса №1», «Смена #3430». */
  register: string | null;
  shift_number: number | null;
  /** «Привязка к документу»: чек, которым рождён этот приход. */
  sale_id: Id | null;
  sale_number: number | null;
}

/**
 * Документ движения денег.
 *
 * Их таблица ведёт на `card.money_show({orderId})` **каждую** строку, а не
 * только заведённые руками: приход по чеку у них тоже документ, просто
 * нередактируемый — на нём стоит «привязка к документу», и правится он в
 * самом чеке. Поэтому и здесь по строке из чека собирается такой же
 * документ, а не открывается чек вместо него.
 */
export function getMoneyDoc(db: SqlDriver, id: Id, source: MoneySource = 'doc'): MoneyDoc | null {
  if (source === 'sale') {
    const sale = db.get<{
      id: Id;
      number: number | null;
      money_number: number | null;
      total: Kopecks;
      payment: string | null;
      customer_id: Id | null;
      counterparty: string | null;
      note: string | null;
      created_at: string;
      register: string | null;
      shift_number: number | null;
    }>(
      `SELECT s.id, s.number, s.money_number, s.total, s.payment, s.customer_id,
              COALESCE(
                (SELECT c.name FROM counterparties c WHERE c.id = s.customer_id),
                s.customer_name
              )                                                                AS counterparty,
              s.note, s.created_at,
              COALESCE(
                (SELECT r.name FROM registers r
                   JOIN shifts h ON h.register_id = r.id WHERE h.id = s.shift_id),
                s.register_name
              )                                                                AS register,
              COALESCE(s.shift_id, s.shift_no)                                 AS shift_number
         FROM sales s
        WHERE s.id = ?`,
      [id],
    );
    if (!sale) return null;

    return {
      id: sale.id,
      source: 'sale',
      number: sale.money_number,
      type: 'income',
      amount: sale.total,
      account: SALE_ACCOUNT[sale.payment ?? ''] ?? sale.payment ?? '',
      account_to: null,
      counterparty_id: sale.customer_id,
      counterparty: sale.counterparty ?? 'Розничный покупатель',
      category: 'Оплата от клиента',
      note: sale.note,
      created_at: sale.created_at,
      register: sale.register,
      shift_number: sale.shift_number,
      sale_id: sale.id,
      sale_number: sale.number,
    };
  }

  return db.get<MoneyDoc>(
    `SELECT m.*,
            'doc'                                                             AS source,
            NULL                                                              AS number,
            (SELECT r.name FROM registers r
               JOIN shifts h ON h.register_id = r.id WHERE h.id = m.shift_id) AS register,
            m.shift_id                                                        AS shift_number,
            NULL                                                              AS sale_id,
            NULL                                                              AS sale_number
       FROM money_docs m
      WHERE m.id = ?`,
    [id],
  );
}

/**
 * Правка денежного документа.
 *
 * У него страница документа — она же и форма: открыл «Приход #46148» и
 * правишь счёт, контрагента, категорию платежа, сумму и комментарий. Отдельного
 * «просмотра» нет вовсе, поэтому и у нас его нет.
 *
 * Тип документа не меняется: приход, ставший расходом, — это другая
 * операция, и в отчётах за прошлый период она перевернула бы итоги задним
 * числом.
 */
export function updateMoneyDoc(
  db: SqlDriver,
  id: Id,
  input: Omit<MoneyDocInput, 'type'> & { createdAt?: string },
): void {
  if (input.amount <= 0) throw new Error('Сумма должна быть больше нуля');
  if (!input.account.trim()) throw new Error('Не выбран счёт');

  const when = input.createdAt?.trim();
  if (when != null && when !== '' && Number.isNaN(new Date(when).getTime())) {
    throw new Error('Не разобрать дату документа');
  }

  db.run(
    `UPDATE money_docs
        SET amount = ?, account = ?, account_to = ?, counterparty_id = ?,
            counterparty = ?, category = ?, note = ?,
            created_at = COALESCE(?, created_at)
      WHERE id = ?`,
    [
      input.amount,
      input.account.trim(),
      input.accountTo?.trim() || null,
      input.counterpartyId ?? null,
      input.counterparty?.trim() || null,
      input.category?.trim() || null,
      input.note?.trim() || null,
      when ? new Date(when).toISOString() : null,
      id,
    ],
  );
}

/** Удалить денежный документ. Деньги по нему перестают учитываться. */
export function deleteMoneyDoc(db: SqlDriver, id: Id): void {
  db.run('DELETE FROM money_docs WHERE id = ?', [id]);
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
