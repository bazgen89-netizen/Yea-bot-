import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import type { SqlDb } from './db/driver.ts';
import { ApiError } from './core/errors.ts';
import { OutOfStockError } from './core/sales.ts';
import { authenticate } from './http/principal.ts';
import { authRoutes } from './http/routes/auth.ts';
import { counterpartyRoutes } from './http/routes/counterparties.ts';
import { docsRoutes } from './http/routes/docs.ts';
import { syncRoutes } from './http/routes/sync.ts';
import { warehouseRoutes } from './http/routes/warehouse.ts';

export interface ServerOptions {
  db: SqlDb;
  /** Разрешить самостоятельную регистрацию новых организаций. */
  allowRegistration?: boolean;
  logger?: boolean;
}

/** Пути, доступные без токена. */
const PUBLIC_PATHS = new Set([
  '/health',
  '/docs',
  '/api/v1/openapi.json',
  '/api/v1/auth/register',
  '/api/v1/auth/login',
]);

export function buildServer(options: ServerOptions): FastifyInstance {
  const { db } = options;
  const app = Fastify({ logger: options.logger ?? false });

  // Приложение и сторонние интеграции живут на других доменах.
  app.register(cors, { origin: true });

  app.addHook('onRequest', async (request) => {
    if (PUBLIC_PATHS.has(request.url.split('?')[0])) return;
    request.principal = await authenticate(db, request);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.status).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }

    if (error instanceof OutOfStockError) {
      return reply.code(409).send({
        error: { code: 'out_of_stock', message: error.message, details: error.shortages },
      });
    }

    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'validation_error',
          message: 'Проверьте поля запроса',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }

    // Fastify сам отдаёт 400 на битый JSON и 404 на неизвестный путь.
    const fastifyError = error as { statusCode?: number; message?: string };
    if (typeof fastifyError.statusCode === 'number' && fastifyError.statusCode < 500) {
      return reply.code(fastifyError.statusCode).send({
        error: { code: 'bad_request', message: fastifyError.message ?? 'Некорректный запрос' },
      });
    }

    // Наружу текст неизвестной ошибки не отдаём: в нём может оказаться
    // содержимое запроса к базе.
    request.log.error(error);
    return reply.code(500).send({
      error: { code: 'internal_error', message: 'Внутренняя ошибка сервера' },
    });
  });

  app.get('/health', async () => {
    await db.one('SELECT 1');
    return { ok: true };
  });

  authRoutes(app, db, options.allowRegistration ?? true);
  warehouseRoutes(app, db);
  counterpartyRoutes(app, db);
  syncRoutes(app, db);
  docsRoutes(app);

  return app;
}
