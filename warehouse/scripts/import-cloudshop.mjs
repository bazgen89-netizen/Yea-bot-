/**
 * Перенос всего из CloudShop одной командой.
 *
 *   CLOUDSHOP_TOKEN=… node scripts/import-cloudshop.mjs
 *
 * Забирает и кладёт туда, откуда программа заводит свою базу:
 *
 *   • товары   — все поля карточки: код, артикул, штрихкод, PLU, единица,
 *                цена, скидка, вес, размеры, описание, категория, остатки по
 *                магазинам, и фотографии;
 *   • клиенты  — имя, телефоны, почта, день рождения, пол, адрес, личная
 *                скидка, бонусный счёт и накопления;
 *   • история  — все чеки со строками: что, сколько, почём, кому и когда.
 *
 * Ключ читается только из переменной окружения. Ключ, попавший в git,
 * остаётся в истории навсегда, и «удалить» его оттуда нельзя — только
 * перевыпустить в кабинете. Пароль от CloudShop не нужен вовсе.
 *
 * Ключи:
 * Выгрузка ложится в `src/db/seed/local/` — рядом, но **не в git**: там
 * телефоны и дни рождения живых людей. Собрать с ней программу:
 *
 *   node scripts/build-mine.mjs
 *
 * Ключи:
 *   --no-photos       не забирать фотографии (быстро)
 *   --no-history      не забирать историю покупок
 *   --history=N       сколько последних чеков брать (по умолчанию все)
 *   --since=ГГГГ-ММ-ДД  с какого дня история (по умолчанию 2019-01-01)
 *   --into-repo       положить в сборочную папку, которая лежит в git
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://connect-api.cloudshop.ru/api/v4';
const token = process.env.CLOUDSHOP_TOKEN;

if (!token) {
  console.error('Нужен ключ: CLOUDSHOP_TOKEN=… node scripts/import-cloudshop.mjs');
  console.error('Взять его: кабинет CloudShop → Интеграции → Connect API → создать ключ.');
  console.error('Пароль от кабинета не нужен и не принимается.');
  process.exit(1);
}

// Ключ уходит заголовком, а в заголовок можно только латиницу: если в
// переменную попал русский текст (например, слово «токен»), ошибка вылезет
// глубоко внутри `fetch` и ничего не объяснит.
if (/[^\x20-\x7e]/.test(token)) {
  console.error('В CLOUDSHOP_TOKEN попали нелатинские знаки — это не ключ.');
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flag = (name) => process.argv.includes(`--${name}`);
const value = (name, fallback) => {
  const found = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

/**
 * Кладём в `src/db/seed/local/` — папку, которой нет в git.
 *
 * В выгрузке три тысячи телефонов, дни рождения и бонусные счета живых
 * людей. Файл, единожды попавший в историю репозитория, из неё уже не убрать
 * — только переписав историю целиком, а до тех пор его видит каждый, у кого
 * есть доступ. Поэтому по умолчанию личные данные никогда не ложатся туда,
 * откуда их закоммитят одним `git add .`.
 *
 * Собирается программа с этой выгрузкой командой `node scripts/build-mine.mjs`
 * — она подставляет её на время сборки и убирает обратно.
 *
 * `--into-repo` кладёт прямо в сборочную папку. Это осознанный шаг, и нужен
 * он ровно для одного: обновить каталог в общей сборке, где личных данных
 * нет.
 */
const out = flag('into-repo') ? `${root}/src/db/seed` : `${root}/src/db/seed/local`;
mkdirSync(out, { recursive: true });

/**
 * Пол — словом, а не по-английски.
 *
 * CloudShop отдаёт `male` / `female`, а в карточке выбирают «Мужской» и
 * «Женский» — теми же словами он и должен быть записан, иначе выбор в карточке
 * не совпадёт с тем, что в ней уже стоит.
 */
function gender(value) {
  const word = String(value ?? '').trim().toLowerCase();
  if (word === 'male' || word === 'м' || word === 'мужской') return 'Мужской';
  if (word === 'female' || word === 'ж' || word === 'женский') return 'Женский';
  return null;
}

/**
 * Когда карточку завели.
 *
 * CloudShop отдаёт метку времени в секундах, да ещё строкой: `"1787048594"`.
 * Хранить дату создания клиента днём сегодняшним нельзя — тогда вся база
 * выглядит заведённой в день переноса, и «давно ли он у нас покупает» уже
 * не спросишь.
 */
function created(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** День рождения — «12.07.2006». Приходит он как «2006-07-12». */
/**
 * День рождения — как его видит хозяин, а не как он лежит в UTC.
 *
 * CloudShop отдаёт дату меткой времени, и метка стоит на местную полночь.
 * Если брать из неё дату по Гринвичу, у магазина в МСК (UTC+3) день уезжает
 * на сутки назад: 13 июля превращается в 12-е. Так и вышло — у него в
 * кабинете «13/07/2006», а у меня стояло «12.07.2006».
 *
 * Поэтому метка сдвигается на московский час перед тем, как из неё берут
 * день. Формат — его: «13/07/2006».
 */
const MSK_OFFSET = 3 * 60 * 60 * 1000;

function birthday(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;

  // Метка времени в секундах — так её отдаёт ключ.
  if (/^\d{9,}$/.test(text)) {
    const at = new Date(Number(text) * 1000 + MSK_OFFSET);
    const pad = (one) => String(one).padStart(2, '0');
    return `${pad(at.getUTCDate())}/${pad(at.getUTCMonth() + 1)}/${at.getUTCFullYear()}`;
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

  // Уже готовая дата: приводим разделитель к его косой черте.
  return text.replace(/[.\-]/g, '/');
}

/** Цены — копейки, количества — тысячные: в базе они целые. */
const kopecks = (input) => Math.round((Number(input) || 0) * 100);
const milli = (input) => Math.round((Number(input) || 0) * 1000);
const bp = (percent) => Math.round((Number(percent) || 0) * 100);

async function get(path) {
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        headers: { 'X-CloudShop-API-Access-Token': token, Accept: 'application/json' },
        redirect: 'manual',
      });
    } catch (error) {
      // Сеть моргнула — пробуем ещё пару раз: выгрузка длинная, и ронять её
      // из-за одного разрыва обидно.
      if (attempt >= 3) throw error;
      await new Promise((done) => setTimeout(done, attempt * 2000));
      continue;
    }

    // Отказ приходит редиректом на главную, а не кодом ошибки: без этой
    // проверки пустой ответ читался бы как «данных нет».
    if (response.status === 302) {
      throw new Error(`${path}: ключ не принят или ему не хватает прав`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        'ключ не принят. Проверьте, что он скопирован целиком и не отозван: ' +
          'кабинет CloudShop → Интеграции → Connect API.',
      );
    }
    if (response.status === 429 && attempt < 5) {
      await new Promise((done) => setTimeout(done, attempt * 3000));
      continue;
    }
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);

    return response.json();
  }
}

/** Постранично, пока страница приходит полной. */
async function all(path, limit, label, cap = Infinity) {
  const rows = [];

  for (let offset = 0; rows.length < cap; offset += limit) {
    const glue = path.includes('?') ? '&' : '?';
    const page = await get(`${path}${glue}limit=${limit}&offset=${offset}`);
    const list = Array.isArray(page) ? page : (page.data ?? page.items ?? []);

    rows.push(...list);
    process.stdout.write(`\r  ${label}: ${rows.length}`);
    if (list.length < limit) break;
  }

  process.stdout.write('\n');
  return rows.slice(0, cap === Infinity ? rows.length : cap);
}

/**
 * С какого дня забирать историю по умолчанию.
 *
 * Первые чеки у него — 2019 год. Дата вынесена сюда, чтобы её было видно:
 * взять «с начала времён» нельзя, окна пришлось бы гонять впустую за годы,
 * которых не было.
 */
const SINCE = '2019-01-01';

/**
 * Вся история покупок — окнами по месяцу.
 *
 * Без дат `documents/sales` отдаёт последние семь дней, и на этом всё: ни
 * страницами, ни смещением дальше не уйти. Даты у него называются
 * `time_start` и `time_end`, и **окно не может быть длиннее 31 дня** — иначе
 * ответ 422. Поэтому история берётся помесячно, от свежего к старому: если
 * перенос прервётся, на руках останутся последние месяцы, а не первые.
 *
 * Внутри окна — обычная разбивка по страницам: чеков за месяц бывает и
 * восемьсот, а за раз отдают сто.
 */
async function history(since, cap) {
  return walk('/documents/sales', since, cap, 'чеков');
}

/**
 * Возвраты продаж — отдельным запросом, их в переносе не было вовсе.
 *
 * У них свой раздел (`/documents/return?type=sales`) и своя нумерация:
 * «Возврат продажи #11». В журнале они стоят рядом с чеками и отличаются
 * цветом полоски, а в выручке уменьшают её — потому и нужны.
 */
async function returns(since) {
  return walk('/documents/return?type=sales', since, Infinity, 'возвратов');
}

/**
 * Обойти раздел документов помесячно, от свежих к старым.
 *
 * Окно не длиннее месяца — CloudShop не отдаёт промежутки больше 31 дня, а
 * без дат возвращает последние семь суток. На это я однажды напоролся и
 * решил, что глубже недели истории нет.
 */
async function walk(path, since, cap, label) {
  const documents = [];
  const start = new Date(`${since}T00:00:00Z`);
  const join = path.includes('?') ? '&' : '?';

  // Идём от сегодняшнего дня назад, отступая по месяцу.
  let to = new Date();

  while (to > start && documents.length < cap) {
    const from = new Date(to);
    from.setUTCMonth(from.getUTCMonth() - 1);
    if (from < start) from.setTime(start.getTime());

    const window =
      `time_start=${encodeURIComponent(stamp(from))}` +
      `&time_end=${encodeURIComponent(stamp(to))}`;

    for (let offset = 0; documents.length < cap; offset += 100) {
      const page = await get(`${path}${join}${window}&limit=100&offset=${offset}`);
      const list = Array.isArray(page) ? page : (page.data ?? page.items ?? []);

      documents.push(...list);
      process.stdout.write(`\r  ${label}: ${documents.length}  (${stamp(from).slice(0, 7)})   `);
      if (list.length < 100) break;
    }

    // Следующее окно кончается там, где началось это, минус секунда: иначе
    // чек, пробитый ровно на границе, приехал бы дважды.
    to = new Date(from.getTime() - 1000);
  }

  process.stdout.write('\n');
  return cap === Infinity ? documents : documents.slice(0, cap);
}

/**
 * Пустые поля в файл не пишем.
 *
 * На одном чеке `"d":0` и `"cn":null` не стоят ничего; на сорока пяти
 * тысячах — это лишние мегабайты, которые потом лежат в собранном файле и
 * грузятся при каждом запуске. Разбор читает эти поля через `??` и `?? 0`,
 * так что отсутствие для него то же самое, что ноль.
 */
function skipEmpty(key, value) {
  if (value === null || value === 0) return undefined;
  return value;
}

/** «2026-08-19 11:14:27» — время у них в этом виде и только в нём. */
function stamp(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// Ошибки печатаем строкой, а не стеком: тому, кто запускает перенос, нужен
// ответ «что не так», а не место в коде.
process.on('unhandledRejection', (error) => {
  console.error(`\nНе получилось: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

// --- магазины -------------------------------------------------------------

console.log('Магазины…');
const { shops = [] } = await get('/stores');
const storeName = new Map(shops.map((shop) => [shop.id, (shop.name ?? '').trim()]));

/**
 * Настоящие магазины — те, у которых есть адрес.
 *
 * CloudShop отдаёт семь «магазинов», но три из них — счета («№1»,
 * «Терминал / Счет в банке») и старые двойники, оставшиеся от переездов.
 * В его телефоне в выборе магазина ровно три строки, и у каждой адрес.
 * Остатки и чеки тоже лежат только в этих трёх.
 */
const realStores = shops
  .filter((shop) => (shop.address ?? '').trim())
  .map((shop) => ({ n: (shop.name ?? '').trim(), a: shop.address.trim() }));

writeFileSync(`${out}/stores.json`, JSON.stringify(realStores, null, 1));
console.log(`  ${shops.length}, из них магазинов: ${realStores.length}`);

/**
 * Названия касс.
 *
 * Запроса `/registers` в Connect API нет вовсе, а в документе лежит только
 * внутренний номер кассы. Но у CloudShop касса и её «магазин» заводятся
 * одной парой, и их идентификаторы отличаются последним знаком: касса
 * `…7596` — магазин `…7597` с названием «№1». Проверено по его документу:
 * там, где он видит «Касса: №1», в чеке стоит именно `…7596`.
 *
 * Поэтому названия достаём соседом: для каждого номера кассы спрашиваем
 * магазин с номером на единицу больше. Не нашлось — строка останется
 * пустой, выдумывать название не станем.
 */
async function registerNames(ids) {
  const names = new Map();

  for (const id of ids) {
    const next = id.slice(0, -1) + ((parseInt(id.slice(-1), 16) + 1) % 16).toString(16);
    try {
      const answer = await get(`/stores/${next}`);
      const name = (answer.shop?.name ?? '').trim();
      if (name) names.set(id, name);
    } catch {
      // Соседа нет — касса останется без названия.
    }
  }

  return names;
}

// --- товары ---------------------------------------------------------------

console.log('Товары…');
const rawProducts = await all('/product', 1000, 'товаров');

console.log('Себестоимость и цены закупки…');
const prices = await costPrices(value('since', SINCE));

/**
 * Формат — тот же, в котором лежит наполнение базы: короткие ключи и целые
 * числа. Он читается и глазами: остатки подписаны названием магазина, а не
 * идентификатором CloudShop, который у нас ничего не значит.
 */
/**
 * Себестоимость и закупочная цена — из документов корректировки.
 *
 * В карточке товара (`/product`) их нет вовсе: Connect API отдаёт только
 * цену продажи и скидку. Но в строках документов «Корректировка»
 * (`/documents/changes`) лежит `legacy_line.prices` — там и `cost`
 * (себестоимость), и `purchase` (цена закупки), теми числами, какими они
 * стояли в карточке на день документа.
 *
 * Поэтому документы читаются от свежих к старым, и первое попавшееся
 * значение и есть нынешнее. Ноль — тоже значение: у части товаров
 * себестоимость не проставлена, и подставлять вместо неё позапрошлогоднюю
 * было бы хуже, чем оставить ноль.
 *
 * Это всё, что о себестоимости отдаёт ключ. Точной сходимости с отчётом
 * кабинета отсюда не будет: там себестоимость продажи берётся на момент
 * чека, а не из карточки. Но карточка товара переносится такой, какая она
 * есть в CloudShop, — а этого и просили.
 */
async function costPrices(since) {
  const cost = new Map();
  const purchase = new Map();
  let documents = 0;

  let to = new Date();
  const edge = new Date(`${since}T00:00:00Z`);

  while (to > edge) {
    const from = new Date(to);
    from.setUTCMonth(from.getUTCMonth() - 1);
    if (from < edge) from.setTime(edge.getTime());

    const window =
      `time_start=${encodeURIComponent(stamp(from))}&time_end=${encodeURIComponent(stamp(to))}`;

    for (let offset = 0; ; offset += 100) {
      const page = await get(`/documents/changes?${window}&limit=100&offset=${offset}`);
      const rows = page.data ?? page.documents ?? page;
      if (!Array.isArray(rows) || rows.length === 0) break;
      documents += rows.length;

      for (const document of rows) {
        for (const line of document.line_items ?? []) {
          const prices = line.legacy_line?.prices;
          const id = line.id ?? line.legacy_line?._id;
          if (!prices || !id) continue;

          if (!cost.has(id)) cost.set(id, kopecks(prices.cost));
          if (!purchase.has(id)) purchase.set(id, kopecks(prices.purchase));
        }
      }

      if (rows.length < 100) break;
    }

    process.stdout.write(`\r  корректировок: ${documents}   `);
    to = new Date(from.getTime() - 1000);
  }

  process.stdout.write('\n');
  return { cost, purchase };
}

/**
 * Снятые с продажи товары.
 *
 * Их 689 — против 591 живого, — и без них история покупок наполовину
 * безымянная: чек трёхлетней давности ссылается на товар, которого в
 * справочнике уже нет, и раньше вместо карточки заводилась заглушка с одним
 * названием из строки чека. Теперь приезжает настоящая карточка: код,
 * артикул, штрихкод, цена, категория.
 *
 * В программе они заводятся архивными: в справочнике и на витрине их не
 * видно, продать нельзя, а история цела. Так же и в кабинете.
 */
console.log('Снятые с продажи…');
const deleted = await get(
  `/product/deleted?start_time=${encodeURIComponent(`${value('since', SINCE)} 00:00:00`)}`,
);
const rawDeleted = deleted.data ?? deleted.products ?? deleted;
console.log(`  ${Array.isArray(rawDeleted) ? rawDeleted.length : 0}`);

const card = (item, archived) => {
  const options = item.options ?? {};
  const size = item.dimensions ?? {};

  const stock = {};
  for (const [id, qty] of Object.entries(item.stock ?? {})) {
    const amount = milli(qty);
    if (amount !== 0) stock[storeName.get(id) ?? id] = amount;
  }

  return {
    n: (options.name ?? '').trim(),
    c: item.code || null,
    s: item.sku || null,
    // Штрихкод и PLU — по ним товар ищется сканером и весами.
    bc: item.barcode || null,
    plu: item.plu_code || null,
    u: item.unit || 'шт',
    p: kopecks(item.price),
    // Себестоимость и цена закупки: в самой карточке их нет, они собраны
    // выше из документов корректировки.
    cp: prices.cost.get(item.id) ?? 0,
    pp: prices.purchase.get(item.id) ?? 0,
    d: bp(item.discount),
    // Категорий у товара в CloudShop может быть несколько, у нас одна:
    // берём первую, а не склеиваем в строку, которой нигде нет.
    g: item.tags?.[0] ?? null,
    q: stock,
    // Описание, вес и размеры — то, что у него лежит в карточке ниже цены.
    desc: (options.description ?? '').trim() || null,
    wg: item.weight ? Math.round(Number(item.weight) * 1000) : null,
    hm: size.height ? Math.round(Number(size.height) * 10) : null,
    wm: size.width ? Math.round(Number(size.width) * 10) : null,
    dm: size.depth ? Math.round(Number(size.depth) * 10) : null,
    // Ссылка на фотографию — по ней качается картинка ниже.
    img: item.img?.[0] ?? null,
    // Снят с продажи: заводится архивным, в справочнике не показывается.
    del: archived ? 1 : undefined,
  };
};

const products = [
  ...rawProducts.map((item) => card(item, false)),
  // Снятые идут после живых: если код повторяется, в справочнике останется
  // живая карточка, а не архивная.
  ...(Array.isArray(rawDeleted) ? rawDeleted.map((item) => card(item, true)) : []),
];

writeFileSync(`${out}/products.json`, JSON.stringify(products, null, 1));

// --- клиенты --------------------------------------------------------------

console.log('Клиенты…');
const rawCustomers = await all('/customers', 500, 'клиентов');

const customers = rawCustomers.map((item) => {
  const billing = item.billing ?? {};
  const loyalty = item.loyalty ?? {};

  const phones = []
    .concat(billing.phone ?? [], billing.phones ?? [], item.phones ?? [])
    .filter((phone) => typeof phone === 'string' && phone.trim())
    .map((phone) => phone.trim());

  // Почта приходит списком, и в нём бывает пустая строка вместо пропуска:
  // без отсева карточка получала бы почту «ничего» вместо «почты нет».
  const emails = []
    .concat(item.emails ?? [], billing.email ?? [])
    .filter((mail) => typeof mail === 'string' && mail.trim());

  return {
    // Идентификатор CloudShop нужен, чтобы привязать к клиенту его чеки.
    id: item.id ?? null,
    n: (item.name ?? '').trim(),
    p: phones[0] ?? null,
    ph: phones.length > 1 ? phones : null,
    e: emails[0]?.trim() ?? null,
    b: birthday(item.birthday),
    g: gender(item.sex),
    // Адреса и комментария по ключу CloudShop не отдаёт вовсе: в карточке
    // приезжают только имя, телефоны, почта, день рождения, пол, скидка и
    // бонусы. Читать `billing.address` и `billing.note`, как я делал
    // сначала, — значит каждый раз получать пустоту: таких полей у них нет.
    // Донести адреса и комментарии можно файлом: «Импорт клиентов».
    d: null,
    a: null,
    // Кто завёл карточку, CloudShop по ключу не сообщает. Писать сюда
    // «CloudShop» — значит заполнить колонку одним и тем же словом на все
    // три тысячи строк и занять место, ничего не сказав.
    by: null,
    // Когда карточку завели. Приходит меткой времени в секундах.
    at: created(item.date_created),
    // Личная скидка — в сотых долях процента, как и везде у нас.
    dc: bp(item.discount),
    // Бонусный счёт и что уже потрачено. Поля названы так, как их отдаёт
    // CloudShop: `bonus_balance` и `bonus_spent`. Короткие `bonus`/`balance`,
    // на которые я целился сначала, у них не существуют — и все бонусы
    // переносились нулями.
    bo: kopecks(loyalty.bonus_balance ?? 0),
    bs: kopecks(loyalty.bonus_spent ?? 0),
    // Процент возврата бонусами — в сотых долях процента.
    cb: bp(loyalty.cashback_rate ?? 0),
    lt: loyalty.type ?? (Number(item.discount) > 0 ? 'discount' : null),
  };
});

writeFileSync(`${out}/clients.json`, JSON.stringify(customers, null, 1));

// --- история покупок ------------------------------------------------------

let sales = [];

if (!flag('no-history')) {
  console.log('История покупок…');
  const cap = Number(value('history', '')) || Infinity;
  const documents = await history(value('since', SINCE), cap);

  /** Товары из чеков, которых нет в справочнике: идентификатор → код. */
  const lost = new Map();

  // Возвраты продаж — свой раздел CloudShop. В журнале они стоят рядом с
  // чеками, а из выручки вычитаются.
  const refunds = cap === Infinity ? await returns(value('since', SINCE)) : [];

  /**
   * Чем строка чека опознаётся в справочнике.
   *
   * У нас товар ищется кодом, а в чеке лежит карточка целиком — и код в ней
   * есть не всегда: у половины строк заполнен только артикул. Поэтому
   * собираем несколько подходов к одному и тому же товару и пробуем их по
   * очереди, от самого надёжного к самому приблизительному.
   */
  // Снятые с продажи тоже считаются известными: их карточки теперь
  // переносятся, и строка чека трёхлетней давности находит настоящий товар,
  // а не заглушку с одним названием.
  const catalog = [...rawProducts, ...(Array.isArray(rawDeleted) ? rawDeleted : [])];
  const known = new Set(catalog.map((item) => item.code).filter(Boolean));
  const codeById = new Map();
  const codeBySku = new Map();
  const codeByBarcode = new Map();
  const codeByName = new Map();

  for (const item of catalog) {
    if (!item.code) continue;
    codeById.set(item.id, item.code);
    if (item.sku) codeBySku.set(String(item.sku).trim(), item.code);
    if (item.barcode) codeByBarcode.set(String(item.barcode).trim(), item.code);

    const name = (item.options?.name ?? '').trim();
    if (name && !codeByName.has(name)) codeByName.set(name, item.code);
  }

  /** Первое попадание из всего, что известно о строке. */
  const resolve = (product, line, name) => {
    const code = product.code ? String(product.code).trim() : null;
    if (code && known.has(code)) return code;

    const sku = product.sku ? String(product.sku).trim() : null;
    const barcode = product.barcode ? String(product.barcode).trim() : null;

    return (
      (sku && codeBySku.get(sku)) ||
      (barcode && codeByBarcode.get(barcode)) ||
      codeById.get(line.product_id) ||
      codeByName.get(name) ||
      // Товара в справочнике больше нет — оставляем код как есть: строка
      // всё равно не найдётся, но по коду понятно, чего не хватает.
      code ||
      sku ||
      null
    );
  };

  // Чеки и возвраты идут одним списком: в журнале они стоят рядом, и
  // раскладывать их по двум файлам значило бы дважды писать одно и то же.
  sales = [
    ...documents.map((doc) => ({ doc, ret: 0 })),
    ...refunds.map((doc) => ({ doc, ret: 1 })),
  ].map(({ doc, ret }) => ({
    /** Возврат продажи: товар едет назад, деньги — из кассы. */
    ret: ret || undefined,
    // Дата чека — та, что стоит в документе, а не время выгрузки.
    at: doc.processed_at ?? doc.created_at ?? null,
    // Клиент лежит в `customer`, а не в `client_id`: `client_id` — это
    // идентификатор компании, один и тот же во всех чеках (тот самый кусок,
    // что стоит и в ключе). По нему вся история склеилась бы в одного
    // покупателя.
    c: doc.customer?.id ?? null,
    // Имя клиента храним рядом: если карточку в справочнике потом удалят,
    // чек всё равно будет подписан, а не «Розничный покупатель».
    cn: customerName(doc.customer),
    t: kopecks(doc.total_price),
    disc: kopecks(doc.total_discounts),
    pay: payment(doc),
    st: storeName.get(doc.location_id) ?? null,
    // Кто пробил чек: учётная запись кассы или хозяина — «Чайный бар»,
    // «Черёмушки», «waystea». Именно её показывает колонка «Автор».
    au: (doc.actor?.name ?? '').trim() || null,
    // Касса и смена — внутренними номерами; названия и порядковый номер
    // проставляются ниже, когда собрана вся история.
    rg: doc.references?.register_id ?? null,
    sh: doc.references?.shift_id ?? null,
    // Номер документа — тот, под которым чек живёт в CloudShop: «Продажа
    // #45658». Внутренний номер здесь никому не нужен, по нему он свой чек
    // не найдёт.
    no: doc.order_number ?? null,
    // И номер прихода — под ним тот же чек виден в движении денег.
    ono: orderNumber(doc),
    /**
     * Комментарий к продаже.
     *
     * В описи ключа он есть у обоих видов документов: у продажи это поле
     * `comment` («Comment for the sale»), у складских — `note` («Document
     * comment»). Я не забирал ни то, ни другое, и в журнале у чеков не было
     * значка заметки, хотя в кабинете он стоит.
     */
    cm: (doc.comment ?? doc.note ?? '').trim() || null,
    // Бонусы по чеку: начислено и списано. Лежат построчно, в `legacy_line`,
    // и складываются по всему чеку — в карточке клиента история бонусов
    // ведётся по покупкам, а не по строкам.
    be: kopecks(
      (doc.line_items ?? []).reduce(
        (sum, line) => sum + (Number(line.legacy_line?.bonus_cashback) || 0),
        0,
      ),
    ),
    bu: kopecks(
      (doc.line_items ?? []).reduce(
        (sum, line) =>
          sum +
          (Number(line.legacy_line?.bonus_spent) || 0) +
          (Number(line.legacy_line?.bonus_discount) || 0),
        0,
      ),
    ),
    ln: (doc.line_items ?? []).map((line) => {
      // Всё о товаре строки лежит внутри `legacy_line`: наверху ни кода, ни
      // артикула нет — там только количество и идентификатор движения.
      const inner = line.legacy_line ?? {};
      const product = inner.product ?? {};
      const name = (product.name ?? line.name ?? line.title ?? '').trim();

      const code = resolve(product, line, name);

      // Товара нет ни среди живых, ни среди снятых — запомним его
      // идентификатор: карточку можно попросить поштучно, `/product/{id}`
      // отдаёт и наборы, которых нет в общем списке.
      if (!known.has(code)) {
        const id = line.id ?? inner._id ?? line.product_id;
        if (id) lost.set(String(id), code);
      }

      return {
        code,
        // Название нужно только тогда, когда товара в справочнике уже нет:
        // если код нашёлся, имя возьмётся из карточки. Повторять его в
        // каждой из ста тысяч строк — те же мегабайты на пустом месте.
        n: known.has(code) ? null : name || null,
        // Количество приходит движением склада, то есть со знаком минус:
        // продали две — в выгрузке «-2». В чеке нужны просто две.
        q: Math.abs(milli(inner.qty ?? line.quantity ?? 0)),
        p: kopecks(inner.price ?? line.price ?? line.unit_price ?? 0),
        d: kopecks(inner.discount_sum ?? line.discount ?? 0),
      };
    }),
  }));

  /**
   * Дозагрузить карточки товаров, которых не было в общих списках.
   *
   * Так приезжают наборы — «В зале Габа Алишань» и прочие позиции с
   * составом: в `/product` их 88, но в `/product/deleted` снятых наборов
   * нет вовсе, а в истории они встречаются пятнадцатью тысячами строк.
   * Поштучный запрос `/product/{id}` отдаёт их без разговоров.
   */
  if (lost.size) {
    console.log(`Дозагрузка карточек из истории: ${lost.size}…`);
    let got = 0;

    for (const id of lost.keys()) {
      try {
        const one = await get(`/product/${id}`);
        const item = one.product ?? one.data ?? one;
        if (item && item.id) {
          products.push(card(item, true));
          got++;
        }
      } catch {
        // Карточки нет — строка останется с именем из чека, как раньше.
      }

      if (got % 25 === 0 && got) process.stdout.write(`\r  дозагружено: ${got}   `);
    }

    process.stdout.write(`\r  дозагружено: ${got}\n`);
    writeFileSync(`${out}/products.json`, JSON.stringify(products, null, 1));
  }

  /**
   * Касса — названием, смена — порядковым номером.
   *
   * Смены в CloudShop пронумерованы подряд: в его документе от 23 августа
   * стоит «Смена #3430». Ключ отдаёт только внутренний номер, поэтому
   * нумеруем сами — по времени первого чека смены, от самой старой к самой
   * свежей. Если счёт сойдётся с его номером, значит это те же смены.
   */
  const registers = await registerNames(new Set(sales.map((sale) => sale.rg).filter(Boolean)));

  const firstSeen = new Map();
  for (const sale of sales) {
    if (!sale.sh || !sale.at) continue;
    const seen = firstSeen.get(sale.sh);
    if (!seen || sale.at < seen) firstSeen.set(sale.sh, sale.at);
  }

  const order = [...firstSeen.entries()].sort((a, b) => (a[1] < b[1] ? -1 : 1));
  const shiftNo = new Map(order.map(([id], index) => [id, index + 1]));

  for (const sale of sales) {
    sale.rg = sale.rg ? (registers.get(sale.rg) ?? null) : null;
    sale.sh = sale.sh ? (shiftNo.get(sale.sh) ?? null) : null;
  }

  console.log(`  касс: ${registers.size}, смен: ${shiftNo.size}`);

  const fresh = sales.length;
  sales = mergeHistory(sales);
  if (sales.length > fresh) console.log(`  вместе с прежними: ${sales.length}`);

  // История пишется без отступов и без пустых полей. Отступ в один пробел
  // стоит недорого на пятистах строках и дорого — на сорока пяти тысячах
  // чеков: он один прибавляет к файлу мегабайты, а читать эту выгрузку
  // глазами всё равно никто не будет.
  writeFileSync(`${out}/sales.json`, JSON.stringify(sales, skipEmpty));
}

/**
 * Прибавить свежие чеки к тем, что уже лежат в файле.
 *
 * CloudShop отдаёт по своему ключу **только последнюю неделю**: в кабинете
 * чеков сорок пять тысяч, а `documents/sales` показывает две сотни — всё, что
 * старше семи дней, из выдачи пропадает, и никакими датами его не достать
 * (проверено: `from`/`to` возвращают пустоту, а разбивка по страницам
 * заканчивается на двести девятом).
 *
 * Значит, всю историю разом забрать нельзя — её можно только накапливать:
 * запускать перенос раз в несколько дней, и каждый раз новые чеки будут
 * ложиться к уже собранным. Поэтому файл не переписывается, а дополняется.
 *
 * Чеки различаются номером документа: он у CloudShop сквозной и не
 * повторяется. Чек без номера считаем новым — потерять его хуже, чем
 * задвоить.
 */
function mergeHistory(fresh) {
  let old = [];
  try {
    old = JSON.parse(readFileSync(`${out}/sales.json`, 'utf8'));
  } catch {
    return fresh;
  }
  if (!Array.isArray(old) || old.length === 0) return fresh;

  const seen = new Set(fresh.map((sale) => sale.no).filter((no) => no !== null));
  const kept = old.filter((sale) => sale.no === null || !seen.has(sale.no));

  // По времени, от старых к новым: журнал читается сверху вниз.
  return [...kept, ...fresh].sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
}

/**
 * Как подписан покупатель в чеке.
 *
 * У розничных имя лежит в `legacy_party.name` («Розничный покупатель»), у
 * заведённых карточек — в `first_name` и `last_name`.
 */
function customerName(customer) {
  if (!customer) return null;

  const full = [customer.first_name, customer.last_name]
    .filter((part) => typeof part === 'string' && part.trim())
    .join(' ')
    .trim();

  const name = full || (customer.legacy_party?.name ?? '').trim();

  // «Розничный покупатель» — не имя, а его отсутствие: так подписан любой чек
  // без карточки, и приходит оно разложенным на имя и фамилию. Повторять эту
  // строку в каждом из тысяч чеков незачем — журнал подписывает их так и сам.
  return name && name.toLowerCase() !== 'розничный покупатель' ? name : null;
}

/** Чем платили: у него это флаги в `payment_terms`. */
function payment(doc) {
  // Деньги по чеку лежат в `orders` — это те самые «Приход #46047», что
  // видны в движении денег. У каждого прихода есть признак `cash`: правда —
  // наличные, ложь — терминал. В `payment_terms`, куда я смотрел сначала,
  // способа оплаты нет вовсе — там только «оплачен/недоплата», и оттого все
  // сорок пять тысяч чеков выходили наличными, а счёт в движении денег
  // всегда был «Касса магазина».
  const orders = (doc.orders ?? []).filter((order) => order?.type === 'debit');
  if (orders.length === 0) return 'cash';

  // Чек бывает оплачен и так, и так. Считаем по деньгам: чем заплатили
  // больше, тем чек и подписан.
  let cash = 0;
  let card = 0;
  for (const order of orders) {
    const sum = Math.abs(Number(order.sum ?? order.legacy_order?.sum ?? 0)) || 0;
    if (order.cash ?? order.legacy_order?.cash) cash += sum;
    else card += sum;
  }

  return card > cash ? 'card' : 'cash';
}

/** Номер прихода — по нему чек виден в движении денег. */
function orderNumber(doc) {
  const order = (doc.orders ?? []).find((item) => item?.type === 'debit' && item.number);
  return order?.number ?? null;
}

// --- фотографии -----------------------------------------------------------

if (!flag('no-photos')) {
  console.log('Фотографии…');
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const photos = {};
  let done = 0;
  let failed = 0;

  for (const product of products) {
    if (!product.img || !product.c) continue;

    try {
      // Картинку скачиваем здесь, а не в браузере, и передаём внутрь уже
      // строкой. Иначе холст оказывается «испорченным»: браузер не отдаёт
      // содержимое холста, на который легла картинка с чужого адреса, и
      // `toDataURL` бросает ошибку — все до одной фотографии пропали бы.
      const source = await download(product.img);
      if (!source) {
        failed++;
        continue;
      }

      // Ужимаем прямо в браузере: 590 фотографий по 2–3 КБ дают полтора
      // мегабайта, и файл это выдерживает. Полноразмерные — сотни мегабайт.
      const data = await page.evaluate(shrink, { url: source, size: 96 });
      if (data) {
        photos[product.c] = data;
        done++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }

    if ((done + failed) % 25 === 0) process.stdout.write(`\r  фотографий: ${done}`);
  }

  process.stdout.write(`\r  фотографий: ${done}\n`);
  if (failed) console.log(`  не скачалось: ${failed}`);

  await browser.close();
  writeFileSync(`${out}/photos.json`, JSON.stringify(photos, null, 1));
}

/**
 * Скачать картинку и превратить её в строку, которую поймёт браузер.
 *
 * Возвращает `null`, если картинки нет: карточка на неё ссылается, а файл с
 * тех пор удалили — обычное дело в каталоге, который правят годами.
 */
async function download(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;

      const bytes = Buffer.from(await response.arrayBuffer());
      const type = response.headers.get('content-type') ?? 'image/jpeg';
      return `data:${type};base64,${bytes.toString('base64')}`;
    } catch {
      if (attempt === 3) return null;
      await new Promise((done) => setTimeout(done, attempt * 500));
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
function shrink({ url, size }) {
  return new Promise((done) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onerror = () => done(null);
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;

      const context = canvas.getContext('2d');
      if (!context) return done(null);

      // Вписываем по короткой стороне и обрезаем — так товар остаётся в
      // середине, а не сжимается в блин.
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

      done(canvas.toDataURL('image/jpeg', 0.72));
    };
    image.src = url;
  });
}

// --- итог -----------------------------------------------------------------

const size = (file) => {
  try {
    return `${Math.round(readFileSync(`${out}/${file}`).length / 1024)} КБ`;
  } catch {
    return '—';
  }
};

console.log(`
  товаров          ${products.length}   из них снятых с продажи ${products.filter((item) => item.del).length}   (${size('products.json')})
  с фотографией    ${flag('no-photos') ? 'пропущено' : Object.keys(JSON.parse(readFileSync(`${out}/photos.json`, 'utf8'))).length}
  клиентов         ${customers.length}   (${size('clients.json')})
  чеков в истории  ${flag('no-history') ? 'пропущено' : sales.length}   из них возвратов ${flag('no-history') ? 0 : sales.filter((item) => item.ret).length}   (${size('sales.json')})

Записано в ${out.replace(root + '/', '')} — эта папка не попадает в git.
Дальше: node scripts/build-mine.mjs — и всё это окажется в программе.`);
