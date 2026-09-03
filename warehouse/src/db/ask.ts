import type { SqlDriver } from './driver';

/**
 * Ответ помощника считается здесь, на устройстве.
 *
 * Наружу уезжает вопрос и описание таблиц — «есть products с колонками
 * name, sale_price…». Ни одной строки с телефоном, чеком или выручкой.
 * Обратно приезжает запрос, и вот он-то и выполняется по местной базе.
 *
 * Отсюда главное правило этого файла: **запрос пришёл снаружи, и доверия ему
 * нет**. Модель ошибается, а между ней и базой лежит интернет, где ответ
 * может подменить кто угодно. Поэтому выполняется только чтение, только один
 * запрос и только то, что прошло проверку целиком.
 */

/** Слова, после которых запрос не выполняется вовсе. */
const ЗАПРЕЩЕНО = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'REPLACE', 'TRUNCATE',
  'ATTACH', 'DETACH', 'PRAGMA', 'VACUUM', 'REINDEX', 'ANALYZE',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE',
];

export class UnsafeSql extends Error {}

/**
 * Проверить и причесать запрос.
 *
 * Проверка нарочно тупая и строгая: разбирать SQL по-настоящему — работа не
 * на вечер, а ошибиться здесь значит отдать чужому тексту свою базу. Лучше
 * отказать хорошему запросу, чем выполнить плохой: отказ человек увидит и
 * переспросит, а испорченный склад не увидит никто.
 */
export function checkSql(raw: string): string {
  const sql = raw.trim().replace(/;\s*$/, '').trim();

  if (!sql) throw new UnsafeSql('Помощник не прислал запрос.');

  // Точка с запятой внутри — это второй запрос следом за первым. Именно так
  // к безобидному «покажи товары» дописывают «удали всё».
  if (sql.includes(';')) {
    throw new UnsafeSql('В запросе больше одной команды — такой не выполняется.');
  }

  if (!/^\s*(SELECT|WITH)\b/i.test(sql)) {
    throw new UnsafeSql('Помощник прислал не выборку. Выполняется только чтение.');
  }

  const запрещённое = ЗАПРЕЩЕНО.find((word) => new RegExp(`\\b${word}\\b`, 'i').test(sql));
  if (запрещённое) {
    throw new UnsafeSql(`В запросе есть «${запрещённое}» — такой не выполняется, он меняет базу.`);
  }

  return sql;
}

export interface AskResult {
  columns: string[];
  rows: unknown[][];
  /** Сколько строк нашлось всего — может быть больше показанных. */
  total: number;
}

/** Сколько строк показывать. Больше человек всё равно не прочтёт. */
const ПОКАЗЫВАЕМ = 200;

/**
 * Выполнить проверенный запрос и разложить ответ по столбцам.
 *
 * Названия столбцов берутся из первой строки: их придумала модель (её просят
 * называть по-русски — «Выручка, ₽»), и переименовывать их не нужно.
 */
export function runSql(db: SqlDriver, raw: string): AskResult {
  const sql = checkSql(raw);
  const rows = db.all<Record<string, unknown>>(sql);

  if (rows.length === 0) return { columns: [], rows: [], total: 0 };

  const columns = Object.keys(rows[0]);
  return {
    columns,
    rows: rows.slice(0, ПОКАЗЫВАЕМ).map((row) => columns.map((column) => row[column])),
    total: rows.length,
  };
}
