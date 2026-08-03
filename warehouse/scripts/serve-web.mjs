/**
 * Локальный просмотр приложения в браузере.
 *
 * Обычного статического сервера мало: SQLite в браузере работает через
 * SharedArrayBuffer, а он доступен только на странице с заголовками
 * Cross-Origin-Opener-Policy и Cross-Origin-Embedder-Policy. Dev-сервер Expo
 * их не ставит, поэтому раздаём собранную версию сами.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', 'dist');
const PORT = Number(process.env.PORT ?? 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function resolveFile(urlPath) {
  // normalize + startsWith отсекают выход за пределы dist через "..".
  const relative = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const candidate = join(ROOT, relative);
  if (!candidate.startsWith(ROOT)) return null;

  try {
    const stats = await stat(candidate);
    if (stats.isDirectory()) return resolveFile(join(relative, 'index.html'));
    return candidate;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');

  const urlPath = new URL(req.url ?? '/', 'http://localhost').pathname;
  let file = await resolveFile(urlPath === '/' ? '/index.html' : urlPath);

  // Маршруты вроде /product/123 не существуют файлами — их разбирает
  // само приложение, поэтому отдаём index.html.
  if (!file && !extname(urlPath)) file = await resolveFile('/index.html');

  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Не найдено');
    return;
  }

  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n  Приложение открыто: http://localhost:${PORT}\n`);
  console.log('  Остановить — Ctrl+C\n');
});
