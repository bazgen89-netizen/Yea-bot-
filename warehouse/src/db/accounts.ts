import type { SqlDriver } from './driver';
import { accountBalances } from './money';
import type { Requisite } from './settings';
import type { Id } from '../domain/types';

/**
 * Счета компании.
 *
 * До сих пор счёт был именем внутри денежного документа: «Касса магазина»
 * существовала ровно потому, что кто-то так написал, завести новый было
 * нечем, а у существующего не было ни типа, ни реквизитов. Теперь счёт —
 * запись, и «Компания / Счета» показывает то, что заведено, а не то, что
 * попалось в документах.
 *
 * Документы по-прежнему ссылаются на счёт по имени. Переписывать их на
 * ссылки значило бы трогать каждую уже заведённую запись, а имя счёта
 * уникально — этого достаточно.
 */

/** Типы счетов — его же, вместе с порядком в списке и значками. */
export interface AccountType {
  id: string;
  title: string;
  icon: string;
  /** Виден ли тип в выпадающем списке при заведении счёта. */
  visible: boolean;
  priority: number;
  /** Можно ли править счёт этого типа. */
  edit: boolean;
}

export const ACCOUNT_TYPES: AccountType[] = [
  { id: 'store', title: 'Счёт магазина', icon: 'store', visible: false, priority: 0, edit: true },
  { id: 'register', title: 'Касса', icon: 'register', visible: true, priority: 1, edit: false },
  {
    id: 'bank_account',
    title: 'Расчётный счёт',
    icon: 'accounts',
    visible: true,
    priority: 2,
    edit: true,
  },
  { id: 'bank_card', title: 'Банковская карта', icon: 'billing', visible: true, priority: 3, edit: true },
  { id: 'wallet', title: 'Кошелёк', icon: 'money', visible: true, priority: 4, edit: true },
];

export function accountType(id: string): AccountType {
  return ACCOUNT_TYPES.find((type) => type.id === id) ?? ACCOUNT_TYPES[4];
}

export interface Account {
  id: Id;
  name: string;
  type: string;
  opening_balance: number;
  include: number;
  use_terminal: number;
  account_number: string | null;
  bank_details: Requisite[];
  description: string | null;
  is_default: number;
  archived: number;
  created_at: string;
}

export interface AccountWithBalance extends Account {
  /** Остаток: начальный плюс всё, что прошло документами и чеками. */
  balance: number;
}

interface AccountRow extends Omit<Account, 'bank_details'> {
  bank_details: string;
}

function parse(row: AccountRow): Account {
  let details: Requisite[] = [];
  try {
    details = JSON.parse(row.bank_details) as Requisite[];
  } catch {
    details = [];
  }
  return { ...row, bank_details: details };
}

/**
 * Счета с остатками.
 *
 * Остаток по-прежнему не хранится: он складывается из чеков и денежных
 * документов ровно так же, как остаток товара складывается из движений.
 * Начальный остаток — единственное хранимое слагаемое, и это не «текущий
 * баланс», а то, что лежало на счёте до первого документа.
 */
export function listAccounts(db: SqlDriver, includeArchived = false): AccountWithBalance[] {
  const rows = db.all<AccountRow>(
    `SELECT * FROM accounts
     ${includeArchived ? '' : 'WHERE archived = 0'}
     ORDER BY is_default DESC, id`,
  );

  const moved = new Map(accountBalances(db).map((row) => [row.name, row.balance]));

  return rows.map((row) => {
    const account = parse(row);
    return { ...account, balance: account.opening_balance + (moved.get(account.name) ?? 0) };
  });
}

export function getAccount(db: SqlDriver, id: Id): AccountWithBalance | null {
  return listAccounts(db, true).find((account) => account.id === id) ?? null;
}

export interface AccountInput {
  name: string;
  type: string;
  opening_balance: number;
  include: boolean;
  use_terminal: boolean;
  account_number: string | null;
  bank_details: Requisite[];
  description: string | null;
  is_default: boolean;
}

export function blankAccount(): AccountInput {
  return {
    name: '',
    type: 'wallet',
    opening_balance: 0,
    include: true,
    use_terminal: false,
    account_number: null,
    bank_details: [{ key: '', value: '' }],
    description: null,
    is_default: false,
  };
}

/** Пустые пары реквизитов не сохраняются — так же, как у него. */
function cleanDetails(details: Requisite[]): Requisite[] {
  return details.filter((item) => item.key.trim() && item.value.trim());
}

export function createAccount(db: SqlDriver, input: AccountInput): Id {
  const name = input.name.trim();
  if (!name) throw new Error('У счёта должно быть название');

  return db.tx(() => {
    if (input.is_default) db.run('UPDATE accounts SET is_default = 0');

    db.run(
      `INSERT INTO accounts (name, type, opening_balance, include, use_terminal,
                             account_number, bank_details, description, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        input.type,
        input.opening_balance,
        input.include ? 1 : 0,
        // Эквайринг бывает только у расчётного счёта — как у него.
        input.type === 'bank_account' && input.use_terminal ? 1 : 0,
        input.account_number?.trim() || null,
        JSON.stringify(cleanDetails(input.bank_details)),
        input.description?.trim() || null,
        input.is_default ? 1 : 0,
        new Date().toISOString(),
      ],
    );
    return db.lastInsertId();
  });
}

export function updateAccount(db: SqlDriver, id: Id, input: AccountInput): void {
  const name = input.name.trim();
  if (!name) throw new Error('У счёта должно быть название');

  db.tx(() => {
    if (input.is_default) db.run('UPDATE accounts SET is_default = 0');

    db.run(
      `UPDATE accounts SET name = ?, type = ?, opening_balance = ?, include = ?,
                           use_terminal = ?, account_number = ?, bank_details = ?,
                           description = ?, is_default = ?
       WHERE id = ?`,
      [
        name,
        input.type,
        input.opening_balance,
        input.include ? 1 : 0,
        input.type === 'bank_account' && input.use_terminal ? 1 : 0,
        input.account_number?.trim() || null,
        JSON.stringify(cleanDetails(input.bank_details)),
        input.description?.trim() || null,
        input.is_default ? 1 : 0,
        id,
      ],
    );
  });
}

/**
 * Убрать счёт.
 *
 * Счёт, по которому ходили деньги, не удаляется, а прячется: удалить его
 * значило бы оставить документы ссылающимися в никуда, и движение денег
 * перестало бы сходиться.
 */
export function archiveAccount(db: SqlDriver, id: Id): void {
  const account = db.get<{ name: string }>('SELECT name FROM accounts WHERE id = ?', [id]);
  if (!account) return;

  const used = db.get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM money_docs WHERE account = ? OR account_to = ?',
    [account.name, account.name],
  );

  if ((used?.n ?? 0) > 0) {
    db.run('UPDATE accounts SET archived = 1 WHERE id = ?', [id]);
    return;
  }
  db.run('DELETE FROM accounts WHERE id = ?', [id]);
}

export function restoreAccount(db: SqlDriver, id: Id): void {
  db.run('UPDATE accounts SET archived = 0 WHERE id = ?', [id]);
}

/** Общий баланс — сумма счетов, отмеченных «включен в общий баланс». */
export function totalBalance(db: SqlDriver): number {
  return listAccounts(db)
    .filter((account) => account.include === 1)
    .reduce((sum, account) => sum + account.balance, 0);
}
