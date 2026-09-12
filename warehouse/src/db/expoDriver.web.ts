import type { SqlDriver } from './driver';
import { openWebDatabase } from './webDriver';

/**
 * Веб-версия `expoDriver`. Metro подставляет этот файл вместо `expoDriver.ts`
 * при сборке под браузер — по суффиксу `.web`.
 *
 * Он существует, чтобы в бандл страницы вообще не попал `expo-sqlite`. Одного
 * `Platform.OS === 'web'` для этого мало: импорт остаётся в бандле, модуль
 * выполняется при загрузке и поднимает свой воркер — который в браузере всё
 * равно не работает без `SharedArrayBuffer`. Здесь его просто нет.
 */

export { DATABASE_NAME } from './webDriver';

export function openDatabase(): Promise<SqlDriver> {
  return openWebDatabase();
}
