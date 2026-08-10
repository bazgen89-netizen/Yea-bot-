/**
 * Сверка размеров шрифта с оригиналом.
 *
 * Меряет то, что нарисовано в браузере, а не то, что написано в стилях:
 * у react-native-web стиль складывается из нескольких классов, и «поставил 14»
 * ещё не значит «стало 14».
 *
 * Ожидаемые значения взяты из таблицы стилей CloudShop, а не с картинки.
 * Ключевое: у него `html { font-size: 14px }`, поэтому `h1: 1.9rem` — это
 * 26,6 пикселя, а не 30.
 *
 *   node scripts/audit-fonts.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const dist = '/home/user/Yea-bot-/warehouse/dist/';
mkdirSync(`${dist}audit`, { recursive: true });

const CLOUDSHOP = {
  'заголовок страницы': { size: 27, screen: 'Отчеты', text: 'Выберите тип отчёта' },
  'плитка отчёта': { size: 15.5, screen: 'Отчеты', text: 'Продажи по товарам' },
  'пункт бокового меню': { size: 14, screen: 'Товары и услуги', text: 'Движение товара' },
  'заголовок колонки': { size: 14, screen: 'Товары и услуги', text: 'Ед. изм.' },
  'ячейка таблицы': { size: 14, screen: 'Товары и услуги', text: 'Цена продажи' },
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`file://${dist}index.html`);
await page.waitForTimeout(14000);

const vis = (t) => page.getByText(t, { exact: true }).locator('visible=true').first();

/** Видимый текст страницы — так же, как в обходчике приложения. */
const lines = () =>
  page.evaluate(() => {
    const out = [];
    const walk = (el) => {
      if (el.nodeType === 3) {
        const t = el.textContent.trim();
        if (t) out.push(t);
        return;
      }
      if (el.nodeType !== 1) return;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return;
      for (const c of el.childNodes) walk(c);
    };
    walk(document.getElementById('root'));
    return out;
  });

/** Заголовок раздела: он стоит сразу за названием программы в шапке. */
async function screenTitle() {
  const l = await lines();
  const i = l.indexOf('CloudShop');
  return i >= 0 ? (l[i + 1] ?? '') : (l[0] ?? '');
}

/** Размер, начертание и гарнитура первого видимого элемента с таким текстом. */
const styleOf = (text) =>
  page.evaluate((needle) => {
    // Только элемент, у которого внутри сам текст, а не ещё один блок:
    // иначе меряется обёртка колонки, у которой шрифт браузерный по умолчанию,
    // и разбор показывает 16 пикселей Times New Roman вместо нашего стиля.
    const el = [...document.querySelectorAll('div,span')].find(
      (e) =>
        e.offsetParent &&
        e.childNodes.length === 1 &&
        e.childNodes[0].nodeType === Node.TEXT_NODE &&
        e.textContent.trim() === needle,
    );
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      size: parseFloat(s.fontSize),
      weight: s.fontWeight,
      family: s.fontFamily.split(',')[0].replace(/["']/g, ''),
      tag: el.tagName.toLowerCase(),
      cls: (el.getAttribute('class') ?? '').slice(0, 60),
      y: Math.round(el.getBoundingClientRect().y),
      x: Math.round(el.getBoundingClientRect().x),
    };
  }, text);

const results = [];
let current = '';

for (const [name, want] of Object.entries(CLOUDSHOP)) {
  if (want.screen !== current) {
    await vis(want.screen).click();
    await page.waitForTimeout(2200);
    current = want.screen;

    // Меряем, только убедившись, что открылся нужный раздел: иначе цифра
    // приедет с соседнего экрана и разбор соврёт, ничего не заметив.
    const opened = await screenTitle();
    if (!opened.includes(want.screen.split(' ')[0])) {
      results.push({ name, want: want.size, got: null, note: `не открылось: ${opened}` });
      continue;
    }
  }

  const got = await styleOf(want.text);
  results.push({ name, want: want.size, got, note: got ? '' : `нет текста «${want.text}»` });
}

console.log('ЧТО                        ОРИГИНАЛ  У НАС   ');
for (const row of results) {
  const mark = row.note
    ? `— ${row.note}`
    : Math.abs(row.got.size - row.want) < 0.6
      ? '✓'
      : '✗ РАСХОЖДЕНИЕ';
  console.log(
    `${row.name.padEnd(26)} ${String(row.want).padEnd(9)} ${(row.got ? String(row.got.size) : '—').padEnd(7)} ${mark}`,
  );
  if (mark.startsWith('✗')) {
    console.log(`      найдено: <${row.got.tag} class="${row.got.cls}"> в точке ${row.got.x},${row.got.y}, гарнитура ${row.got.family}`);
  }
}

const families = [...new Set(results.filter((r) => r.got).map((r) => r.got.family))];
console.log('\nгарнитура:', families.join(', '), families.every((f) => f === 'Roboto') ? '✓' : '✗ в оригинале Roboto');

await page.screenshot({ path: `${dist}audit/шрифты.png` });
console.log('ОШИБКИ:', errors.length ? errors.slice(0, 3) : 'нет');
await browser.close();
