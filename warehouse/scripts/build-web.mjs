#!/usr/bin/env node
/**
 * Собирает веб-версию в один самодостаточный файл `dist/index.html`.
 *
 *   node scripts/build-web.mjs
 *
 * Зачем один файл: так страницу можно положить на любой статический хостинг
 * и открыть по ссылке — ни одного стороннего запроса она не делает. Внутрь
 * попадают код приложения, sql.js, сам SQLite в WebAssembly и шрифты иконок.
 *
 * Запускать после `expo export --platform web` — этим занимается `npm run web:build`.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const html = await readFile(join(dist, 'index.html'), 'utf8');

// Экспорт Expo кладёт бандл с хешем в имени — находим его по ссылке в странице.
const scriptTag = html.match(/<script src="([^"]+entry-[^"]+\.js)" defer><\/script>/);
if (!scriptTag) {
  throw new Error(
    'Не нашёл в index.html ссылку на бандл приложения.\n' +
      'Скорее всего страница уже собрана в один файл — начните заново:\n' +
      '  npx expo export --platform web --clear && node scripts/build-web.mjs',
  );
}

const bundle = await readFile(join(dist, scriptTag[1].replace(/^\//, '')), 'utf8');
const sqlJs = await readFile(join(root, 'node_modules/sql.js/dist/sql-wasm.js'), 'utf8');
const wasm = await readFile(join(root, 'node_modules/sql.js/dist/sql-wasm.wasm'));
const icon = await readFile(join(dist, 'favicon.ico')).catch(() => null);

let page = replaceOnce(
  html,
  scriptTag[0],
  [
    // Порядок важен: sql.js должен объявить initSqlJs до запуска приложения.
    `<script>globalThis.__SQL_WASM_BASE64__=${JSON.stringify(wasm.toString('base64'))};</script>`,
    `<script>${sqlJs}</script>`,
    `<script>${bundle}</script>`,
  ].join('\n'),
);

if (icon) {
  page = replaceOnce(
    page,
    /<link rel="icon"[^>]*>/,
    `<link rel="icon" href="data:image/x-icon;base64,${icon.toString('base64')}"/>`,
  );
}

// Шрифты иконок бандл грузит по ссылке — подменяем ссылки на сами шрифты.
let inlined = 0;
for (const file of await walk(join(dist, 'assets'))) {
  const url = '/' + relative(dist, file).split('\\').join('/');
  if (!page.includes(url)) continue;

  const data = await readFile(file);
  page = page.split(url).join(`data:${mime(file)};base64,${data.toString('base64')}`);
  inlined++;
}

await writeFile(join(dist, 'index.html'), page);

const size = (Buffer.byteLength(page) / 1024 / 1024).toFixed(1);
console.log(`dist/index.html — один файл, ${size} МБ (вшито шрифтов и картинок: ${inlined})`);

if (/(?:src|href)="\/(?!\/)/.test(page)) {
  throw new Error('В странице остались ссылки на внешние файлы — она не самодостаточна');
}

/**
 * Замена без подстановок. Обычный `String.replace` толкует `$&` и `$'`
 * в тексте замены как ссылки на найденный кусок, а в бандле такие сочетания
 * встречаются и молча ломают код. Функция-заменитель это отключает.
 */
function replaceOnce(text, pattern, replacement) {
  return text.replace(pattern, () => replacement);
}

async function walk(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(path)));
    else found.push(path);
  }
  return found;
}

function mime(file) {
  return (
    {
      '.ttf': 'font/ttf',
      '.otf': 'font/otf',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    }[extname(file)] ?? 'application/octet-stream'
  );
}
