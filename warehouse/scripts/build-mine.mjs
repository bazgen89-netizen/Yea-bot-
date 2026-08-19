/**
 * Сборка со своими данными — той выгрузкой, что лежит рядом и не в git.
 *
 *   node scripts/build-mine.mjs
 *
 * Зачем отдельная команда. Перенос из CloudShop кладёт настоящую выгрузку в
 * `src/db/seed/local/` — папку, которую git не видит. Так и должно быть:
 * там три тысячи телефонов, дни рождения и бонусные счета живых людей, а
 * данные, единожды попавшие в историю репозитория, из неё уже не убрать —
 * только переписав историю целиком.
 *
 * Собирает же программа то, что лежит в `src/db/seed/`. Поэтому здесь файлы
 * подменяются на время сборки и возвращаются на место сразу после — тем же
 * приёмом, что и в `build-demo.mjs`. Возврат идёт в `finally`: если сборка
 * упадёт на середине, личные данные всё равно не останутся лежать там,
 * откуда их случайно закоммитят.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seed = `${root}/src/db/seed`;
const mine = `${seed}/local`;

/** Что подменяем. Остальное в папке — общее и подмены не требует. */
const FILES = ['products.json', 'clients.json', 'sales.json', 'photos.json'];

const present = FILES.filter((file) => existsSync(`${mine}/${file}`));

if (present.length === 0) {
  console.error(`Своей выгрузки нет: ${mine.replace(root + '/', '')} пуст.`);
  console.error('Сначала перенос: CLOUDSHOP_TOKEN=… node scripts/import-cloudshop.mjs');
  process.exit(1);
}

// Что было в сборочной папке — откладываем целиком, а не «запоминаем имена»:
// вернуть надо и содержимое, и его отсутствие.
const stashed = [];

try {
  for (const file of present) {
    const target = `${seed}/${file}`;

    if (existsSync(target)) {
      renameSync(target, `${target}.was`);
      stashed.push({ target, kept: true });
    } else {
      stashed.push({ target, kept: false });
    }

    copyFileSync(`${mine}/${file}`, target);
  }

  console.log(`Своя выгрузка на месте: ${present.join(', ')}`);
  execSync('npm run web:build', { cwd: root, stdio: 'inherit', env: { ...process.env, SEED: '1' } });
} finally {
  for (const { target, kept } of stashed) {
    rmSync(target, { force: true });
    if (kept) renameSync(`${target}.was`, target);
  }
  console.log('Сборочная папка возвращена к тому, что лежит в git.');
}

console.log(`
Готово: dist/index.html — со своими товарами, клиентами и историей.
Этот файл никуда не выкладывают: в нём настоящие телефоны. Для ссылки —
node scripts/build-demo.mjs, там они подменены.`);
