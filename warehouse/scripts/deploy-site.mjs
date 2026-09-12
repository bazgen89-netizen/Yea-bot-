/**
 * Выкладка программы на сайт Вазгена — сама, без его участия.
 *
 *   node scripts/deploy-site.mjs [файл]
 *
 * ## Почему не по FTP
 *
 * Сначала это было написано на curl по FTP, и это не работало ни разу: с
 * машины, где собирается программа, наружу открыт только 443-й порт.
 * Проверено прямо: 21 (FTP), 990 (FTPS) и 22 (SFTP) не отвечают, 443
 * отвечает. Значит, дорога одна — обычный https, а на том конце должен
 * кто-то принимать. Принимает `deploy/priem.php`, положенный в папку
 * программы один раз руками.
 *
 * ## Доступы
 *
 * Только из переменных окружения — как ключ CloudShop. В переписку их слать
 * не нужно и нельзя:
 *
 *   SITE_URL   https://waystea.ru/sklad/priem.php
 *   SITE_KEY   та же длинная строка, что вписана в priem.php
 *
 * Ключ уходит заголовком по https и в списке процессов не виден.
 *
 * ## Как едет
 *
 * Кусками по 4 МБ: хостеры не принимают 26 МБ одним запросом, а обрыв на
 * половине не должен убивать работающую программу. Поэтому файл сперва
 * копится черновиком, в конце сверяется длина и sha256, и только тогда
 * подменяется — одним мгновенным rename.
 *
 * Если переменных нет, команда честно об этом говорит и завершается спокойно:
 * ронять из-за этого весь ночной перенос незачем.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Что кладём. По умолчанию — сборка со своими данными. */
const файл = resolve(root, process.argv[2] ?? 'dist/index.html');

const адрес = process.env.SITE_URL;
const ключ = process.env.SITE_KEY;

if (!адрес || !ключ) {
  console.log('Выкладка на сайт пропущена: не заданы доступы.');
  console.log('');
  console.log('Нужны две переменные окружения:');
  console.log('  SITE_URL   https://waystea.ru/sklad/priem.php');
  console.log('  SITE_KEY   длинная случайная строка (она же — в priem.php)');
  console.log('');
  console.log('Задаются в настройках среды, а не в переписке.');
  console.log('Порядок — в deploy/КАК-ПОЛОЖИТЬ-НА-ПОДДОМЕН.md.');
  process.exit(0);
}

if (!existsSync(файл)) {
  console.error(`Нечего выкладывать: ${файл} не собран.`);
  process.exit(1);
}

const КУСОК = 4 * 1024 * 1024;

const тело = readFileSync(файл);
const размер = statSync(файл).size;
const сумма = createHash('sha256').update(тело).digest('hex');

/** Один запрос к приёмнику. Ключ — заголовком, ответ — json. */
async function позвать(что, { body, headers } = {}) {
  const ответ = await fetch(`${адрес}?chto=${что}`, {
    method: 'POST',
    headers: { 'X-Klyuch': ключ, 'Content-Type': 'application/octet-stream', ...headers },
    body,
  });

  if (ответ.status === 404) {
    throw new Error(
      'приёмник не отозвался (404). Либо priem.php не лежит в папке, ' +
        'либо SITE_KEY не совпадает с ключом внутри него.',
    );
  }
  if (!ответ.ok) throw new Error(`хостинг ответил ${ответ.status}`);

  const текст = await ответ.text();
  let ответ_json;
  try {
    ответ_json = JSON.parse(текст);
  } catch {
    throw new Error(`непонятный ответ хостинга: ${текст.slice(0, 200)}`);
  }
  if (!ответ_json.ok) throw new Error(ответ_json.беда ?? 'отказ без объяснения');
  return ответ_json;
}

const мб = (сколько) => (сколько / 1024 / 1024).toFixed(1);

try {
  const проверка = await позвать('proverka');
  if (!проверка.пишется) {
    throw new Error('папка на хостинге закрыта на запись — приёмнику некуда класть');
  }
  console.log(
    `Приёмник на связи. Сейчас на сайте: ${
      проверка.программа ? `${мб(проверка.программа)} МБ` : 'пусто'
    }.`,
  );

  console.log(`Кладу ${файл} (${мб(размер)} МБ) → ${адрес}`);
  await позвать('nachat');

  for (let с = 0; с < размер; с += КУСОК) {
    const до = Math.min(с + КУСОК, размер);
    await позвать('kusok', { body: тело.subarray(с, до) });
    process.stdout.write(`\r  ${мб(до)} из ${мб(размер)} МБ`);
  }
  process.stdout.write('\n');

  const готово = await позвать('zakonchit', {
    headers: { 'X-Razmer': String(размер), 'X-Summa': сумма },
  });

  console.log(`Готово: программа на сайте обновлена, ${мб(готово.размер)} МБ.`);
} catch (ошибка) {
  console.error('Не удалось выложить:', ошибка.message);
  console.error('Старая программа на сайте осталась нетронутой.');
  process.exit(1);
}
