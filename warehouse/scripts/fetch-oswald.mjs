#!/usr/bin/env node
/**
 * Скачивает Oswald и кладёт его в `assets/fonts/oswald.css` — готовыми
 * `@font-face` со шрифтом внутри строки.
 *
 *   node scripts/fetch-oswald.mjs
 *
 * Зачем: касса у них написана шрифтом Oswald (`typography.fontFamily` в их
 * теме — `'Oswald', sans-serif`). У нас он был назван в стилях, но самого
 * файла не было, и браузер молча брал Roboto. Совпадение размеров при этом
 * ничего не даёт: Oswald узкий, и текст в плитках, чеке и окнах вставал
 * иначе, чем у них.
 *
 * Запускается руками и редко: результат лежит в репозитории, чтобы сборка
 * не ходила в сеть.
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

const css = await (
  await fetch('https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600;700', {
    headers: { 'User-Agent': AGENT },
  })
).text();

// Оставляем только те наборы знаков, которые нужны: латиница и кириллица.
const blocks = css.split('/*').filter((block) => /^\s*(latin|cyrillic)/.test(block));
const out = [];

for (const block of blocks) {
  const url = block.match(/url\((https:[^)]+)\)/)?.[1];
  if (!url) continue;

  const font = Buffer.from(await (await fetch(url)).arrayBuffer());
  const rule = block
    .slice(block.indexOf('@font-face'))
    .replace(/url\(https:[^)]+\)/, `url(data:font/woff2;base64,${font.toString('base64')})`)
    .replace(/\s+/g, ' ')
    .trim();

  out.push(rule);
}

const file = join(root, 'assets/fonts/oswald.css');
await writeFile(file, out.join('\n'));
console.log(`assets/fonts/oswald.css — ${out.length} начертаний, ${(out.join('').length / 1024) | 0} КБ`);
