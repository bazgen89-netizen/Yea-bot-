#!/usr/bin/env bash
# Сообщает сессии, какие доступы к waystea.ru уже выданы через переменные
# окружения, а каких не хватает. Значения не печатаются — только наличие.
#
# Контейнер эфемерный: единственное место, которое переживает его пересоздание, —
# переменные окружения Claude Code (окружение Default → Environment variables).
# Всё, что выдано в чате, живёт ровно одну сессию.
set -euo pipefail

declare -a HAVE=() MISS=()

check() { # имя_переменной   описание   где взять
  if [ -n "${!1:-}" ]; then HAVE+=("$1 — $2"); else MISS+=("$1 — $2. $3"); fi
}

check WAYSTEA_WP_APP_PASSWORD \
  "правки сайта через REST API WordPress (сниппеты, товары, SEO)" \
  "WP-админка → Пользователи → профиль → Пароли приложений"

check YANDEX_OAUTH_TOKEN \
  "Яндекс.Вебмастер (поисковые запросы) и Метрика (поведение), если у токена есть оба права" \
  "oauth.yandex.ru → приложение → права «Вебмастер» и «Метрика» → перевыпустить токен"

check YANDEX_METRIKA_COUNTER \
  "номер счётчика Метрики" \
  "видно в интерфейсе Метрики; для waystea.ru это 84628927"

[ ${#HAVE[@]} -eq 0 ] && [ ${#MISS[@]} -eq 0 ] && exit 0

python3 - "$(printf '%s\n' "${HAVE[@]:-}")" "$(printf '%s\n' "${MISS[@]:-}")" <<'PY'
import json, sys
have = [x for x in sys.argv[1].splitlines() if x.strip()]
miss = [x for x in sys.argv[2].splitlines() if x.strip()]
lines = ["Доступы к waystea.ru из переменных окружения:"]
if have:
    lines.append("\nВыданы (бери из окружения, в чате не спрашивай):")
    lines += [f"  - {h}" for h in have]
if miss:
    lines.append("\nНе выданы:")
    lines += [f"  - {m}" for m in miss]
    lines.append(
        "\nЭто нормально: ключи хранятся НЕ в переменных окружения, а в Google Drive "
        "владельца — документ «WAYSTEA — доступы для Claude (не удалять)», "
        "id 14Q_ET2defFjLum96hUNVAeWsbnSDoQ3yfB0lExQr760. Прочитай его через коннектор "
        "Google Drive ДО того, как спрашивать ключи у владельца: он уже отвечал на этот "
        "вопрос несколько раз. Получив новый ключ — перезапиши документ."
    )
print(json.dumps({"hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "\n".join(lines),
}}, ensure_ascii=False))
PY
