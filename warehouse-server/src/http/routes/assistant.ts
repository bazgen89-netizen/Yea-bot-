import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApiError } from '../../core/errors.ts';
import { ask, type Ask } from '../../core/assistant.ts';
import { requirePrincipal } from '../principal.ts';

const askBody = z.object({
  question: z.string().min(1).max(2_000),
  /** Описание таблиц устройства. Не секрет: данные остаются на устройстве. */
  schema: z.string().min(1).max(20_000),
});

/**
 * Помощник.
 *
 * Ручка одна и делает ровно одно: превращает вопрос в запрос. Считать по
 * этому запросу будет само устройство — сервер данных магазина здесь не
 * трогает вовсе, и это видно по тому, что базы у этих строк нет.
 */
export function assistantRoutes(app: FastifyInstance, model: Ask | null): void {
  app.post('/api/v1/assistant/ask', async (request) => {
    // Спрашивать может любой вошедший: помощник ничего не меняет, а видит
    // ровно то, что человек и так открывает глазами на своих экранах.
    requirePrincipal(request);

    if (!model) {
      throw new ApiError(
        503,
        'assistant_off',
        'Помощник на этом сервере не настроен: не задан ключ модели (ASSISTANT_KEY).',
      );
    }

    const body = askBody.parse(request.body);
    return ask(model, body);
  });
}
