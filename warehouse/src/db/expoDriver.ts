import * as SQLite from 'expo-sqlite';

import type { SqlDriver, SqlParam } from './driver';
import { migrate } from './schema';

export const DATABASE_NAME = 'warehouse.db';

/** Адаптер expo-sqlite к SqlDriver. Синхронный API — запросы у нас короткие. */
export function createExpoDriver(db: SQLite.SQLiteDatabase): SqlDriver {
  return {
    run(sql: string, params: SqlParam[] = []) {
      db.runSync(sql, params);
    },
    all<T>(sql: string, params: SqlParam[] = []): T[] {
      return db.getAllSync<T>(sql, params);
    },
    get<T>(sql: string, params: SqlParam[] = []): T | null {
      return db.getFirstSync<T>(sql, params) ?? null;
    },
    lastInsertId(): number {
      const row = db.getFirstSync<{ id: number }>('SELECT last_insert_rowid() AS id');
      return row?.id ?? 0;
    },
    tx<T>(fn: () => T): T {
      let result!: T;
      db.withTransactionSync(() => {
        result = fn();
      });
      return result;
    },
    exec(sql: string) {
      db.execSync(sql);
    },
  };
}

/** Открывает базу и приводит её к актуальной схеме. */
export function openDatabase(): SqlDriver {
  const db = SQLite.openDatabaseSync(DATABASE_NAME);
  const driver = createExpoDriver(db);
  migrate(driver);
  return driver;
}
