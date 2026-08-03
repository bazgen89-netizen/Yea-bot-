import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { SqlDb } from '../../db/driver.ts';
import { pull, push, type PushPayload } from '../../core/sync.ts';
import { forbidden } from '../../core/errors.ts';
import { redact, requirePrincipal, requireWrite } from '../principal.ts';

const row = z.record(z.string(), z.unknown());

const pushBody = z.object({
  locations: z.array(row).optional(),
  categories: z.array(row).optional(),
  products: z.array(row).optional(),
  docs: z.array(row).optional(),
  sales: z.array(row).optional(),
  sale_items: z.array(row).optional(),
  stock_moves: z.array(row).optional(),
});

const pullQuery = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().positive().max(2000).default(500),
});

/** Продавец синхронизирует только то, что сам создаёт: продажи. */
const SELLER_TABLES = new Set(['sales', 'sale_items', 'stock_moves']);

export function syncRoutes(app: FastifyInstance, db: SqlDb): void {
  app.post('/api/v1/sync/push', async (request) => {
    const principal = requireWrite(request);
    const body = pushBody.parse(request.body);

    if (principal.role === 'seller') {
      const forbiddenTables = Object.keys(body).filter(
        (table) => !SELLER_TABLES.has(table) && (body as PushPayload)[table as keyof PushPayload]?.length,
      );
      if (forbiddenTables.length > 0) {
        throw forbidden(`Продавец не может изменять: ${forbiddenTables.join(', ')}`);
      }
    }

    return push(db, principal.orgId, principal.userId, body);
  });

  app.get('/api/v1/sync/pull', async (request) => {
    const principal = requirePrincipal(request);
    const query = pullQuery.parse(request.query);

    const result = await pull(db, principal.orgId, query.since, query.limit);

    // Закупочные цены не должны уезжать на устройство продавца даже здесь.
    result.changes.products = redact(result.changes.products, principal);
    result.changes.sales = redact(result.changes.sales, principal);
    result.changes.sale_items = redact(result.changes.sale_items, principal);

    return result;
  });
}
