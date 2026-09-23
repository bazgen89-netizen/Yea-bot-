/**
 * Переснять фотографии товаров крупнее.
 *
 *   node scripts/refresh-photos.mjs [--size=288] [--quality=0.8]
 *   node scripts/refresh-photos.mjs --size=160 --out=photos-link.json --from-disk
 *
 * Вазген сказал прямо: «у товаров очень плохого качества фото». Так и было:
 * при переносе они ужимались до 96 точек — этого хватает на значок 40×40 в
 * справочнике и совсем не хватает на карточку, где снимок показывается
 * квадратом 150×150, а на хорошем экране растягивается вдвое.
 *
 * Ключ здесь не нужен: их хранилище `pic.cloudshop.ru` отдаёт файлы всем,
 * а адреса уже лежат в выгрузке (`products.json`, поле `img`). Поэтому
 * переснять можно когда угодно, не трогая остальной перенос.
 *
 * Оригиналы — около 790 точек и по полмегабайта. Класть их в программу
 * целиком нельзя: тысяча снимков дала бы полгигабайта в одном файле.
 * Поэтому берётся середина: 288 точек — это вдвое больше, чем показывает
 * карточка, и снимок остаётся резким даже на плотном экране.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = `${root}/src/db/seed/local`;

const arg = (name, fallback) => {
  const found = process.argv.find((one) => one.startsWith(`--${name}=`));
  return found ? Number(found.slice(name.length + 3)) : fallback;
};

const size = arg('size', 288);
const quality = arg('quality', 0.8);

const text = (name, fallback) => {
  const found = process.argv.find((one) => one.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

/** Куда положить: по умолчанию туда же, откуда берёт сборка. */
const file = `${out}/${text('out', 'photos.json')}`;

/**
 * Уменьшить уже скачанное, а не выкачивать заново.
 *
 * Нужно для страницы по ссылке: она не может быть тяжелее 16 МБ, и туда
 * идёт тот же набор снимков, но мельче. Гонять ради этого тысячу картинок
 * через сеть второй раз незачем — они уже лежат в `photos.json`.
 */
const fromDisk = process.argv.includes('--from-disk');

const products = JSON.parse(readFileSync(`${out}/products.json`, 'utf8'));
const saved = fromDisk ? JSON.parse(readFileSync(`${out}/photos.json`, 'utf8')) : {};

const withPhoto = fromDisk
  ? Object.keys(saved).map((code) => ({ c: code, img: saved[code] }))
  : products.filter((product) => product.img && product.c);

console.log(
  `Фотографии: ${withPhoto.length} шт., ${size} точек, качество ${quality}` +
    (fromDisk ? ' — из уже скачанных' : ''),
);

const { chromium } = await import('playwright');
const browser = await chromium.launch();
const page = await browser.newPage();

const photos = {};
let done = 0;
let failed = 0;

for (const product of withPhoto) {
  try {
    // Уже скачанное лежит строкой — качать нечего.
    const source = fromDisk ? product.img : await download(product.img);
    if (!source) {
      failed += 1;
      continue;
    }

    const data = await page.evaluate(shrink, { url: source, size, quality });
    if (data) {
      photos[product.c] = data;
      done += 1;
    } else {
      failed += 1;
    }
  } catch {
    failed += 1;
  }

  if ((done + failed) % 25 === 0) process.stdout.write(`\r  снято: ${done}`);
}

process.stdout.write(`\r  снято: ${done}\n`);
if (failed) console.log(`  не скачалось: ${failed}`);

await browser.close();
writeFileSync(file, JSON.stringify(photos, null, 1));

const weight = Object.values(photos).reduce((sum, one) => sum + one.length, 0);
console.log(
  `Готово: ${file} — ${(weight / 1048576).toFixed(1)} МБ, ` +
    `в среднем ${Math.round(weight / (done || 1) / 1024)} КБ на снимок.`,
);

/**
 * Скачать картинку и превратить её в строку, которую поймёт браузер.
 *
 * Возвращает `null`, если картинки нет: карточка на неё ссылается, а файл
 * с тех пор удалили — обычное дело в каталоге, который правят годами.
 */
async function download(url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;

      const bytes = Buffer.from(await response.arrayBuffer());
      const type = response.headers.get('content-type') ?? 'image/jpeg';
      return `data:${type};base64,${bytes.toString('base64')}`;
    } catch {
      if (attempt === 3) return null;
      await new Promise((wait) => setTimeout(wait, attempt * 500));
    }
  }
  return null;
}

/**
 * Ужать картинку до квадрата.
 *
 * Выполняется внутри браузера: там есть холст, на котором картинку можно
 * уменьшить, — в Node для этого пришлось бы тащить стороннюю библиотеку.
 */
function shrink({ url, size: side, quality: q }) {
  return new Promise((finish) => {
    const image = new Image();
    image.onerror = () => finish(null);
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = side;
      canvas.height = side;

      const context = canvas.getContext('2d');
      if (!context) return finish(null);

      // Пересчёт «получше»: без него уменьшение вчетверо даёт зубцы на
      // краях букв на упаковке.
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';

      // Вписываем по короткой стороне и обрезаем — так товар остаётся в
      // середине, а не сжимается в блин.
      const square = Math.min(image.width, image.height);
      context.drawImage(
        image,
        (image.width - square) / 2,
        (image.height - square) / 2,
        square,
        square,
        0,
        0,
        side,
        side,
      );

      finish(canvas.toDataURL('image/jpeg', q));
    };
    image.src = url;
  });
}
