import type { SqlDriver } from './driver';
import type { CartLine, Id } from '../domain/types';

/**
 * Отложенные чеки — та самая «Очередь чеков».
 *
 * Покупатель у прилавка вспомнил, что забыл кошелёк в машине, а за ним стоят
 * ещё двое: чек откладывают и пробивают следующий. Отложенных может быть
 * сколько угодно, и каждый ждёт, пока его не выберут обратно или не удалят.
 *
 * Ничего складского при этом не происходит: товар не списывается, деньги не
 * приходят, в журнал чек не попадает. Он лежит ровно тем, чем был на кассе, —
 * набором строк, покупателем и скидкой.
 */

export interface HeldReceipt {
  id: Id;
  created_at: string;
  mode: 'sale' | 'return';
  customer_id: Id | null;
  /** Имя покупателя строкой: карточку могли переименовать или удалить. */
  customer_name: string | null;
  discount: number;
  lines: CartLine[];
}

export function holdReceipt(
  db: SqlDriver,
  receipt: {
    mode: 'sale' | 'return';
    customerId: Id | null;
    customerName: string | null;
    discount: number;
    lines: CartLine[];
  },
): void {
  db.run(
    `INSERT INTO held_receipts (created_at, mode, customer_id, customer_name, discount, lines)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      new Date().toISOString(),
      receipt.mode,
      receipt.customerId,
      receipt.customerName,
      receipt.discount,
      JSON.stringify(receipt.lines),
    ],
  );
}

export function listHeld(db: SqlDriver): HeldReceipt[] {
  const rows = db.all<Omit<HeldReceipt, 'lines'> & { lines: string }>(
    `SELECT id, created_at, mode, customer_id, customer_name, discount, lines
     FROM held_receipts
     ORDER BY id DESC`,
  );

  return rows.map((row) => ({ ...row, lines: parseLines(row.lines) }));
}

/** Сколько чеков в очереди — для счётчика на кнопке. */
export function countHeld(db: SqlDriver): number {
  return db.get<{ n: number }>('SELECT COUNT(*) AS n FROM held_receipts')?.n ?? 0;
}

export function deleteHeld(db: SqlDriver, id: Id): void {
  db.run('DELETE FROM held_receipts WHERE id = ?', [id]);
}

/**
 * Разбор строк.
 *
 * Испорченную запись не роняем, а показываем пустой: один сломанный чек не
 * должен закрывать кассиру всю очередь.
 */
function parseLines(value: string): CartLine[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as CartLine[]) : [];
  } catch {
    return [];
  }
}
