/**
 * Страница для показа по ссылке — из сборки без личных данных.
 *
 *   node scripts/build-demo.mjs && node scripts/build-artifact.mjs
 *
 * Отличие от `dist-demo/index.html` одно: снят внешний каркас. Тот, кто
 * публикует страницу, оборачивает её в свои `<!doctype>`, `<head>` и `<body>`
 * сам, и вторая пара тех же тегов внутри ломает разметку.
 *
 * Заголовок ставится свой: `<title>Склад</title>` из сборки Expo — это имя
 * вкладки по умолчанию, а не название программы.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = `${root}/dist-demo/index.html`;
const target = `${root}/dist-demo/artifact.html`;

const TITLE = 'WAYSTEA · склад и касса';

let page = readFileSync(source, 'utf8');

// Порядок важен: сперва убираем заголовок Expo, потом каркас — иначе
// `</head>` уедет вместе с ним и найти его будет негде.
page = page.replace(/<title>[^<]*<\/title>\s*/i, '');

for (const tag of [
  /<!DOCTYPE html>\s*/i,
  /<html[^>]*>\s*/i,
  /<head>\s*/i,
  /<\/head>\s*/i,
  /<body[^>]*>\s*/i,
  /\s*<\/body>/i,
  /\s*<\/html>\s*$/i,
]) {
  const before = page.length;
  page = page.replace(tag, '');
  if (page.length === before) throw new Error(`Не нашёл в сборке: ${tag}`);
}

writeFileSync(target, `<title>${TITLE}</title>\n${page}`);

const mb = (readFileSync(target).length / 1024 / 1024).toFixed(1);
console.log(`dist-demo/artifact.html — ${mb} МБ`);
