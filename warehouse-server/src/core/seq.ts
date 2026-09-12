import type { SqlDb } from '../db/driver.ts';

/**
 * Выдаёт следующий номер в очереди изменений организации.
 *
 * Номер берётся через UPDATE ... RETURNING, то есть под блокировкой строки
 * организации. Это сериализует записи одной организации — и именно это нам
 * нужно: клиент синхронизируется по строгому порядку `seq > последний`, и
 * дырок или перестановок в этом порядке быть не должно.
 *
 * На нагрузку розничного магазина такой блокировки достаточно с большим запасом.
 */
export async function nextSeq(db: SqlDb, orgId: string): Promise<number> {
  const row = await db.one<{ seq: number }>(
    'UPDATE orgs SET seq = seq + 1 WHERE id = $1 RETURNING seq',
    [orgId],
  );
  if (!row) throw new Error(`Организация ${orgId} не найдена`);
  return row.seq;
}

/**
 * Выдаёт сразу несколько номеров одним запросом.
 * Нужно там, где одна операция пишет пачку строк (чек с позициями и движениями):
 * иначе на каждый ряд был бы отдельный UPDATE по той же строке организации.
 */
export async function reserveSeq(db: SqlDb, orgId: string, count: number): Promise<number[]> {
  if (count <= 0) return [];

  const row = await db.one<{ seq: number }>(
    'UPDATE orgs SET seq = seq + $2 WHERE id = $1 RETURNING seq',
    [orgId, count],
  );
  if (!row) throw new Error(`Организация ${orgId} не найдена`);

  const last = Number(row.seq);
  const first = last - count + 1;
  return Array.from({ length: count }, (_, i) => first + i);
}
