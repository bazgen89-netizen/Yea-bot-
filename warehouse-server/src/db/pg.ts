import pg from 'pg';

import type { SqlDb } from './driver.ts';

/**
 * BIGINT приходит из pg строкой, чтобы не терять точность на числах больше 2^53.
 * У нас в BIGINT лежат копейки и тысячные — до таких значений им далеко,
 * поэтому читаем их как number: иначе арифметика в коде превратится в строковую.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));

export function createPgDb(connectionString: string): SqlDb {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    // Управляемые базы (Yandex Cloud, Timeweb) требуют TLS, но выдают
    // собственный корневой сертификат — проверку цепочки отключаем только
    // если это явно разрешено переменной окружения.
    ssl: sslOptions(connectionString),
  });

  return wrap(pool);
}

function sslOptions(connectionString: string): pg.PoolConfig['ssl'] {
  if (process.env.PGSSLMODE === 'disable') return false;
  if (connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) {
    return false;
  }
  return { rejectUnauthorized: process.env.PGSSL_ALLOW_SELF_SIGNED !== 'true' };
}

function wrap(client: pg.Pool | pg.PoolClient): SqlDb {
  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await client.query(sql, params);
      return result.rows as T[];
    },
    async one<T>(sql: string, params: unknown[] = []): Promise<T | null> {
      const result = await client.query(sql, params);
      return (result.rows[0] as T) ?? null;
    },
    async exec(sql: string): Promise<void> {
      // Без параметров node-postgres использует простой протокол,
      // который допускает несколько запросов в одной строке.
      await client.query(sql);
    },
    async tx<T>(fn: (db: SqlDb) => Promise<T>): Promise<T> {
      // Вложенная транзакция — часть внешней: BEGIN внутри BEGIN Postgres не примет.
      if (!('connect' in client)) return fn(wrap(client));

      const connection = await (client as pg.Pool).connect();
      try {
        await connection.query('BEGIN');
        const result = await fn(wrap(connection));
        await connection.query('COMMIT');
        return result;
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {
        connection.release();
      }
    },
    async close(): Promise<void> {
      if ('end' in client) await (client as pg.Pool).end();
    },
  };
}
