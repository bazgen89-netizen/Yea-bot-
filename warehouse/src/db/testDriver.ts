import Database from 'better-sqlite3';

import type { SqlDriver, SqlParam } from './driver';
import { migrate } from './schema';

/**
 * Драйвер для тестов: та же схема и тот же SQL, что в приложении, но на
 * better-sqlite3 в памяти. Позволяет проверять реальные запросы в Node.
 */
export function createTestDriver(): SqlDriver {
  const db = new Database(':memory:');

  // Ручное управление транзакциями вместо db.transaction(): наши функции
  // возвращают значения и могут вкладываться (createSale внутри tx читает остаток).
  let depth = 0;

  const driver: SqlDriver = {
    run(sql: string, params: SqlParam[] = []) {
      db.prepare(sql).run(params);
    },
    all<T>(sql: string, params: SqlParam[] = []): T[] {
      return db.prepare(sql).all(params) as T[];
    },
    get<T>(sql: string, params: SqlParam[] = []): T | null {
      return (db.prepare(sql).get(params) as T | undefined) ?? null;
    },
    lastInsertId(): number {
      const row = db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number };
      return row.id;
    },
    tx<T>(fn: () => T): T {
      if (depth > 0) return fn(); // вложенная транзакция — часть внешней
      depth++;
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      } finally {
        depth--;
      }
    },
    exec(sql: string) {
      db.exec(sql);
    },
  };

  migrate(driver);
  return driver;
}
