import type { Kopecks } from './money';
import type { Id } from './types';

/**
 * Долги покупателей.
 *
 * Долг рождается в кассе: часть чека приняли отсрочкой — товар отдали, деньги
 * не взяли. Он висит **на чеке**, а не на клиенте одним числом: покупатель
 * приходит и говорит «за прошлый раз», и надо знать, за какой именно.
 *
 * Здесь только арифметика: ни базы, ни экранов.
 */

/** Долг по одному чеку. */
export interface DebtSlice {
  /** Чек. */
  id: Id;
  /** Сколько по нему ещё не отдано, копейки. */
  left: Kopecks;
}

export interface DebtAllocation {
  id: Id;
  amount: Kopecks;
}

/**
 * Разносит принятые деньги по долгам, начиная со старого.
 *
 * Со старого, а не как придётся: покупатель гасит «за прошлый раз», и если
 * деньги лягут на свежий чек, старый долг будет висеть вечно, а в списке
 * должников — расти срок, которого на самом деле нет.
 *
 * Лишнее не разносится: принять больше, чем должны, нельзя — это уже не
 * погашение долга, а предоплата, и она сюда не относится.
 */
export function allocateDebt(debts: DebtSlice[], amount: Kopecks): DebtAllocation[] {
  const paid: DebtAllocation[] = [];
  let left = Math.max(0, Math.round(amount));

  for (const debt of debts) {
    if (left <= 0) break;
    const owed = Math.max(0, debt.left);
    if (owed === 0) continue;

    const part = Math.min(left, owed);
    paid.push({ id: debt.id, amount: part });
    left -= part;
  }

  return paid;
}

/** Сколько всего должны по этим чекам. */
export function debtTotal(debts: DebtSlice[]): Kopecks {
  return debts.reduce((sum, debt) => sum + Math.max(0, debt.left), 0);
}

/**
 * Сколько останется должен, если принять эту сумму.
 *
 * У него это «Общий долг составит» — число под полем ввода, меняющееся, пока
 * кассир набирает. Ниже нуля не опускается: переплата долг не отменяет.
 */
export function debtAfter(total: Kopecks, paying: Kopecks): Kopecks {
  return Math.max(0, total - Math.max(0, paying));
}
