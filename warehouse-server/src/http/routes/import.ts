import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { SqlDb } from '../../db/driver.ts';
import { importProducts } from '../../core/import.ts';
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

export function importRoutes(app: FastifyInstance, db: SqlDb): void {
  app.post('/api/v1/import/products', async (request) => {
    const principal = requireOwner(request);
    const body = importBody.parse(request.body);

    return importProducts(db, principal.orgId, principal.userId, body.rows);
  });
}
