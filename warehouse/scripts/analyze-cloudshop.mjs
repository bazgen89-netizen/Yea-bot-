/**
 * Разбор исходников CloudShop.
 *
 *   node scripts/analyze-cloudshop.mjs
 *
 * Что разбирается и откуда: у них AngularJS, и разметка каждого экрана лежит
 * отдельным HTML-файлом, который сайт отдаёт без входа. Плюс таблица состояний
 * в бандле, словарь подписей и таблица стилей. Всё вместе даёт структуру,
 * поля, кнопки и переходы — из первоисточника, а не с картинки.
 *
 * Скачивание отдельно: templates нужно один раз положить в папку и разбирать
 * офлайн, чтобы разбор был повторяем и не зависел от того, доступен ли сайт.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('Укажите папку со скачанными шаблонами: node scripts/analyze-cloudshop.mjs <папка>');
  process.exit(1);
}

const labels = JSON.parse(await readFile(join(src, 'loc.json'), 'utf8'));
const bundle = await readFile(join(src, 'cab.js'), 'utf8');

/** Подпись по ключу словаря; ключ, которого нет, возвращается как есть. */
const t = (key) => labels[key] ?? key;

/** Файл шаблона -> путь, которым он значится у них. */
const pathOf = (file) => file.replace(/\.html$/, '').split('-').join('/') + '.html';

/**
 * Состояния: адрес, шаблон, право и заголовок. Разбираются из таблицы
 * `$stateProvider` в бандле — это единственное место, где экран объявлен
 * целиком, и оно не расходится с приложением по определению.
 */
function states() {
  const found = [];
  const re =
    /\.state\("([^"]+)",\{url:"([^"]*)"(?:[^}]*?templateUrl:"([^"]+)")?[^}]*?(?:pageTitle:"([^"]+)")?[^}]*?(?:permission:"([^"]+)")?/g;

  for (const m of bundle.matchAll(re)) {
    found.push({
      name: m[1],
      url: m[2],
      template: m[3] ?? '',
      title: m[4] ? t(m[4]) : '',
      permission: m[5] ?? '',
    });
  }
  return found;
}

/** Колонки таблицы: подписи в порядке, в котором они стоят в разметке. */
function columns(html) {
  const out = [];
  for (const th of html.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/g)) {
    const attrs = th[1];
    const body = th[2];

    if (/table-checkbox/.test(attrs)) {
      out.push({ key: '', label: '☑', sortable: false });
      continue;
    }

    const key = /data-name="([^"]+)"/.exec(attrs)?.[1] ?? '';
    const label = /<(?:span|div)[^>]*translate[^>]*>([A-Z0-9_]+)</.exec(body)?.[1]
      ?? /translate>\s*([A-Z0-9_]+)\s*</.exec(body)?.[1]
      ?? '';
    if (!label && !key) continue;

    out.push({ key, label: label ? t(label) : key, sortable: /filter\.sort\.field/.test(body) });
  }
  return out;
}

/** Кнопки и ссылки: что на них написано и что они делают. */
function actions(html) {
  const out = [];
  for (const a of html.matchAll(/<(?:a|button|div)\b([^>]*(?:ui-sref|ng-click)[^>]*)>([\s\S]{0,300}?)<\/(?:a|button|div)>/g)) {
    const attrs = a[1];
    const body = a[2];

    const sref = /ui-sref="([^"]+)"/.exec(attrs)?.[1];
    const click = /ng-click="([^"]+)"/.exec(attrs)?.[1];
    const key =
      /translate>\s*([A-Z0-9_]+)\s*</.exec(body)?.[1] ??
      /\{\{'([A-Z0-9_]+)'\s*\|\s*translate\}\}/.exec(body + attrs)?.[1] ??
      /data-popup-string="([A-Z0-9_]+)"/.exec(attrs)?.[1];

    if (!key && !sref) continue;
    out.push({ label: key ? t(key) : '', goes: sref ?? '', does: click ?? '' });
  }
  return out;
}

/** Поля ввода: подпись, модель и вид. */
function fields(html) {
  const out = [];
  for (const f of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const attrs = f[2];
    const model = /ng-model="([^"]+)"/.exec(attrs)?.[1];
    if (!model) continue;

    const type = /type="([^"]+)"/.exec(attrs)?.[1] ?? f[1];
    const holder = /placeholder="\{\{'([A-Z0-9_]+)'\s*\|\s*translate\}\}"/.exec(attrs)?.[1];
    out.push({ model, type, hint: holder ? t(holder) : '' });
  }
  return out;
}

/** Подписи, встречающиеся в тексте страницы. */
function texts(html) {
  const keys = new Set();
  for (const m of html.matchAll(/translate>\s*([A-Z0-9_]{3,})\s*</g)) keys.add(m[1]);
  for (const m of html.matchAll(/\{\{'([A-Z0-9_]{3,})'\s*\|\s*translate\}\}/g)) keys.add(m[1]);
  return [...keys].map(t);
}

const files = (await readdir(join(src, 'tpl'))).filter((f) => f.endsWith('.html'));
const pages = [];

for (const file of files) {
  const html = await readFile(join(src, 'tpl', file), 'utf8');
  pages.push({
    file,
    path: pathOf(file),
    bytes: html.length,
    columns: columns(html),
    actions: actions(html),
    fields: fields(html),
    texts: texts(html),
    includes: [...html.matchAll(/ng-include="'([^']+)'"/g)].map((m) => m[1]),
    components: [...new Set([...html.matchAll(/<([a-z]+(?:-[a-z]+)+)[\s>]/g)].map((m) => m[1]))],
  });
}

const all = states();
await writeFile(
  join(src, 'разбор.json'),
  JSON.stringify({ states: all, pages }, null, 1),
);

console.log(`состояний: ${all.length}`);
console.log(`страниц:   ${pages.length}`);
console.log(`с таблицей: ${pages.filter((p) => p.columns.length).length}`);
console.log(`с формой:   ${pages.filter((p) => p.fields.length).length}`);
console.log(`\nразбор.json записан`);
