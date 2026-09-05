import { PGlite } from '@electric-sql/pglite';

import type { SqlDb } from '../src/db/driver.ts';
import { migrate } from '../src/db/schema.ts';

/**
 * Драйвер для тестов: настоящий PostgreSQL, собранный в WebAssembly, в памяти.
 * Тот же SQL, что на проде, но без поднятия сервера базы — тесты идут в CI
 * и на ноутбуке одинаково.
 */
export async function createTestDb(): Promise<SqlDb> {
  const pglite = await PGlite.create();

  let depth = 0;

  const db: SqlDb = {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await pglite.query(sql, params);
      return result.rows as T[];
    },
    async one<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const result = await pglite.query(sql, params);
      return (result.rows[0] as T) ?? null;
    },
    async exec(sql: string): Promise<void> {
      await pglite.exec(sql);
    },
    async tx<T>(fn: (inner: SqlDb) => Promise<T>): Promise<T> {
      // Вложенная транзакция — часть внешней: BEGIN внутри BEGIN Postgres не примет.
      if (depth > 0) return fn(db);

      depth++;
      await pglite.exec('BEGIN');
      try {
        const result = await fn(db);
        await pglite.exec('COMMIT');
        return result;
      } catch (error) {
        await pglite.exec('ROLLBACK');
        throw error;
      } finally {
        depth--;
      }
    },
    async close(): Promise<void> {
      await pglite.close();
    },
  };

  await migrate(db);
  return db;
}
