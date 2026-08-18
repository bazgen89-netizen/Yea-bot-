#!/usr/bin/env node
/**
 * Собирает веб-версию в один самодостаточный файл `dist/index.html`.
 *
 *   node scripts/build-web.mjs
 *
 * Зачем один файл: так страницу можно положить на любой статический хостинг
 * и открыть по ссылке — ни одного стороннего запроса она не делает. Внутрь
 * попадают код приложения, sql.js, сам SQLite в WebAssembly и шрифты иконок.
 *
 * Запускать после `expo export --platform web` — этим занимается `npm run web:build`.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

/**
 * Своя история переходов для файла, открытого с диска (`file://`).
 *
 * У такой страницы браузер запрещает менять адрес: `history.pushState` бросает
 * исключение, и переключение вкладок обрывается на середине. Просто проглотить
 * исключение нельзя — тогда история браузера не растёт, и первый же «назад»
 * уводит с единственной страницы в пустоту (именно так и получался белый экран).
 *
 * Поэтому на `file://` подменяем `window.history` целиком: переходы живут
 * в массиве внутри страницы, `back()` возвращает на предыдущий экран, а адрес
 * в строке браузера не трогается вовсе.
 *
 * Только для `file://`: на хостинге нужна настоящая история, иначе сломаются
 * кнопка «назад» и перезагрузка страницы.
 */
const FILE_PROTOCOL_FIX = `
if (location.protocol === 'file:') {
  var entries = [{ state: null, url: location.href }];
  var index = 0;
  var memory = {
    get length() { return entries.length; },
    get state() { return entries[index].state; },
    scrollRestoration: 'auto',
    pushState: function (state, title, url) {
      // Переход вперёд отсекает всё, что было «впереди», как в браузере.
      entries.splice(index + 1);
      entries.push({ state: state, url: url == null ? entries[index].url : String(url) });
      index = entries.length - 1;
    },
    replaceState: function (state, title, url) {
      entries[index] = { state: state, url: url == null ? entries[index].url : String(url) };
    },
    go: function (delta) {
      var next = index + (delta || 0);
      if (next < 0 || next >= entries.length) return;
      index = next;
      // Браузер шлёт popstate отдельным заданием — повторяем, иначе роутер
      // получит событие посреди собственного обновления состояния.
      setTimeout(function () {
        dispatchEvent(new PopStateEvent('popstate', { state: entries[index].state }));
      }, 0);
    },
    back: function () { this.go(-1); },
    forward: function () { this.go(1); },
  };
  Object.defineProperty(window, 'history', { value: memory, configurable: true });
}`;

const html = await readFile(join(dist, 'index.html'), 'utf8');

// Экспорт Expo кладёт бандл с хешем в имени — находим его по ссылке в странице.
const scriptTag = html.match(/<script src="([^"]+entry-[^"]+\.js)" defer><\/script>/);
if (!scriptTag) {
  throw new Error(
    'Не нашёл в index.html ссылку на бандл приложения.\n' +
      'Скорее всего страница уже собрана в один файл — начните заново:\n' +
      '  npx expo export --platform web --clear && node scripts/build-web.mjs',
  );
}

const bundle = await readFile(join(dist, scriptTag[1].replace(/^\//, '')), 'utf8');
const sqlJs = await readFile(join(root, 'node_modules/sql.js/dist/sql-wasm.js'), 'utf8');
const wasm = await readFile(join(root, 'node_modules/sql.js/dist/sql-wasm.wasm'));
const icon = await readFile(join(dist, 'favicon.ico')).catch(() => null);

let page = replaceOnce(
  html,
  scriptTag[0],
  [
    // Порядок важен: заплатка и sql.js должны отработать до запуска приложения.
    `<script>${FILE_PROTOCOL_FIX}</script>`,
    `<script>globalThis.__SQL_WASM_BASE64__=${JSON.stringify(wasm.toString('base64'))};</script>`,
    `<script>${sqlJs}</script>`,
    `<script>${bundle}</script>`,
  ].join('\n'),
);

if (icon) {
  page = replaceOnce(
    page,
    /<link rel="icon"[^>]*>/,
    `<link rel="icon" href="data:image/x-icon;base64,${icon.toString('base64')}"/>`,
  );
}

/**
 * Roboto — тот же файл, каким пользуется оригинал.
 *
 * Без него страница рисовалась системным шрифтом: в стилях Roboto был назван
 * первым, но самого файла не существовало, и браузер молча брал `-apple-system`.
 * Совпадение размеров при этом ничего не даёт — у другой гарнитуры другие
 * ширины букв, и колонки с высотами строк всё равно расходятся с оригиналом.
 *
 * Начертания три: 400 обычный, 500 для заголовков блоков, 700 для шапки таблиц.
 */
const ROBOTO = [
  ['Roboto-Regular.ttf', 400],
  ['Roboto-Medium.ttf', 500],
  ['Roboto-Bold.ttf', 700],
];

const faces = [];
for (const [file, weight] of ROBOTO) {
  const data = await readFile(join(root, 'assets/fonts', file)).catch(() => null);
  if (!data) throw new Error(`Нет файла шрифта assets/fonts/${file}`);

  faces.push(
    `@font-face{font-family:Roboto;font-style:normal;font-weight:${weight};` +
      `font-display:swap;src:url(data:font/ttf;base64,${data.toString('base64')}) format("truetype")}`,
  );
}

page = replaceOnce(page, '</head>', `<style id="roboto">${faces.join('')}</style></head>`);

/**
 * Oswald больше не вшивается.
 *
 * Их тема называет его шрифтом кассы, но самого файла касса не отдаёт: браузер
 * берёт следующее имя в списке, `sans-serif`, и на снимках их кассы буквы
 * обычные, а не узкие. Мы вшивали шрифт, которого у них нет, и текст выходил
 * уже их собственного — плюс 575 КБ в каждой сборке.
 */

/**
 * Видимая полоса прокрутки.
 *
 * Браузер на макбуке рисует её поверх содержимого и прячет, пока не крутят:
 * витрина кассы уезжала вниз, и понять, далеко ли до конца, было нельзя. У них
 * полоса видна всегда — серый скруглённый ползунок у правого края.
 *
 * Задаётся стилем страницы, а не свойством `ScrollView`: полосу рисует
 * браузер, и договориться с ним можно только так. Свойство `scrollbar-width`
 * при этом не задаётся намеренно: стоит его назвать, и Chromium перестаёт
 * слушать `::-webkit-scrollbar` — полоса снова становится наложенной
 * и исчезающей.
 */
const SCROLLBARS = `
html body *::-webkit-scrollbar{width:10px!important;height:10px!important;display:block!important;-webkit-appearance:none!important}
html body *::-webkit-scrollbar-track{background:transparent!important}
html body *::-webkit-scrollbar-thumb{background:#C1C7CD!important;border-radius:5px!important;border:2px solid transparent!important;background-clip:content-box!important}
html body *::-webkit-scrollbar-thumb:hover{background:#9AA3AB!important;background-clip:content-box!important}
`;

page = replaceOnce(page, '</head>', `<style id="scrollbars">${SCROLLBARS}</style></head>`);

/**
 * Синяя обводка фокуса.
 *
 * Браузер обводит поле, в которое печатают, и кнопку, которую нажали. В кассе
 * это лишнее: там своя разметка, и синяя рамка поверх оранжевого окна поиска
 * покупателя читалась как ошибка. Убирается стилем, а не свойством у каждого
 * поля, — обводку рисует браузер, и в React Native Web заглушить её со
 * стороны стилей элемента получается не везде.
 */
const NO_FOCUS_RING = `
html body input:focus,html body input:focus-visible,
html body textarea:focus,html body textarea:focus-visible,
html body select:focus,html body select:focus-visible,
html body button:focus,html body button:focus-visible,
html body [role="button"]:focus,html body [role="button"]:focus-visible,
html body [tabindex]:focus,html body [tabindex]:focus-visible{outline:none!important}
`;

page = replaceOnce(page, '</head>', `<style id="focus">${NO_FOCUS_RING}</style></head>`);

/**
 * Светлые цвета кассы — значениями по умолчанию.
 *
 * Стили кассы ссылаются на переменные (`var(--pos-tile)`), а расставляет их
 * `applyPosTheme` при входе в кассу. До этого мига страница успевает
 * отрисоваться, и без этих строк она мигнула бы бесцветной.
 */
const POS_VARS = `:root{
  --pos-bar:#1976D2; --pos-bar-dark:#115293; --pos-accent:#ED6C02;
  --pos-green:#2E7D32; --pos-red:#D32F2F;
  --pos-bg:#F7F9FC; --pos-tile:#FFFFFF; --pos-border:#D8DEE4;
  --pos-text:#1F2328; --pos-muted:#656D76; --pos-hover:rgba(0,0,0,0.04);
}`;

page = replaceOnce(page, '</head>', `<style id="pos-vars">${POS_VARS}</style></head>`);

/**
 * Наполнять ли базу при первом запуске.
 *
 * Обычная сборка приходит пустой: каталог в ней заводит тот, кто её поставил,
 * а не тот, кто собирал. Но у **этого** магазина каталог в сборке и есть его
 * собственный — те самые 590 позиций и 3184 карточки клиентов, что выгружены
 * из CloudShop. Без флага он открывал пустую программу: витрина без плиток,
 * поиск без клиентов, журнал без чеков — и по такому файлу нельзя проверить
 * ни одной правки. Это стоило нескольких кругов «почему не сделано».
 *
 *   SEED=1  — файл для своего магазина: своя выгрузка на месте;
 *   DEMO=1  — то же, но для показа по ссылке (телефоны подменены).
 */
if (process.env.DEMO === '1' || process.env.SEED === '1') {
  page = replaceOnce(page, '</head>', '<script>window.__DEMO__=true</script></head>');
}

// Шрифты иконок бандл грузит по ссылке — подменяем ссылки на сами шрифты.
let inlined = 0;
for (const file of await walk(join(dist, 'assets'))) {
  const url = '/' + relative(dist, file).split('\\').join('/');
  if (!page.includes(url)) continue;

  const data = await readFile(file);
  page = page.split(url).join(`data:${mime(file)};base64,${data.toString('base64')}`);
  inlined++;
}

await writeFile(join(dist, 'index.html'), page);

const size = (Buffer.byteLength(page) / 1024 / 1024).toFixed(1);
console.log(`dist/index.html — один файл, ${size} МБ (вшито шрифтов и картинок: ${inlined})`);

if (/(?:src|href)="\/(?!\/)/.test(page)) {
  throw new Error('В странице остались ссылки на внешние файлы — она не самодостаточна');
}

/**
 * Замена без подстановок. Обычный `String.replace` толкует `$&` и `$'`
 * в тексте замены как ссылки на найденный кусок, а в бандле такие сочетания
 * встречаются и молча ломают код. Функция-заменитель это отключает.
 */
function replaceOnce(text, pattern, replacement) {
  return text.replace(pattern, () => replacement);
}

async function walk(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(path)));
    else found.push(path);
  }
  return found;
}

function mime(file) {
  return (
    {
      '.ttf': 'font/ttf',
      '.otf': 'font/otf',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
    }[extname(file)] ?? 'application/octet-stream'
  );
}
