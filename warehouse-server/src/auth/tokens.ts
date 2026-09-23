import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { SqlDb } from '../db/driver.ts';

/** Токен сессии живёт долго: продавец не должен логиниться каждое утро. */
export const SESSION_TTL_DAYS = 180;

export type Role = 'owner' | 'seller';
export type Scope = 'read' | 'write';

export interface Principal {
  orgId: string;
  /** Для сессии пользователя — его id; для ключа интеграции — null. */
  userId: string | null;
  role: Role;
  scopes: Scope[];
  kind: 'user' | 'api_key';
}

/**
 * В базе лежит только SHA-256 от токена. Хеширование здесь быстрое (в отличие
 * от паролей) намеренно: токен — случайные 32 байта, перебирать его нечем,
 * а проверять его приходится на каждом запросе.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

export async function issueSessionToken(
  db: SqlDb,
  userId: string,
  deviceName: string | null,
): Promise<IssuedToken> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO tokens (id, user_id, token_hash, device_name, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), userId, hashToken(token), deviceName, expiresAt],
  );

  return { token, expiresAt };
}

interface SessionRow {
  org_id: string;
  user_id: string;
  role: Role;
  disabled: boolean;
}

export async function principalFromSession(db: SqlDb, token: string): Promise<Principal | null> {
  const row = await db.one<SessionRow>(
    `SELECT u.org_id, u.id AS user_id, u.role, u.disabled
     FROM tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1 AND t.expires_at > now()`,
    [hashToken(token)],
  );

  if (!row || row.disabled) return null;

  // Отметка «когда пользовались» нужна, чтобы владелец видел активные устройства.
  // Не ждём завершения: на скорость ответа это влиять не должно.
  void db.query('UPDATE tokens SET last_used_at = now() WHERE token_hash = $1', [hashToken(token)]);

  return {
    orgId: row.org_id,
    userId: row.user_id,
    role: row.role,
    // Пользователь-владелец может всё; продавец ограничен ролью, а не scope.
    scopes: ['read', 'write'],
    kind: 'user',
  };
}

interface ApiKeyRow {
  id: string;
  org_id: string;
  scopes: Scope[];
}

export async function principalFromApiKey(db: SqlDb, key: string): Promise<Principal | null> {
  const row = await db.one<ApiKeyRow>(
    `SELECT id, org_id, scopes FROM api_keys
     WHERE key_hash = $1 AND revoked_at IS NULL`,
    [hashToken(key)],
  );

  if (!row) return null;

  void db.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [row.id]);

  return {
    orgId: row.org_id,
    userId: null,
    // Ключ интеграции видит всё, что видит владелец, но ограничен scopes:
    // ключу «только чтение» нельзя провести продажу.
    role: 'owner',
    scopes: row.scopes,
    kind: 'api_key',
  };
}

export const API_KEY_PREFIX = 'whk_';

export function generateApiKey(): { key: string; prefix: string } {
  const key = API_KEY_PREFIX + generateToken();
  // Первые символы показываем в списке ключей, чтобы владелец мог понять,
  // какой из них отзывает, не храня сам ключ.
  return { key, prefix: key.slice(0, 12) };
}
