import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { SqlDb } from '../../db/driver.ts';
import {
  createLocation,
  createProduct,
  deleteCategory,
  ensureCategory,
  findByBarcode,
  getProduct,
  listCategories,
  listLocations,
  listProducts,
  updateLocation,
  updateProduct,
} from '../../core/catalog.ts';
import { notFound } from '../../core/errors.ts';
import {
  adjustStock,
  getDoc,
  listDocs,
  listMoves,
  postDoc,
  stockByLocation,
} from '../../core/stock.ts';
import { createSale, getSale, listSales, refundSale } from '../../core/sales.ts';
import {
  dailySales,
  salesByLocation,
  salesSummary,
  stockValue,
  topProducts,
} from '../../core/reports.ts';
import { redact, requireOwner, requirePrincipal, requireWrite } from '../principal.ts';

const uuid = z.string().uuid();
/** Цены и количества всегда целые: копейки и тысячные. */
const amount = z.number().int();

const productBody = z.object({
  id: uuid.optional(),
  name: z.string().min(1).max(300),
  sku: z.string().max(100).nullish(),
  barcode: z.string().max(100).nullish(),
  category_id: uuid.nullish(),
  category_name: z.string().max(200).nullish(),
  unit: z.string().max(30).optional(),
  cost_price: amount.min(0).optional(),
  sale_price: amount.min(0).optional(),
  min_qty: amount.min(0).optional(),
  photo_uri: z.string().max(2000).nullish(),
});

const productPatch = productBody.partial().extend({ archived: z.boolean().optional() });

const docBody = z.object({
  id: uuid.optional(),
  type: z.enum(['receipt', 'writeoff', 'transfer']),
  location_id: uuid,
  to_location_id: uuid.nullish(),
  counterparty: z.string().max(300).nullish(),
  supplier_id: uuid.nullish(),
  note: z.string().max(1000).nullish(),
  created_at: z.string().datetime().optional(),
  lines: z
    .array(
      z.object({
        product_id: uuid,
        qty: amount.positive(),
        price: amount.min(0).optional(),
      }),
    )
    .min(1),
});

const adjustBody = z.object({
  product_id: uuid,
  location_id: uuid,
  actual_qty: amount.min(0),
  note: z.string().max(1000).optional(),
});

const saleBody = z.object({
  id: uuid.optional(),
  location_id: uuid,
  customer_id: uuid.nullish(),
  discount: amount.min(0).optional(),
  payment: z.enum(['cash', 'card', 'transfer', 'credit']).optional(),
  created_at: z.string().datetime().optional(),
  lines: z
    .array(
      z.object({
        product_id: uuid,
        qty: amount.positive(),
        price: amount.min(0),
        // Себестоимость принимается для совместимости, но игнорируется:
        // сервер берёт её из карточки товара.
        cost_price: amount.min(0).optional(),
      }),
    )
    .min(1),
});

const periodQuery = z.object({
  from: z.string(),
  to: z.string(),
  location_id: uuid.optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export function warehouseRoutes(app: FastifyInstance, db: SqlDb): void {
  // --- Точки --------------------------------------------------------------

  app.get('/api/v1/locations', async (request) => {
    const principal = requirePrincipal(request);
    return listLocations(db, principal.orgId);
  });

  app.post('/api/v1/locations', async (request, reply) => {
    const principal = requireOwner(request);
    const body = z
      .object({ id: uuid.optional(), name: z.string().min(1).max(200), address: z.string().max(500).nullish() })
      .parse(request.body);

    reply.code(201);
    return createLocation(db, principal.orgId, body);
  });

  app.patch<{ Params: { id: string } }>('/api/v1/locations/:id', async (request) => {
    const principal = requireOwner(request);
    const body = z
      .object({
        name: z.string().min(1).max(200).optional(),
        address: z.string().max(500).nullish(),
        archived: z.boolean().optional(),
      })
      .parse(request.body);

    return updateLocation(db, principal.orgId, request.params.id, body);
  });

  // --- Категории ----------------------------------------------------------

  app.get('/api/v1/categories', async (request) => {
    const principal = requirePrincipal(request);
    return listCategories(db, principal.orgId);
  });

  app.post('/api/v1/categories', async (request, reply) => {
    const principal = requireOwner(request);
    const body = z.object({ name: z.string().min(1).max(200) }).parse(request.body);

    reply.code(201);
    return ensureCategory(db, principal.orgId, body.name);
  });

  app.delete<{ Params: { id: string } }>('/api/v1/categories/:id', async (request) => {
    const principal = requireOwner(request);
    await deleteCategory(db, principal.orgId, request.params.id);
    return { ok: true };
  });

  // --- Товары -------------------------------------------------------------

  app.get('/api/v1/products', async (request) => {
    const principal = requirePrincipal(request);
    const query = z
      .object({
        search: z.string().optional(),
        location_id: uuid.optional(),
        category_id: uuid.optional(),
        include_archived: z.coerce.boolean().optional(),
        low_stock: z.coerce.boolean().optional(),
        limit: z.coerce.number().int().positive().optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .parse(request.query);

    const products = await listProducts(db, principal.orgId, {
      search: query.search,
      locationId: query.location_id,
      categoryId: query.category_id,
      includeArchived: query.include_archived,
      lowStockOnly: query.low_stock,
      limit: query.limit,
      offset: query.offset,
    });

    return redact(products, principal);
  });

  app.get<{ Params: { id: string } }>('/api/v1/products/:id', async (request) => {
    const principal = requirePrincipal(request);
    const query = z.object({ location_id: uuid.optional() }).parse(request.query);

    const product = await getProduct(db, principal.orgId, request.params.id, query.location_id);
    return redact(product, principal);
  });

  app.get<{ Params: { barcode: string } }>(
    '/api/v1/products/by-barcode/:barcode',
    async (request) => {
      const principal = requirePrincipal(request);
      const query = z.object({ location_id: uuid.optional() }).parse(request.query);

      const product = await findByBarcode(
        db,
        principal.orgId,
        request.params.barcode,
        query.location_id,
      );
      if (!product) throw notFound('Товар с таким штрихкодом не найден');
      return redact(product, principal);
    },
  );

  app.post('/api/v1/products', async (request, reply) => {
    const principal = requireOwner(request);
    const body = productBody.parse(request.body);

    // Категорию можно передать названием — телефон не обязан знать её id.
    const categoryId = body.category_name
      ? (await ensureCategory(db, principal.orgId, body.category_name)).id
      : (body.category_id ?? null);

    reply.code(201);
    return createProduct(db, principal.orgId, { ...body, category_id: categoryId });
  });

  app.patch<{ Params: { id: string } }>('/api/v1/products/:id', async (request) => {
    const principal = requireOwner(request);
    const body = productPatch.parse(request.body);

    const patch = { ...body };
    if (body.category_name) {
      patch.category_id = (await ensureCategory(db, principal.orgId, body.category_name)).id;
    }
    delete patch.category_name;

    return updateProduct(db, principal.orgId, request.params.id, patch);
  });

  app.get<{ Params: { id: string } }>('/api/v1/products/:id/stock', async (request) => {
    const principal = requirePrincipal(request);
    return stockByLocation(db, principal.orgId, request.params.id);
  });

  app.get<{ Params: { id: string } }>('/api/v1/products/:id/moves', async (request) => {
    const principal = requirePrincipal(request);
    const query = z
      .object({ location_id: uuid.optional(), limit: z.coerce.number().int().positive().optional() })
      .parse(request.query);

    const moves = await listMoves(db, principal.orgId, {
      productId: request.params.id,
      locationId: query.location_id,
      limit: query.limit,
    });
    // В движениях прихода лежит закупочная цена — продавцу её видеть не нужно.
    return principal.role === 'seller' ? moves.map(({ price, ...rest }) => rest) : moves;
  });

  // --- Документы склада ---------------------------------------------------

  app.get('/api/v1/docs', async (request) => {
    const principal = requireOwner(request);
    const query = z
      .object({ location_id: uuid.optional(), limit: z.coerce.number().int().positive().optional() })
      .parse(request.query);

    return listDocs(db, principal.orgId, {
      locationId: query.location_id,
      limit: query.limit,
    });
  });

  app.get<{ Params: { id: string } }>('/api/v1/docs/:id', async (request) => {
    const principal = requireOwner(request);
    return getDoc(db, principal.orgId, request.params.id);
  });

  app.post('/api/v1/docs', async (request, reply) => {
    const principal = requireOwner(request);
    const body = docBody.parse(request.body);

    reply.code(201);
    return postDoc(db, principal.orgId, principal.userId, body);
  });

  app.post('/api/v1/docs/adjust', async (request, reply) => {
    const principal = requireOwner(request);
    const body = adjustBody.parse(request.body);

    reply.code(201);
    return adjustStock(db, principal.orgId, principal.userId, body);
  });

  // --- Продажи ------------------------------------------------------------

  app.get('/api/v1/sales', async (request) => {
    const principal = requirePrincipal(request);
    const query = z
      .object({ location_id: uuid.optional(), limit: z.coerce.number().int().positive().optional() })
      .parse(request.query);

    const sales = await listSales(db, principal.orgId, {
      locationId: query.location_id,
      limit: query.limit,
    });
    return redact(sales, principal);
  });

  app.get<{ Params: { id: string } }>('/api/v1/sales/:id', async (request) => {
    const principal = requirePrincipal(request);
    const sale = await getSale(db, principal.orgId, request.params.id);
    return redact(sale, principal);
  });

  app.post('/api/v1/sales', async (request, reply) => {
    // Продавать может и продавец — это его работа.
    const principal = requireWrite(request);
    const body = saleBody.parse(request.body);

    const sale = await createSale(db, principal.orgId, principal.userId, body);
    reply.code(201);
    return redact(sale, principal);
  });

  app.post<{ Params: { id: string } }>('/api/v1/sales/:id/refund', async (request) => {
    const principal = requireWrite(request);
    const sale = await refundSale(db, principal.orgId, principal.userId, request.params.id);
    return redact(sale, principal);
  });

  // --- Отчёты -------------------------------------------------------------

  app.get('/api/v1/reports/summary', async (request) => {
    const principal = requireOwner(request);
    const query = periodQuery.parse(request.query);
    return salesSummary(db, principal.orgId, query, query.location_id);
  });

  app.get('/api/v1/reports/top-products', async (request) => {
    const principal = requireOwner(request);
    const query = periodQuery.parse(request.query);
    return topProducts(db, principal.orgId, query, {
      locationId: query.location_id,
      limit: query.limit,
    });
  });

  app.get('/api/v1/reports/daily', async (request) => {
    const principal = requireOwner(request);
    const query = periodQuery.parse(request.query);
    return dailySales(db, principal.orgId, query, query.location_id);
  });

  app.get('/api/v1/reports/by-location', async (request) => {
    const principal = requireOwner(request);
    const query = periodQuery.parse(request.query);
    return salesByLocation(db, principal.orgId, query);
  });

  app.get('/api/v1/reports/stock-value', async (request) => {
    const principal = requireOwner(request);
    const query = z.object({ location_id: uuid.optional() }).parse(request.query);
    return stockValue(db, principal.orgId, query.location_id);
  });
}
