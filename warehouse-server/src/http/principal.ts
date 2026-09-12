import type { FastifyRequest } from 'fastify';

import type { SqlDb } from '../db/driver.ts';
import { forbidden, unauthorized } from '../core/errors.ts';
import { API_KEY_PREFIX, principalFromApiKey, principalFromSession, type Principal } from '../auth/tokens.ts';

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

/** Достаёт токен из заголовка Authorization: Bearer <токен>. */
export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

export async function authenticate(db: SqlDb, request: FastifyRequest): Promise<Principal> {
  const token = bearerToken(request);
  if (!token) throw unauthorized();

  // Ключи интеграций отличаются префиксом — не нужно проверять обе таблицы.
  const principal = token.startsWith(API_KEY_PREFIX)
    ? await principalFromApiKey(db, token)
    : await principalFromSession(db, token);

  if (!principal) throw unauthorized('Токен недействителен или истёк');
  return principal;
}

export function requirePrincipal(request: FastifyRequest): Principal {
  if (!request.principal) throw unauthorized();
  return request.principal;
}

/** Действия, меняющие данные: продавцу можно продавать, но не править каталог. */
export function requireWrite(request: FastifyRequest): Principal {
  const principal = requirePrincipal(request);
  if (!principal.scopes.includes('write')) {
    throw forbidden('У ключа нет прав на запись');
  }
  return principal;
}

export function requireOwner(request: FastifyRequest): Principal {
  const principal = requireWrite(request);
  if (principal.role !== 'owner') {
    throw forbidden('Действие доступно только владельцу');
  }
  return principal;
}

/**
 * Продавец не должен видеть закупочные цены и прибыль — ни в приложении,
 * ни через API. Поля вырезаются здесь, на сервере: прятать их только
 * в интерфейсе бессмысленно, данные всё равно ушли бы на устройство.
 */
export function hidesCost(principal: Principal): boolean {
  return principal.role === 'seller';
}

const COST_FIELDS = ['cost_price', 'cost_total', 'profit', 'costValue'];

export function redact<T extends object>(value: T, principal: Principal): T;
export function redact<T extends object>(value: T[], principal: Principal): T[];
export function redact<T extends object>(value: T | T[], principal: Principal): T | T[] {
  if (!hidesCost(principal)) return value;
  if (Array.isArray(value)) return value.map((item) => redactOne(item));
  return redactOne(value);
}

function redactOne<T extends object>(value: T): T {
  const copy = { ...value } as Record<string, unknown>;
  for (const field of COST_FIELDS) delete copy[field];

  // Вложенные позиции чека тоже содержат себестоимость.
  if (Array.isArray(copy.items)) {
    copy.items = (copy.items as object[]).map((item) => redactOne(item));
  }
  return copy as T;
}
