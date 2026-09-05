import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { SqlDb } from '../../db/driver.ts';
import { hashPassword, validatePassword, verifyPassword } from '../../auth/passwords.ts';
import { generateApiKey, hashToken, issueSessionToken, type Role } from '../../auth/tokens.ts';
import { createLocation } from '../../core/catalog.ts';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../core/errors.ts';
import { bearerToken, requireOwner, requirePrincipal } from '../principal.ts';

const registerBody = z.object({
  org_name: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  email: z.string().email().max(200),
  password: z.string(),
});

const loginBody = z.object({
  email: z.string().email(),
  password: z.string(),
  device_name: z.string().max(200).optional(),
});

const userBody = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(200),
  password: z.string(),
  role: z.enum(['owner', 'seller']),
});

const userPatch = z.object({
  name: z.string().min(1).max(200).optional(),
  role: z.enum(['owner', 'seller']).optional(),
  disabled: z.boolean().optional(),
  password: z.string().optional(),
});

const apiKeyBody = z.object({
  name: z.string().min(1).max(200),
  scopes: z.array(z.enum(['read', 'write'])).min(1),
});

interface UserRow {
  id: string;
  org_id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  password_hash: string;
}

export function authRoutes(app: FastifyInstance, db: SqlDb, allowRegistration: boolean): void {
  /**
   * Регистрация создаёт организацию, её владельца и первую точку.
   * Точка нужна сразу: без неё некуда оприходовать товар.
   */
  app.post('/api/v1/auth/register', async (request, reply) => {
    if (!allowRegistration) throw forbidden('Регистрация закрыта');

    const body = registerBody.parse(request.body);
    const passwordError = validatePassword(body.password);
    if (passwordError) throw badRequest(passwordError);

    const email = body.email.trim().toLowerCase();
    const existing = await db.one('SELECT 1 FROM users WHERE email = $1', [email]);
    if (existing) throw conflict('Пользователь с такой почтой уже есть');

    const result = await db.tx(async (tx) => {
      const orgId = randomUUID();
      await tx.query('INSERT INTO orgs (id, name) VALUES ($1, $2)', [orgId, body.org_name.trim()]);

      const userId = randomUUID();
      await tx.query(
        `INSERT INTO users (id, org_id, email, password_hash, name, role)
         VALUES ($1, $2, $3, $4, $5, 'owner')`,
        [userId, orgId, email, await hashPassword(body.password), body.name.trim()],
      );

      const location = await createLocation(tx, orgId, { name: 'Основная точка' });
      return { orgId, userId, location };
    });

    const session = await issueSessionToken(db, result.userId, null);

    reply.code(201);
    return {
      token: session.token,
      expires_at: session.expiresAt,
      user: { id: result.userId, org_id: result.orgId, name: body.name, email, role: 'owner' },
      location: result.location,
    };
  });

  app.post('/api/v1/auth/login', async (request) => {
    const body = loginBody.parse(request.body);
    const email = body.email.trim().toLowerCase();

    const user = await db.one<UserRow>('SELECT * FROM users WHERE email = $1', [email]);

    // Пароль проверяем даже когда пользователя нет: иначе по времени ответа
    // можно перебрать, какие адреса зарегистрированы.
    const stored = user?.password_hash ?? 'scrypt$32768$8$1$AAAA$AAAA';
    const ok = await verifyPassword(body.password, stored);

    if (!user || !ok || user.disabled) throw unauthorized('Неверная почта или пароль');

    const session = await issueSessionToken(db, user.id, body.device_name ?? null);
    return {
      token: session.token,
      expires_at: session.expiresAt,
      user: { id: user.id, org_id: user.org_id, name: user.name, email: user.email, role: user.role },
    };
  });

  app.post('/api/v1/auth/logout', async (request) => {
    const token = bearerToken(request);
    if (token) await db.query('DELETE FROM tokens WHERE token_hash = $1', [hashToken(token)]);
    return { ok: true };
  });

  app.get('/api/v1/me', async (request) => {
    const principal = requirePrincipal(request);
    if (!principal.userId) return { kind: 'api_key', org_id: principal.orgId, scopes: principal.scopes };

    const user = await db.one<UserRow>(
      'SELECT id, org_id, email, name, role FROM users WHERE id = $1',
      [principal.userId],
    );
    return { kind: 'user', ...user };
  });

  // --- Сотрудники (только владелец) --------------------------------------

  app.get('/api/v1/users', async (request) => {
    const principal = requireOwner(request);
    return db.query(
      `SELECT id, email, name, role, disabled, created_at
       FROM users WHERE org_id = $1 ORDER BY created_at`,
      [principal.orgId],
    );
  });

  app.post('/api/v1/users', async (request, reply) => {
    const principal = requireOwner(request);
    const body = userBody.parse(request.body);

    const passwordError = validatePassword(body.password);
    if (passwordError) throw badRequest(passwordError);

    const email = body.email.trim().toLowerCase();
    if (await db.one('SELECT 1 FROM users WHERE email = $1', [email])) {
      throw conflict('Пользователь с такой почтой уже есть');
    }

    const id = randomUUID();
    await db.query(
      `INSERT INTO users (id, org_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, principal.orgId, email, await hashPassword(body.password), body.name.trim(), body.role],
    );

    reply.code(201);
    return { id, email, name: body.name, role: body.role, disabled: false };
  });

  app.patch<{ Params: { id: string } }>('/api/v1/users/:id', async (request) => {
    const principal = requireOwner(request);
    const patch = userPatch.parse(request.body);

    const target = await db.one<UserRow>('SELECT * FROM users WHERE id = $1 AND org_id = $2', [
      request.params.id,
      principal.orgId,
    ]);
    if (!target) throw notFound('Сотрудник не найден');

    // Владелец не должен случайно отключить сам себя и потерять доступ.
    if (target.id === principal.userId && (patch.disabled || patch.role === 'seller')) {
      throw badRequest('Нельзя понизить или отключить самого себя');
    }

    const sets: string[] = [];
    const params: unknown[] = [target.id];
    const assign = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (patch.name !== undefined) assign('name', patch.name.trim());
    if (patch.role !== undefined) assign('role', patch.role);
    if (patch.disabled !== undefined) assign('disabled', patch.disabled);

    if (patch.password !== undefined) {
      const passwordError = validatePassword(patch.password);
      if (passwordError) throw badRequest(passwordError);
      assign('password_hash', await hashPassword(patch.password));
    }

    if (sets.length > 0) {
      await db.query(
        `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
        params,
      );
    }

    // Смена пароля или отключение должны выкидывать уже открытые сессии.
    if (patch.password !== undefined || patch.disabled) {
      await db.query('DELETE FROM tokens WHERE user_id = $1', [target.id]);
    }

    return db.one('SELECT id, email, name, role, disabled FROM users WHERE id = $1', [target.id]);
  });

  // --- Ключи интеграций (только владелец) --------------------------------

  app.get('/api/v1/api-keys', async (request) => {
    const principal = requireOwner(request);
    return db.query(
      `SELECT id, name, key_prefix, scopes, created_at, last_used_at, revoked_at
       FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC`,
      [principal.orgId],
    );
  });

  app.post('/api/v1/api-keys', async (request, reply) => {
    const principal = requireOwner(request);
    const body = apiKeyBody.parse(request.body);

    const { key, prefix } = generateApiKey();
    const id = randomUUID();

    await db.query(
      `INSERT INTO api_keys (id, org_id, name, key_hash, key_prefix, scopes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, principal.orgId, body.name.trim(), hashToken(key), prefix, body.scopes],
    );

    reply.code(201);
    // Полный ключ показывается один раз: в базе лежит только его хеш.
    return { id, name: body.name, scopes: body.scopes, key };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/api-keys/:id', async (request) => {
    const principal = requireOwner(request);
    const row = await db.one(
      `UPDATE api_keys SET revoked_at = now()
       WHERE id = $1 AND org_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [request.params.id, principal.orgId],
    );
    if (!row) throw notFound('Ключ не найден или уже отозван');
    return { ok: true };
  });
}
