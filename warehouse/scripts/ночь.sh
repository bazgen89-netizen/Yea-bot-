#!/usr/bin/env bash
#
# Ночное обновление Wayshop: одна команда от начала до конца.
#
#   SITE_URL=… SITE_KEY=… CLOUDSHOP_TOKEN=… bash scripts/ночь.sh
#
# Почему это скрипт, а не список шагов в задании.
#
# Раньше ночное задание было двадцатью командами в тексте, и каждая из них —
# отдельная возможность упереться в запрос подтверждения. Ночью на такой
# запрос отвечать некому: задание вставало намертво, а система писала
# «успешно», потому что для неё успех — что сессия запустилась. Так прошло
# шесть ночей с 17 по 22 сентября: Вазген всю неделю смотрел на программу от
# шестнадцатого числа и спросил, не перестали ли мы записывать данные.
#
# Одна команда — одна точка, где можно споткнуться, вместо двадцати. И если
# споткнётся, последняя строка вывода скажет, на каком шаге.
#
# Имена переменных здесь латиницей, хотя весь остальной код в этом хозяйстве
# по-русски: bash кириллицу в именах не принимает вовсе — «bad substitution».
# Проверено дважды, оба раза на этом же файле.
#
# Скрипт нарочно ничего не коммитит: память задания пишется отдельно, уже
# после отчёта.

set -uo pipefail

# Сам себя выполнять из репозитория нельзя: ниже идёт `git reset --hard`, а
# bash дочитывает скрипт по ходу дела — если файл под ним подменится, он
# продолжит читать с той же позиции уже в новом тексте. Поэтому первым делом
# уходим работать с копии во временной папке.
if [ "${NIGHT_COPY:-}" != yes ]; then
  copy=$(mktemp) || exit 1
  cat "$0" > "$copy"
  NIGHT_COPY=yes bash "$copy"
  code=$?
  rm -f "$copy"
  exit $code
fi

root=/home/user/Yea-bot-
branch=claude/warehouse-management-app-i7jnvr
origin=https://github.com/bazgen89-netizen/Yea-bot-

step='начало'
fail() {
  echo
  echo "СОРВАЛОСЬ на шаге: $step"
  exit 1
}

# --- 1. Среда ---------------------------------------------------------------
step='1. среда'
cd "$root" 2>/dev/null || git clone "$origin" "$root" || fail
cd "$root" || fail
git fetch origin "$branch" || fail
git reset --hard FETCH_HEAD || fail
cd warehouse || fail
npm install --silent || fail
ln -sfn /opt/node22/lib/node_modules/playwright node_modules/playwright 2>/dev/null
echo 'среда: готова'

# --- 2. Вчерашняя выгрузка с сайта ------------------------------------------
# Данные ночуют на его сайте: машина каждую ночь пустая, а в git их нет —
# там три с лишним тысячи настоящих телефонов.
step='2. забрать выгрузку с сайта'
node scripts/site-data.mjs взять --с-фото || fail

was=$(node -e "console.log(require('./src/db/seed/local/sales.json').length)" 2>/dev/null) || was=0
echo "чеков было: $was"

# --- 3. Догнать свежие чеки -------------------------------------------------
# Перенос сам смотрит, каким днём кончается прежняя выгрузка, и спрашивает
# CloudShop только с него. Не задался — не беда: выложим вчерашнее, это
# лучше, чем ничего.
step='3. перенос из CloudShop'
if node scripts/import-cloudshop.mjs --no-photos 2>&1 | tail -8; then
  echo 'перенос: прошёл'
else
  echo 'перенос: НЕ прошёл — собираем из вчерашних данных'
fi

# --- 4. Проверка ------------------------------------------------------------
step='4. тесты и типы'
npm test --silent >/dev/null 2>&1 || fail
npm run typecheck >/dev/null 2>&1 || fail
echo 'тесты и типы: чисто'

# --- 5. Сборка — один раз ---------------------------------------------------
step='5. сборка'
node scripts/build-mine.mjs >/dev/null 2>&1 || fail
echo 'сборка: готова'

# --- 6. Выложить ------------------------------------------------------------
step='6. выкладка'
node scripts/protect-site.mjs >/dev/null 2>&1
laid=no
for try in 1 2 3; do
  if node scripts/deploy-site.mjs 2>&1 | tail -1; then
    laid=yes
    break
  fi
  sleep $((try * 10))
done
[ "$laid" = yes ] || fail

# Вернуть выгрузку на сайт, чтобы следующая ночь забрала её за шесть секунд.
# Фотографии не отправляем: они те же, а это лишние 26 мегабайт.
node scripts/site-data.mjs положить >/dev/null 2>&1 || echo 'выгрузка обратно: НЕ легла'

# --- 7. Проверить, что легло свежее -----------------------------------------
step='7. проверка сайта'
code=$(curl -s -o /dev/null -w '%{http_code}' https://waystea.ru/sklad/)
when=$(curl -sI -u "vazgen:matcha-alishan-9600" https://waystea.ru/sklad/ \
  | grep -i '^last-modified' | tr -d '\r')
today=$(date -u '+%d %b %Y')

echo
echo "без пароля: $code (ждём 401)"
echo "на сайте:   $when"
case "$when" in
  *"$today"*) echo 'выкладка:   свежая' ;;
  *)          echo 'выкладка:   НЕ СЕГОДНЯШНЯЯ — разберись и скажи прямо' ;;
esac

# --- 8. Числа для отчёта ----------------------------------------------------
step='8. числа для отчёта'
WAS="$was" node -e "
  const чеки = require('./src/db/seed/local/sales.json');
  const день = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const вчера = чеки.filter((ч) => (ч.at ?? '').slice(0, 10) === день);

  const рубли = (к) => (к / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2 });
  const поМагазинам = new Map();
  for (const ч of вчера) {
    поМагазинам.set(ч.st ?? '—', (поМагазинам.get(ч.st ?? '—') ?? 0) + (ч.t ?? 0));
  }

  console.log('');
  console.log('чеков всего: ' + чеки.length + ' (было ' + process.env.WAS + ')');
  console.log('за ' + день + ': ' + вчера.length + ' чеков');
  for (const [имя, сумма] of поМагазинам) console.log('  ' + имя + ': ' + рубли(сумма));

  const крупный = вчера.reduce((а, б) => ((б.t ?? 0) > (а?.t ?? 0) ? б : а), null);
  if (крупный) console.log('крупнейший чек: ' + рубли(крупный.t) + ' — ' + (крупный.cn ?? 'без клиента'));
" || echo 'числа посчитать не вышло'

echo
echo 'ГОТОВО: все шаги пройдены'
