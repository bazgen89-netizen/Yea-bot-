/**
 * Минимальный интерфейс к PostgreSQL.
 *
 * Прослойка нужна по той же причине, что и в мобильном приложении: на проде под
 * ней node-postgres, в тестах — PGlite (Postgres, собранный в WASM). Один и тот
 * же SQL проверяется тестами без поднятия отдельной базы.
 */
export interface SqlDb {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Первая строка результата или null. */
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  /**
   * Выполняет SQL-скрипт из нескольких запросов (миграции).
   * Отдельно от query, потому что расширенный протокол Postgres принимает
   * ровно один запрос на вызов.
   */
  exec(sql: string): Promise<void>;
  /** Выполняет функцию в транзакции. Откат при исключении. */
  tx<T>(fn: (db: SqlDb) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
