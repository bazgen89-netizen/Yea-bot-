import { createPgDb } from './db/pg.ts';
import { migrate } from './db/schema.ts';
import { buildServer } from './server.ts';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ Не задана переменная DATABASE_URL');
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

const db = createPgDb(connectionString);
await migrate(db);

const app = buildServer({
  db,
  allowRegistration: process.env.ALLOW_REGISTRATION !== 'false',
  logger: true,
});

// Контейнер останавливают сигналом — надо успеть дочитать текущие запросы
// и закрыть соединения с базой, иначе в логах будут оборванные транзакции.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      await app.close();
      await db.close();
      process.exit(0);
    })();
  });
}

await app.listen({ port, host });
console.log(`✅ Сервер склада слушает ${host}:${port}`);
