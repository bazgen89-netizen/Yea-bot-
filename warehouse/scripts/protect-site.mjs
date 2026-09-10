/**
 * Поставить пароль на папку со складом — с этой стороны, без Вазгена.
 *
 *   node scripts/protect-site.mjs
 *
 * Внутри программы 3 272 настоящих телефона клиентов, дни рождения и вся
 * история покупок. Без пароля адрес открыт любому, кто его знает, а адрес
 * расходится сам собой — через историю браузера, мессенджер, письмо.
 *
 * Раньше это значило «положи на хостинг ещё два файла руками». Он
 * справедливо сказал, что тогда никакого «без моего участия» не выходит.
 * Теперь их кладёт приёмник, а сюда они приезжают отсюда.
 *
 * Ставится ОДИН РАЗ. Приёмник отказывается трогать уже стоящую защиту —
 * иначе ключом можно было бы её и снять. Снимается только руками, из
 * файлового менеджера хостинга.
 *
 * Доступы — из тех же переменных, что у выкладки: SITE_URL и SITE_KEY.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const адрес = process.env.SITE_URL;
const ключ = process.env.SITE_KEY;

if (!адрес || !ключ) {
  console.log('Защита не поставлена: не заданы SITE_URL и SITE_KEY.');
  process.exit(0);
}

const htaccess = resolve(root, 'deploy/.htaccess');
const htpasswd = resolve(root, 'deploy/.htpasswd');

for (const файл of [htaccess, htpasswd]) {
  if (!existsSync(файл)) {
    console.error(`Нет ${файл}. Без него защиту ставить нечем.`);
    process.exit(1);
  }
}

/*
 * Путь к файлу паролей внутри .htaccess подставляется живым.
 *
 * В нём записан путь, угаданный по имени хостинга, и если он неверен,
 * Apache отдаёт 500 — то есть программа перестаёт открываться и Вазгену
 * тоже. Приёмник же знает свой настоящий путь: он лежит в той самой папке.
 * Поэтому спрашиваем его и подставляем, а не гадаем.
 */
async function позвать(что, тело) {
  const ответ = await fetch(`${адрес}?chto=${что}`, {
    method: 'POST',
    headers: { 'X-Klyuch': ключ, 'Content-Type': 'application/json' },
    body: тело === undefined ? undefined : JSON.stringify(тело),
  });

  if (ответ.status === 404) {
    throw new Error('приёмник не отозвался: либо priem.php не лежит в папке, либо ключ не тот');
  }
  if (!ответ.ok) throw new Error(`хостинг ответил ${ответ.status}`);

  const текст = await ответ.text();
  let разбор;
  try {
    разбор = JSON.parse(текст);
  } catch {
    throw new Error(`непонятный ответ: ${текст.slice(0, 200)}`);
  }
  return разбор;
}

try {
  const состояние = await позвать('proverka');
  if (!состояние.ok) throw new Error(состояние.беда ?? 'приёмник отказал');

  if (состояние.защита) {
    console.log('Пароль на папке уже стоит. Ничего не трогаю.');
    process.exit(0);
  }

  const папка = состояние.папка ?? null;
  let правила = readFileSync(htaccess, 'utf8');

  if (папка) {
    правила = правила.replace(
      /^AuthUserFile .*$/m,
      `AuthUserFile ${папка}/.htpasswd`,
    );
    console.log(`Путь к файлу паролей взят у самого хостинга: ${папка}/.htpasswd`);
  }

  const готово = await позвать('zashchita', {
    htaccess: правила,
    htpasswd: readFileSync(htpasswd, 'utf8'),
  });

  if (!готово.ok) throw new Error(готово.беда ?? 'отказ без объяснения');
  console.log('Пароль на папку поставлен.');
} catch (ошибка) {
  console.error('Не удалось поставить защиту:', ошибка.message);
  process.exit(1);
}
