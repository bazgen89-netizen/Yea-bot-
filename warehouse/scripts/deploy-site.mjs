/**
 * Выкладка программы на поддомен Вазгена.
 *
 *   node scripts/deploy-site.mjs [файл]
 *
 * Вазген попросил, чтобы программа жила по адресу на его домене и обновлялась
 * сама. Здесь — вторая половина: сама заливка. Первая половина (поддомен,
 * пароль на папку, сертификат) делается один раз руками, порядок в
 * `deploy/КАК-ПОЛОЖИТЬ-НА-ПОДДОМЕН.md`.
 *
 * ## Доступы
 *
 * Берутся только из переменных окружения — в чат их присылать не нужно и
 * нельзя, ровно как ключ CloudShop:
 *
 *   SITE_FTP_URL       ftp://ftp.hoster.ru/sklad.waystea.ru/  (папка, со слешом)
 *   SITE_FTP_USER      логин FTP
 *   SITE_FTP_PASSWORD  пароль FTP
 *
 * Логин и пароль уходят в curl через его файл настроек на стандартном вводе,
 * а не аргументами команды: аргументы видны в списке процессов всякому, кто
 * на этой машине окажется.
 *
 * Если переменных нет — команда честно об этом говорит и завершается спокойно,
 * не роняя ночной перенос: выкладка не главное в нём.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Что кладём. По умолчанию — сборка со своими данными и крупными снимками. */
const файл = resolve(root, process.argv[2] ?? 'dist-demo/index.html');

const url = process.env.SITE_FTP_URL;
const user = process.env.SITE_FTP_USER;
const password = process.env.SITE_FTP_PASSWORD;

if (!url || !user || !password) {
  console.log('Выкладка на сайт пропущена: не заданы доступы.');
  console.log('');
  console.log('Нужны три переменные окружения:');
  console.log('  SITE_FTP_URL       ftp://ftp.вашхостер.ру/sklad.waystea.ru/');
  console.log('  SITE_FTP_USER      логин FTP');
  console.log('  SITE_FTP_PASSWORD  пароль FTP');
  console.log('');
  console.log('Задаются в настройках среды, а не в переписке.');
  process.exit(0);
}

if (!existsSync(файл)) {
  console.error(`Нечего выкладывать: ${файл} не собран.`);
  process.exit(1);
}

const мегабайт = statSync(файл).size / 1024 / 1024;

// Слеш в конце обязателен: без него curl принял бы последнее слово за имя
// файла и положил программу под именем папки.
const папка = url.endsWith('/') ? url : `${url}/`;
const адрес = `${папка}index.html`;

console.log(`Кладу ${файл} (${мегабайт.toFixed(1)} МБ) → ${адрес}`);

/**
 * Настройки для curl подаются на стандартный ввод.
 *
 * `--ssl` вместо `--ssl-reqd`: у многих хостеров FTP без шифрования, и
 * требовать его значило бы не положить файл вовсе. Само содержимое не
 * секрет — программа и так открывается по ссылке, — а вот пароль от FTP
 * секрет, и его curl при `--ssl` защитит, если хостер это умеет.
 */
const настройки = [
  `url = "${адрес}"`,
  `user = "${user}:${password}"`,
  `upload-file = "${файл}"`,
  'ssl',
  'ftp-create-dirs',
  'silent',
  'show-error',
  'fail',
  'connect-timeout = 30',
  // Сорок мегабайт по мобильному каналу хостера едут небыстро.
  'max-time = 900',
].join('\n');

try {
  execFileSync('curl', ['--config', '-'], { input: настройки, stdio: ['pipe', 'inherit', 'inherit'] });
  console.log('Готово. Программа обновлена на сайте.');
} catch (error) {
  console.error('Не удалось выложить:', error.message);
  console.error('Проверьте SITE_FTP_URL, логин и пароль в настройках среды.');
  process.exit(1);
}
