import type { SqlDriver } from './driver';

/**
 * С каким сервером связано это устройство.
 *
 * Строка ровно одна: устройство работает с одним магазином. Токен лежит
 * здесь же, в базе устройства, а не в коде программы — и стирается выходом
 * из учётной записи.
 *
 * Связи может не быть вовсе, и это нормальный, а не сломанный случай:
 * программа работает без интернета и без сервера, как работала. Сервер
 * нужен, чтобы данные сходились между устройствами, а не чтобы касса
 * зависела от связи.
 */
export interface ServerLink {
  url: string;
  token: string | null;
  org: string | null;
  org_name: string | null;
  user_id: string | null;
  user_name: string | null;
  role: string | null;
  /** Номер изменения, до которого сервер нам уже пересказан. */
  pulled: number;
  synced_at: string | null;
}

export function getServer(db: SqlDriver): ServerLink | null {
  return db.get<ServerLink>('SELECT * FROM server WHERE id = 1');
}

/** Записан ли вход: есть адрес и токен. */
export function isSignedIn(db: SqlDriver): boolean {
  const link = getServer(db);
  return Boolean(link?.url && link.token);
}

/** Запомнить адрес сервера, ещё до входа. */
export function setServerUrl(db: SqlDriver, url: string): void {
  const clean = url.trim().replace(/\/+$/, '');
  if (!clean) throw new Error('Не указан адрес сервера');

  const link = getServer(db);
  if (link) db.run('UPDATE server SET url = ? WHERE id = 1', [clean]);
  else db.run('INSERT INTO server (id, url) VALUES (1, ?)', [clean]);
}

export interface SignedIn {
  token: string;
  org: string;
  orgName?: string | null;
  userId: string;
  userName: string;
  role: string;
}

/**
 * Запомнить вход.
 *
 * Счётчик прочитанного не сбрасывается: если это тот же магазин, продолжаем
 * с того места, где остановились. А вот другой магазин — другая история, и
 * читать её надо с начала, иначе часть чужих записей никогда не приедет.
 */
export function saveSignIn(db: SqlDriver, url: string, who: SignedIn): void {
  setServerUrl(db, url);
  const link = getServer(db);
  const sameOrg = link?.org === who.org;

  db.run(
    `UPDATE server
        SET token = ?, org = ?, org_name = ?, user_id = ?, user_name = ?, role = ?,
            pulled = ?
      WHERE id = 1`,
    [
      who.token,
      who.org,
      who.orgName ?? null,
      who.userId,
      who.userName,
      who.role,
      sameOrg ? (link?.pulled ?? 0) : 0,
    ],
  );
}

/** Отметить, что обмен прошёл: до какого изменения дочитали и когда. */
export function markSynced(db: SqlDriver, pulled: number): void {
  db.run('UPDATE server SET pulled = ?, synced_at = ? WHERE id = 1', [
    pulled,
    new Date().toISOString(),
  ]);
}

/**
 * Выйти из учётной записи.
 *
 * Стирается только связь — товары, чеки и клиенты остаются на устройстве.
 * Выход из учётной записи не должен выглядеть как потеря склада: человек
 * выходит, чтобы войти под другим, а не чтобы всё стереть.
 */
export function signOut(db: SqlDriver): void {
  db.run(
    `UPDATE server
        SET token = NULL, org = NULL, org_name = NULL, user_id = NULL,
            user_name = NULL, role = NULL, pulled = 0, synced_at = NULL
      WHERE id = 1`,
  );
}
