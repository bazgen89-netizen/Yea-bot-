import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { SqlDb } from '../../db/driver.ts';
import { ORDER, pull, push, type PushPayload } from '../../core/sync.ts';
import { forbidden } from '../../core/errors.ts';
import { redact, requirePrincipal, requireWrite } from '../principal.ts';

const row = z.record(z.string(), z.unknown());

/**
 * Незнакомые таблицы намеренно пропускаются внутрь, а не отсекаются здесь.
 *
 * Если срезать их на входе, сервер даже не узнает, что ему что-то присылали,
 * и не сможет об этом сказать. А сказать надо: телефон новее сервера — дело
 * обычное, и человек должен услышать «обнови сервер», а не увидеть бодрое
 * «отправлено 4690» и потерять клиентскую базу.
 */
const pushBody = z
  .object({
    locations: z.array(row).optional(),
    categories: z.array(row).optional(),
    products: z.array(row).optional(),
    counterparties: z.array(row).optional(),
    docs: z.array(row).optional(),
    sales: z.array(row).optional(),
    sale_items: z.array(row).optional(),
    stock_moves: z.array(row).optional(),
  })
  .passthrough();

const pullQuery = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().positive().max(2000).default(500),
});

/**
 * Продавец синхронизирует только то, что сам создаёт: продажи и покупателей.
 *
 * Покупатель здесь не случайно. Завести карту постоянного гостя — обычное
 * дело за прилавком, и запретить это значило бы либо потерять нового
 * клиента, либо уронить весь обмен вместе с его чеками.
 */
const SELLER_TABLES = new Set(['sales', 'sale_items', 'stock_moves', 'counterparties']);

export function syncRoutes(app: FastifyInstance, db: SqlDb): void {
  app.post('/api/v1/sync/push', async (request) => {
    const principal = requireWrite(request);
    const body = pushBody.parse(request.body);

    if (principal.role === 'seller') {
      const forbiddenTables = Object.keys(body).filter((table) => {
        if (SELLER_TABLES.has(table)) return false;
        const rows = (body as PushPayload)[table as keyof PushPayload];
        // Незнакомая таблица — не повод отказывать: её сервер и так не примет
        // и честно назовёт в ответе.
        return Array.isArray(rows) && rows.length > 0 && (ORDER as string[]).includes(table);
      });
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
