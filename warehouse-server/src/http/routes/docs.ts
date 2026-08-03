import type { FastifyInstance } from 'fastify';

import { openapi } from '../../openapi.ts';

/**
 * Документация API.
 *
 * Страница рендерится своим кодом, без Swagger UI с чужого CDN: сервер может
 * стоять в закрытом контуре, где внешние адреса недоступны, и документация
 * не должна от этого ломаться.
 */
export function docsRoutes(app: FastifyInstance): void {
  app.get('/api/v1/openapi.json', async () => openapi);

  app.get('/docs', async (_request, reply) => {
    reply.type('text/html; charset=utf-8');
    return page();
  });
}

interface Operation {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: { name: string; in: string; required?: boolean; description?: string }[];
  security?: unknown[];
}

function page(): string {
  const byTag = new Map<string, { method: string; path: string; op: Operation }[]>();

  for (const [path, methods] of Object.entries(openapi.paths)) {
    for (const [method, operation] of Object.entries(methods as unknown as Record<string, Operation>)) {
      const tag = operation.tags?.[0] ?? 'Прочее';
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push({ method: method.toUpperCase(), path, op: operation });
    }
  }

  const sections = [...byTag.entries()]
    .map(([tag, operations]) => {
      const rows = operations
        .map(({ method, path, op }) => {
          const params = (op.parameters ?? [])
            .filter((parameter) => parameter.in === 'query')
            .map((parameter) => escape(parameter.name))
            .join(', ');

          return `<article>
            <header>
              <span class="m m-${method.toLowerCase()}">${method}</span>
              <code>${escape(path)}</code>
              ${op.security?.length === 0 ? '<span class="open">без токена</span>' : ''}
            </header>
            <p class="summary">${escape(op.summary ?? '')}</p>
            ${op.description ? `<p class="desc">${escape(op.description)}</p>` : ''}
            ${params ? `<p class="params">Параметры: <code>${params}</code></p>` : ''}
          </article>`;
        })
        .join('');

      return `<section><h2>${escape(tag)}</h2>${rows}</section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(openapi.info.title)}</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#14181f; --muted:#697386; --line:#e3e6eb; --accent:#1f6f4a; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#14181f; --fg:#e8eaed; --muted:#9aa4b2; --line:#2a3039; --accent:#5fbf8f; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem 1rem 4rem; background:var(--bg); color:var(--fg);
         font:16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 52rem; margin: 0 auto; }
  h1 { font-size: 1.7rem; margin: 0 0 .5rem; }
  h2 { font-size: 1.15rem; margin: 2.5rem 0 .75rem; padding-bottom:.4rem; border-bottom:1px solid var(--line); }
  .intro { color: var(--muted); white-space: pre-wrap; }
  .intro strong { color: var(--fg); }
  article { border:1px solid var(--line); border-radius:.6rem; padding:.75rem 1rem; margin:.6rem 0; }
  header { display:flex; align-items:center; gap:.6rem; flex-wrap:wrap; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:.9em; }
  .m { font-size:.72rem; font-weight:700; padding:.15rem .45rem; border-radius:.3rem; color:#fff; letter-spacing:.03em; }
  .m-get{background:#1f6f4a}.m-post{background:#1d4ed8}.m-patch{background:#b26b00}.m-delete{background:#c0392b}
  .open { font-size:.72rem; color:var(--muted); border:1px solid var(--line); padding:.1rem .4rem; border-radius:.3rem; }
  .summary { margin:.5rem 0 0; }
  .desc, .params { margin:.35rem 0 0; color:var(--muted); font-size:.9rem; }
  a { color: var(--accent); }
</style>
</head>
<body>
<main>
  <h1>${escape(openapi.info.title)}</h1>
  <p class="intro">${escape(openapi.info.description)}</p>
  <p><a href="/api/v1/openapi.json">Машинное описание OpenAPI 3.1 →</a></p>
  ${sections}
</main>
</body>
</html>`;
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
