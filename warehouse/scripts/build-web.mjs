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

/**
 * Fira Sans Extra Condensed — шрифт их кассы.
 *
 * Это не догадка по снимку: их касса — отдельное приложение, и в его таблице
 * стилей написано `body{font-family:Fira Sans Extra Condensed,sans-serif;
 * font-size:14px}`, а сам шрифт подключён с Google Fonts. Мы рисовали кассу
 * обычным Roboto — буквы выходили шире и крупнее, отчего всё окно выглядело
 * «больше», чем у них.
 *
 * Вшиваются три начертания и три поднабора знаков: латиница, кириллица и её
 * расширение — казахские и киргизские буквы живут именно там. Армянского у
 * этого шрифта нет; армянский текст возьмёт системный, как и у них.
 */
const FIRA_RANGES = {
  latin:
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, ' +
    'U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  cyrillic: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
  'cyrillic-ext': 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F',
};

for (const weight of [400, 500, 600]) {
  for (const [subset, range] of Object.entries(FIRA_RANGES)) {
    const file = `fira/FiraSansExtraCondensed-${weight}-${subset}.woff2`;
    const data = await readFile(join(root, 'assets/fonts', file)).catch(() => null);
    if (!data) throw new Error(`Нет файла шрифта assets/fonts/${file}`);

    faces.push(
      `@font-face{font-family:"Fira Sans Extra Condensed";font-style:normal;` +
        `font-weight:${weight};font-display:swap;unicode-range:${range};` +
        `src:url(data:font/woff2;base64,${data.toString('base64')}) format("woff2")}`,
    );
  }
}

page = replaceOnce(page, '</head>', `<style id="fonts">${faces.join('')}</style></head>`);

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
 * Чтобы с телефона это открывалось приложением, а не страницей.
 *
 * Вазген просил одного: нажал на значок — открылся склад. Без этих строк
 * «Добавить на экран Домой» кладёт на рабочий стол серый квадратик со
 * снимком страницы, а по нажатию открывается браузер со всеми его
 * полосками — адресной сверху и кнопками снизу. На узком экране эти полоски
 * съедают сантиметра три, и нижнее меню программы оказывается под ними.
 *
 * Иконка и описание вшиваются прямо в файл: программа — один файл, который
 * кладут куда угодно, и ссылаться на соседние она не может.
 *
 * `apple-mobile-web-app-capable` — старое имя, но iOS до сих пор слушает
 * только его; `mobile-web-app-capable` рядом для всех остальных.
 */
const иконка = await readFile(join(root, 'assets/app-icon.png'));
const значок = `data:image/png;base64,${иконка.toString('base64')}`;

const МАНИФЕСТ = {
  name: 'Wayshop — склад и касса',
  short_name: 'Wayshop',
  start_url: '.',
  display: 'standalone',
  background_color: '#F5F6F8',
  theme_color: '#0B3FE8',
  icons: [
    { src: значок, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: значок, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

const ПРИЛОЖЕНИЕ = [
  `<link rel="apple-touch-icon" href="${значок}">`,
  `<link rel="icon" type="image/png" href="${значок}">`,
  `<link rel="manifest" href="data:application/manifest+json;base64,${Buffer.from(
    JSON.stringify(МАНИФЕСТ),
  ).toString('base64')}">`,
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="Wayshop">',
  '<meta name="application-name" content="Wayshop">',
  /*
   * `default`, а не `black-translucent`.
   *
   * Полупрозрачная полоса красивее — шапка уходит под часы и время стоит на
   * синем. Но она же и опасна: содержимое лезет под часы, и без
   * `viewport-fit=cover` вместе с отступами по `env(safe-area-inset-top)`
   * заголовок оказывается наполовину под ними. Проверить это можно только
   * на живом айфоне, которого здесь нет. Поэтому пока безопасный вариант:
   * полоса своя, программа под ней не рисуется и заголовок цел.
   */
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<meta name="theme-color" content="#0B3FE8">',
].join('');

page = replaceOnce(page, '</head>', `${ПРИЛОЖЕНИЕ}</head>`);

/**
 * Заставка на те секунды, пока программа ещё не запустилась.
 *
 * Замерено на процессоре вчетверо медленнее этой машины — то есть примерно
 * на телефоне: четыре секунды уходит на разбор страницы, а до первого
 * экрана проходит около пятидесяти. Всё это время окно было **белым**:
 * своя заставка есть только внутри программы, а до её запуска показывать
 * нечего и некому.
 *
 * Вазген на это и наткнулся: «открываю мобильную версию, а там нет никаких
 * данных, всё пусто».
 *
 * Поэтому заставка вшивается в саму страницу — обычной разметкой, без
 * единой строчки из сборки. Она рисуется браузером сразу, как только
 * дочитана шапка, и убирается, когда в корне появляется настоящий экран.
 */
const ЗАСТАВКА = `
<style id="заставка-стиль">
  #заставка {
    position: fixed; inset: 0; z-index: 9999;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 14px; padding: 24px; text-align: center;
    background: #EFF0F4; color: #111318;
    font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  #заставка .знак { font-size: 26px; font-weight: 700; letter-spacing: .5px; color: #0A37F0; }
  #заставка .круг {
    width: 28px; height: 28px; border-radius: 50%;
    border: 3px solid #C9D2E8; border-top-color: #0A37F0;
    animation: заставка-крутится 1s linear infinite;
  }
  #заставка .мелко { font-size: 14px; color: #8A8F98; max-width: 300px; }
  @keyframes заставка-крутится { to { transform: rotate(360deg); } }
  @media (prefers-color-scheme: dark) {
    #заставка { background: #000; color: #fff; }
    #заставка .знак { color: #0A84FF; }
    #заставка .круг { border-color: #2C2C2E; border-top-color: #0A84FF; }
    #заставка .мелко { color: #8E8E93; }
  }
</style>
<div id="заставка">
  <div class="знак">WAYSTEA</div>
  <div class="круг"></div>
  <div>Открываю склад и кассу…</div>
  <div class="мелко">Запуск на телефоне занимает до минуты: вся история покупок лежит в самой программе.</div>
</div>
<script>
(function () {
  // Убираем, когда в корне появился настоящий экран. Наблюдатель, а не
  // таймер: угаданное время было бы либо мало — мигнёт белым, — либо
  // велико, и заставка постояла бы поверх готовой программы.
  var убрать = function () {
    var корень = document.getElementById('root');
    if (!корень || корень.childElementCount === 0) return false;
    var з = document.getElementById('заставка');
    if (з) з.remove();
    return true;
  };
  if (убрать()) return;
  var сторож = setInterval(function () { if (убрать()) clearInterval(сторож); }, 200);
  // Страховка: если корень так и не наполнился, через три минуты убираем
  // сами — под заставкой окажется хотя бы сообщение об ошибке.
  setTimeout(function () { clearInterval(сторож); var з = document.getElementById('заставка'); if (з) з.remove(); }, 180000);
})();
</script>`;

page = replaceOnce(page, '<body>', `<body>${ЗАСТАВКА}`);

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
