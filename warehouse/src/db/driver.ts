/**
 * Минимальный синхронный интерфейс к SQLite.
 *
 * Зачем прослойка: в приложении работает expo-sqlite (нативный модуль, недоступный
 * в Node), а в тестах — better-sqlite3. Оба реализуют этот интерфейс, поэтому
 * репозитории и SQL-запросы проверяются обычными юнит-тестами.
 */
export interface SqlDriver {
  /** Выполняет запрос без результата. */
  run(sql: string, params?: SqlParam[]): void;
  /** Возвращает строки результата. */
  all<T>(sql: string, params?: SqlParam[]): T[];
  /** Возвращает первую строку или null. */
  get<T>(sql: string, params?: SqlParam[]): T | null;
  /** id последней вставленной строки. */
  lastInsertId(): number;
  /** Выполняет несколько запросов как одну транзакцию (откат при исключении). */
  tx<T>(fn: () => T): T;
  /** Выполняет SQL-скрипт (несколько запросов через ;). */
  exec(sql: string): void;
}

export type SqlParam = string | number | null;
