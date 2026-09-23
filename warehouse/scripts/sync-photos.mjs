/**
 * Перенос фотографий товаров из CloudShop в пример каталога.
 *
 *   CLOUDSHOP_TOKEN=… node scripts/sync-photos.mjs
 *
 * Токен читается только из окружения и никуда не записывается: в репозиторий
 * он попасть не должен, а в истории команд ему тоже не место — задавайте его
 * той же строкой, что и запуск.
 *
 * Что делает: берёт каталог через Connect API, у каждого товара забирает
 * картинку, ужимает её до квадрата 96×96 и кладёт в `src/db/seed/photos.json`
 * ключом по коду товара. Сборка вшивает их в тот же единственный файл, что и
 * всё остальное — приложение работает без сети, и ссылка на чужой сервер
 * означала бы пустые рамки в дороге.
 *
 * Почему 96 и почему JPEG: в списке картинка занимает 40 пикселей, в карточке
 * 150. Больше 96 не нужно даже с двойной плотностью, а 590 фотографий по
 * 2–3 КБ дают полтора мегабайта — столько файл вытерпит. PNG на фотографиях
 * весит в разы больше при том же виде.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.CLOUDSHOP_TOKEN;

if (!token) {
  console.error(
    'Нет токена. Запуск: CLOUDSHOP_TOKEN=… node scripts/sync-photos.mjs\n' +
      'Токен берётся в кабинете: Интеграции → Connect API.',
  );
  process.exit(1);
}

const API = 'https://connect-api.cloudshop.ru/api/v4';
const SIZE = 96;

async function api(path) {
  const response = await fetch(API + path, {
    headers: { 'X-CloudShop-API-Access-Token': token },
  });
  if (!response.ok) {
    throw new Error(`${path} → ${response.status} ${await response.text()}`);
  }
  return response.json();
}

console.log('Читаю каталог…');

const products = [];
for (let offset = 0; ; offset += 250) {
  const page = await api(`/catalog?limit=250&offset=${offset}`);
  const list = page.data ?? page.catalog ?? page;
  if (!Array.isArray(list) || list.length === 0) break;
  products.push(...list);
  if (list.length < 250) break;
}

// Картинка лежит в `pic`; товары без неё пропускаем молча — их большинство.
const withPhoto = products.filter((item) => item.pic);
console.log(`Товаров ${products.length}, с фотографией ${withPhoto.length}.`);

if (withPhoto.length === 0) {
  console.log('Переносить нечего.');
  process.exit(0);
}

/**
 * Ужимаем в браузере: своей библиотеки для этого в проекте нет, а Chromium
 * уже стоит — им же снимаются экраны. Canvas отдаёт готовый JPEG.
 */
const browser = await chromium.launch();
const page = await browser.newPage();

const photos = {};
let done = 0;
let failed = 0;

for (const item of withPhoto) {
  // У их картинок размер задаётся параметром: просить сразу маленькую дешевле,
  // чем тянуть оригинал и ужимать его у себя.
  const url = `${item.pic}?s=${SIZE * 2},${SIZE * 2}`;

  const data = await page.evaluate(
    async ([src, size]) =>
      new Promise((resolve) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const context = canvas.getContext('2d');
          // Вписываем по короткой стороне и обрезаем: товар на фотографии
          // обычно по центру, а поля исказили бы плитку в кассе.
          const side = Math.min(image.width, image.height);
          context.drawImage(
            image,
            (image.width - side) / 2,
            (image.height - side) / 2,
            side,
            side,
            0,
            0,
            size,
            size,
          );
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        };
        image.onerror = () => resolve(null);
        image.src = src;
      }),
    [url, SIZE],
  );

  if (data) {
    // Ключ — код товара: по нему пример и связывается с каталогом. Артикул
    // и штрихкод есть не у всех, а код есть всегда.
    photos[String(item.code ?? item.id ?? item._id)] = data;
    done++;
  } else {
    failed++;
  }

  if ((done + failed) % 50 === 0) console.log(`  ${done + failed} / ${withPhoto.length}`);
}

await browser.close();

const target = `${root}/src/db/seed/photos.json`;
writeFileSync(target, JSON.stringify(photos));

const mb = (readFileSync(target).length / 1024 / 1024).toFixed(2);
console.log(`Готово: ${done} фотографий, не открылось ${failed}. ${mb} МБ в photos.json.`);
