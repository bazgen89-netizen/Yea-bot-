/**
 * Выгрузка ночует на сайте, а не пересоздаётся каждую ночь.
 *
 *   node scripts/site-data.mjs взять    — забрать с сайта в src/db/seed/local
 *   node scripts/site-data.mjs положить — отправить туда же обратно
 *   node scripts/site-data.mjs взять --с-фото
 *
 * ## Зачем
 *
 * Машина, где всё собирается, каждую ночь создаётся пустой, а выгрузка из
 * CloudShop в git не лежит — там 3 272 настоящих телефона. Поэтому ночь
 * начиналась с полного переноса всех 46 429 чеков: полчаса работы, и если
 * он спотыкался, дальше не выходило уже ничего — ни сборки, ни выкладки.
 * Выкладка стояла шестым шагом после самого хрупкого.
 *
 * Теперь выгрузка ночует на его же сайте, рядом с программой и под тем же
 * паролем. Ночь забирает её за секунды и дописывает только новые чеки.
 *
 * ## Два свёртка, а не один
 *
 *   dannye.tgz — чеки, клиенты, товары, документы. 2,1 МБ, каждую ночь.
 *   foto.tgz   — фотографии товаров. 26,2 МБ, меняются раз в сто лет.
 *
 * Возить 26 МБ фотографий каждую ночь незачем: они те же самые. Поэтому по
 * умолчанию ездят только данные, а фотографии — когда попросят.
 *
 * ## Доступы
 *
 * SITE_URL и SITE_KEY — те же, что у выкладки. Только из переменных
 * окружения, в переписке им не место.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const местные = resolve(root, 'src/db/seed/local');

const адрес = process.env.SITE_URL;
const ключ = process.env.SITE_KEY;

const [, , действие, ...ключи] = process.argv;
const сФото = ключи.includes('--с-фото');

if (!['взять', 'положить'].includes(действие ?? '')) {
  console.error('Как звать: node scripts/site-data.mjs взять|положить [--с-фото]');
  process.exit(1);
}

if (!адрес || !ключ) {
  console.log('Пропущено: не заданы SITE_URL и SITE_KEY.');
  process.exit(0);
}

const КУСОК = 4 * 1024 * 1024;
const мб = (сколько) => (сколько / 1024 / 1024).toFixed(1);

/** Что лежит в каком свёртке. */
const СВЁРТКИ = {
  'dannye.tgz': ['clients.json', 'docs.json', 'products.json', 'sales.json', 'stores.json'],
  'foto.tgz': ['photos.json', 'photos-112.json', 'photos-208.json', 'photos-mixed.json'],
};

const нужные = сФото ? Object.keys(СВЁРТКИ) : ['dannye.tgz'];

async function позвать(что, файл, { body, headers, сырьё } = {}) {
  const ответ = await fetch(`${адрес}?chto=${что}&fajl=${encodeURIComponent(файл)}`, {
    method: 'POST',
    headers: { 'X-Klyuch': ключ, 'Content-Type': 'application/octet-stream', ...headers },
    body,
  });

  if (ответ.status === 404) {
    throw new Error('приёмник не отозвался: нет priem.php или ключ не тот');
  }
  if (!ответ.ok) throw new Error(`хостинг ответил ${ответ.status}`);

  if (сырьё) {
    return {
      данные: Buffer.from(await ответ.arrayBuffer()),
      сумма: (ответ.headers.get('X-Summa') ?? '').toLowerCase(),
    };
  }

  const текст = await ответ.text();
  let разбор;
  try {
    разбор = JSON.parse(текст);
  } catch {
    throw new Error(`непонятный ответ: ${текст.slice(0, 200)}`);
  }
  if (!разбор.ok) throw new Error(разбор.беда ?? 'отказ без объяснения');
  return разбор;
}

/** Отправить один свёрток кусками. */
async function отправить(файл, тело) {
  const сумма = createHash('sha256').update(тело).digest('hex');

  await позвать('nachat', файл);
  for (let с = 0; с < тело.length; с += КУСОК) {
    await позвать('kusok', файл, { body: тело.subarray(с, Math.min(с + КУСОК, тело.length)) });
  }
  await позвать('zakonchit', файл, {
    headers: { 'X-Razmer': String(тело.length), 'X-Summa': сумма },
  });
}

try {
  if (действие === 'положить') {
    mkdirSync(местные, { recursive: true });

    for (const свёрток of нужные) {
      // Кладём только то, что есть: фотографий может не быть вовсе, и это
      // не повод падать.
      const файлы = СВЁРТКИ[свёрток].filter((один) => existsSync(resolve(местные, один)));
      if (!файлы.length) {
        console.log(`${свёрток}: нечего класть, пропускаю`);
        continue;
      }

      const свёрнуто = execFileSync('tar', ['czf', '-', '-C', местные, ...файлы], {
        maxBuffer: 512 * 1024 * 1024,
      });
      await отправить(свёрток, свёрнуто);
      console.log(`${свёрток}: положено ${мб(свёрнуто.length)} МБ (${файлы.length} файлов)`);
    }
  } else {
    mkdirSync(местные, { recursive: true });

    for (const свёрток of нужные) {
      let взято;
      try {
        взято = await позвать('vzyat', свёрток, { сырьё: true });
      } catch (беда) {
        // Первая ночь: на сайте ещё ничего не лежит. Это не поломка —
        // перенос тогда просто сделает всё с нуля, как раньше.
        console.log(`${свёрток}: на сайте пока нет (${беда.message})`);
        continue;
      }

      const своя = createHash('sha256').update(взято.данные).digest('hex');
      if (взято.сумма && взято.сумма !== своя) {
        throw new Error(`${свёрток} побился в дороге`);
      }

      const временный = resolve(местные, `.${свёрток}`);
      writeFileSync(временный, взято.данные);
      execFileSync('tar', ['xzf', временный, '-C', местные]);
      console.log(`${свёрток}: взято ${мб(взято.данные.length)} МБ`);
    }

    const чеки = resolve(местные, 'sales.json');
    if (existsSync(чеки)) {
      console.log(`Чеков на месте: ${JSON.parse(readFileSync(чеки, 'utf8')).length}`);
    }
  }
} catch (беда) {
  console.error('Не вышло:', беда.message);
  process.exit(1);
}
