/**
 * Отчёт страницей рядом с программой — чтобы не писать простынёй в переписку.
 *
 *   node scripts/отчёт.mjs "Заголовок" отчёт.md
 *   … | node scripts/отчёт.mjs "Заголовок"      (текст со стандартного входа)
 *
 * Кладётся по адресу https://waystea.ru/sklad/otchet.html — под тем же
 * паролем, что и сама программа.
 *
 * ## Зачем
 *
 * Вазген попросил: «Всегда, когда проверяешь, даёшь отчёт, дай мне сразу же
 * ссылку… Если нужно, формируй файл, если это немного токенов будет занимать,
 * по этой ссылке я буду открывать файл». То есть длинному разбору место не в
 * переписке, а по ссылке — открыл и посмотрел.
 *
 * Страница нарочно простая: ни картинок, ни скриптов, десяток строк стилей.
 * Её цель — прочесть с телефона, а не выглядеть.
 *
 * ## Доступы
 *
 * SITE_URL и SITE_KEY — те же, что у выкладки, и только из переменных
 * окружения: в переписке ключам не место.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const адрес = process.env.SITE_URL;
const ключ = process.env.SITE_KEY;

const [, , заголовок = 'Отчёт', откуда] = process.argv;

if (!адрес || !ключ) {
  console.error('Не заданы SITE_URL и SITE_KEY.');
  process.exit(1);
}

const текст = откуда ? readFileSync(откуда, 'utf8') : readFileSync(0, 'utf8');

/**
 * Разметка отчёта — та малость, что нужна: заголовки, списки, жирное, код.
 *
 * Полноценный разбор Markdown сюда не тащим: библиотека ради трёх правил
 * весит больше самого отчёта, а незнакомая разметка просто останется текстом,
 * и это не беда.
 */
function вРазметку(исходник) {
  const экран = (с) =>
    с.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const жирное = (с) =>
    экран(с)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>');

  const куски = [];
  let список = false;

  const закрытьСписок = () => {
    if (список) {
      куски.push('</ul>');
      список = false;
    }
  };

  for (const строка of исходник.split('\n')) {
    const голая = строка.trim();

    if (!голая) {
      закрытьСписок();
      continue;
    }

    const пункт = /^[-*•]\s+(.*)$/.exec(голая);
    if (пункт) {
      if (!список) {
        куски.push('<ul>');
        список = true;
      }
      куски.push(`<li>${жирное(пункт[1])}</li>`);
      continue;
    }

    закрытьСписок();

    const шапка = /^(#{1,3})\s+(.*)$/.exec(голая);
    if (шапка) {
      const уровень = шапка[1].length + 1;
      куски.push(`<h${уровень}>${жирное(шапка[2])}</h${уровень}>`);
      continue;
    }

    куски.push(`<p>${жирное(голая)}</p>`);
  }

  закрытьСписок();
  return куски.join('\n');
}

const когда = new Date().toLocaleString('ru-RU', {
  timeZone: 'Europe/Moscow',
  dateStyle: 'long',
  timeStyle: 'short',
});

const страница = `<!doctype html>
<html lang="ru">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${заголовок}</title>
<style>
  body { margin: 0; padding: 20px 18px 60px; background: #F8FAFC; color: #0F172A;
         font: 16px/1.55 -apple-system, "Segoe UI", Roboto, sans-serif; }
  .лист { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 26px 0 8px; }
  h3 { font-size: 16px; margin: 20px 0 6px; }
  .когда { color: #64748B; font-size: 13px; margin: 0 0 22px; }
  ul { padding-left: 22px; margin: 8px 0; }
  li { margin: 4px 0; }
  p { margin: 8px 0; }
  code { background: #E2E8F0; border-radius: 4px; padding: 1px 5px; font-size: 14px; }
  a { color: #1D4ED8; }
  .назад { display: inline-block; margin-top: 30px; padding: 10px 16px;
           background: #2563EB; color: #fff; border-radius: 6px; text-decoration: none; }
  @media (prefers-color-scheme: dark) {
    body { background: #0F172A; color: #F8FAFC; }
    .когда { color: #94A3B8; }
    code { background: #1E293B; }
    a { color: #93C5FD; }
  }
</style>
<div class="лист">
<h1>${заголовок}</h1>
<p class="когда">${когда}</p>
${вРазметку(текст)}
<a class="назад" href="./">Открыть склад</a>
</div>
`;

const тело = Buffer.from(страница, 'utf8');
const ФАЙЛ = 'otchet.html';

async function позвать(что, { body, headers } = {}) {
  const ответ = await fetch(`${адрес}?chto=${что}&fajl=${ФАЙЛ}`, {
    method: 'POST',
    headers: { 'X-Klyuch': ключ, 'Content-Type': 'application/octet-stream', ...headers },
    body,
  });

  if (ответ.status === 404) {
    throw new Error(
      'приёмник не отозвался. Если программа выкладывается, а отчёт нет — ' +
        'значит в priem.php ещё не добавлено имя otchet.html в список МОЖНО.',
    );
  }
  if (!ответ.ok) throw new Error(`хостинг ответил ${ответ.status}`);

  const разбор = JSON.parse(await ответ.text());
  if (!разбор.ok) throw new Error(разбор.беда ?? 'отказ без объяснения');
  return разбор;
}

try {
  await позвать('nachat');
  await позвать('kusok', { body: тело });
  await позвать('zakonchit', {
    headers: {
      'X-Razmer': String(тело.length),
      'X-Summa': createHash('sha256').update(тело).digest('hex'),
    },
  });

  console.log(`Отчёт положен: https://waystea.ru/sklad/${ФАЙЛ} (${тело.length} байт)`);
} catch (беда) {
  console.error(`Не вышло: ${беда.message}`);
  process.exit(1);
}
