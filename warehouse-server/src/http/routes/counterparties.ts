import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { SqlDb } from '../../db/driver.ts';
import {
  addPayment,
  createCounterparty,
  getCounterparty,
  listCounterparties,
  listPayments,
  partyHistory,
  updateCounterparty,
} from '../../core/counterparties.ts';
import { requireOwner, requirePrincipal } from '../principal.ts';

const uuid = z.string().uuid();
const kind = z.enum(['customer', 'supplier', 'both']);

const partyBody = z.object({
  id: uuid.optional(),
  kind,
  name: z.string().min(1).max(300),
  phone: z.string().max(50).nullish(),
  email: z.string().max(200).nullish(),
  note: z.string().max(1000).nullish(),
});

export function counterpartyRoutes(app: FastifyInstance, db: SqlDb): void {
  app.get('/api/v1/counterparties', async (request) => {
    // Продавцу список клиентов нужен: чек оформляется на покупателя.
    const principal = requirePrincipal(request);
    const query = z
      .object({
        kind: kind.optional(),
        search: z.string().optional(),
        include_archived: z.coerce.boolean().optional(),
        with_debt: z.coerce.boolean().optional(),
      })
      .parse(request.query);

    return listCounterparties(db, principal.orgId, {
      kind: query.kind,
      search: query.search,
      includeArchived: query.include_archived,
      withDebtOnly: query.with_debt,
    });
  });

  app.get<{ Params: { id: string } }>('/api/v1/counterparties/:id', async (request) => {
    const principal = requirePrincipal(request);
    return getCounterparty(db, principal.orgId, request.params.id);
  });

  app.post('/api/v1/counterparties', async (request, reply) => {
    // Продавец заводит нового клиента прямо на кассе — это его работа.
    const principal = requirePrincipal(request);
    const body = partyBody.parse(request.body);

    reply.code(201);
    return createCounterparty(db, principal.orgId, body);
  });

  app.patch<{ Params: { id: string } }>('/api/v1/counterparties/:id', async (request) => {
    const principal = requireOwner(request);
    const body = partyBody.partial().extend({ archived: z.boolean().optional() }).parse(request.body);

    return updateCounterparty(db, principal.orgId, request.params.id, body);
  });

  app.get<{ Params: { id: string } }>('/api/v1/counterparties/:id/history', async (request) => {
    const principal = requireOwner(request);
    const query = z.object({ limit: z.coerce.number().int().positive().optional() }).parse(request.query);

    return partyHistory(db, principal.orgId, request.params.id, query.limit);
  });

  app.get<{ Params: { id: string } }>('/api/v1/counterparties/:id/payments', async (request) => {
    const principal = requireOwner(request);
    return listPayments(db, principal.orgId, request.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/v1/counterparties/:id/payments', async (request, reply) => {
    const principal = requireOwner(request);
    const body = z
      .object({
        id: uuid.optional(),
        amount: z.number().int(),
        note: z.string().max(1000).optional(),
      })
      .parse(request.body);

    reply.code(201);
    return addPayment(db, principal.orgId, principal.userId, {
      ...body,
      counterparty_id: request.params.id,
    });
  });
}
