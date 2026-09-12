/**
 * Смешать два набора снимков: действующим товарам крупные, архивным мелкие.
 *
 *   node scripts/mix-photos.mjs [--big=photos-208.json] [--small=photos-112.json]
 *                               [--out=photos-mixed.json]
 *
 * Зачем. Страница по ссылке не может быть тяжелее 16 МБ. С крупными
 * снимками у всех полутора тысяч товаров выходит двадцать шесть — не
 * помещается. Но половина снимков принадлежит товарам, снятым с продажи:
 * их видно только значком сорок на сорок в списке, и держать для них
 * двести восемь точек незачем.
 *
 * Поэтому размен: действующим — 208 точек, архивным — 112. Место уходит
 * туда, куда хозяин смотрит.
 *
 * Раньше я мешал эти наборы руками, и в `docs/сборка.md` стояло «смешать»
 * без команды. Ручной шаг в описанной процедуре — это шаг, который однажды
 * пропустят.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = `${root}/src/db/seed/local`;

const text = (name, fallback) => {
  const found = process.argv.find((one) => one.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const bigFile = `${out}/${text('big', 'photos-208.json')}`;
const smallFile = `${out}/${text('small', 'photos-112.json')}`;
const outFile = `${out}/${text('out', 'photos-mixed.json')}`;

for (const file of [bigFile, smallFile, `${out}/products.json`]) {
  if (!existsSync(file)) {
    console.error(`Нет файла: ${file.replace(root + '/', '')}`);
    console.error('Сперва: node scripts/refresh-photos.mjs --size=208 --out=photos-208.json --from-disk');
    process.exit(1);
  }
}

const products = JSON.parse(readFileSync(`${out}/products.json`, 'utf8'));
const big = JSON.parse(readFileSync(bigFile, 'utf8'));
const small = JSON.parse(readFileSync(smallFile, 'utf8'));

// Архивные — те, у кого в выгрузке стоит признак `del`.
const archived = new Set(
  products.filter((product) => product.del && product.c).map((product) => product.c),
);

const mixed = {};
let bigCount = 0;
let smallCount = 0;

for (const code of new Set([...Object.keys(big), ...Object.keys(small)])) {
  // Архивному — мелкий, если он есть; иначе всё же крупный: снимок совсем
  // без картинки хуже тяжёлого.
  const photo = archived.has(code) ? (small[code] ?? big[code]) : (big[code] ?? small[code]);
  if (!photo) continue;

  mixed[code] = photo;
  if (photo === big[code]) bigCount += 1;
  else smallCount += 1;
}

writeFileSync(outFile, JSON.stringify(mixed, null, 1));

const weight = Object.values(mixed).reduce((sum, one) => sum + one.length, 0);
console.log(
  `Готово: ${outFile.replace(root + '/', '')} — ${Object.keys(mixed).length} снимков ` +
    `(${bigCount} крупных, ${smallCount} мелких), ${(weight / 1048576).toFixed(1)} МБ.`,
);
