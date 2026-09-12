import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { SqlDb } from '../../db/driver.ts';
import { importCounterparties, importProducts } from '../../core/import.ts';
import { requireOwner } from '../principal.ts';

const amount = z.number().int();

const importBody = z.object({
  rows: z
    .array(
      z.object({
        name: z.string().min(1).max(300),
        code: z.string().max(50).nullish(),
        sku: z.string().max(100).nullish(),
        barcode: z.string().max(100).nullish(),
        unit: z.string().max(30).nullish(),
        sale_price: amount.min(0).optional(),
        purchase_price: amount.min(0).optional(),
        discount_bp: amount.min(0).max(10_000).optional(),
        // Название магазина → остаток в тысячных. Минус допустим: в выгрузке
        // из другой программы остатки бывают отрицательными.
        stocks: z.record(z.string(), amount).optional(),
      }),
    )
    .min(1)
    .max(5000),
});

const partiesBody = z.object({
  rows: z
    .array(
      z.object({
        name: z.string().min(1).max(300),
        kind: z.enum(['customer', 'supplier', 'both']).optional(),
        phone: z.string().max(50).nullish(),
        email: z.string().max(200).nullish(),
        note: z.string().max(1000).nullish(),
      }),
    )
    .min(1)
    .max(5000),
});

export function importRoutes(app: FastifyInstance, db: SqlDb): void {
  app.post('/api/v1/import/products', async (request) => {
    const principal = requireOwner(request);
    const body = importBody.parse(request.body);

    return importProducts(db, principal.orgId, principal.userId, body.rows);
  });

  app.post('/api/v1/import/counterparties', async (request) => {
    const principal = requireOwner(request);
    const body = partiesBody.parse(request.body);

    return importCounterparties(db, principal.orgId, body.rows);
  });
}
