#!/usr/bin/env bash
# Не даёт закончить сессию, не записав работу в базу знаний.
# Срабатывает не чаще одного раза за сессию, чтобы не зациклиться.
set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
VAULT="$ROOT/knowledge"
[ -d "$VAULT" ] || exit 0

PAYLOAD="$(cat)"
SID="$(printf '%s' "$PAYLOAD" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("session_id") or "nosid")
except Exception: print("nosid")' 2>/dev/null || echo nosid)"

START="/tmp/second-brain-$SID.start"
NAGGED="/tmp/second-brain-$SID.nagged"

# Уже напоминали в этой сессии — больше не мешаем.
[ -f "$NAGGED" ] && exit 0
# Нет отметки старта — сессия слишком короткая либо хук не отработал.
[ -f "$START" ] || exit 0

# Сессия короче 10 минут — вряд ли было что фиксировать.
NOW=$(date +%s)
STARTED=$(stat -c %Y "$START" 2>/dev/null || echo "$NOW")
[ $((NOW - STARTED)) -lt 600 ] && exit 0

# Заметки трогали после начала сессии? Тогда всё в порядке.
if [ -n "$(find "$VAULT" -name '*.md' -newer "$START" -print -quit 2>/dev/null)" ]; then
  exit 0
fi

: > "$NAGGED"
python3 <<'PY'
import json
print(json.dumps({
    "decision": "block",
    "reason": (
        "Работа этой сессии ещё не записана в базу знаний knowledge/. "
        "Прежде чем закончить: допиши заметки нужного проекта — что было сломано, "
        "какая причина установлена и чем доказана, что изменено и где лежит правка, "
        "какие свои ошибки пришлось чинить. Обнови «Открытые вопросы», "
        "проверь что секретов в тексте нет, закоммить и запушь. "
        "Процедура — навык /second-brain. "
        "Если записывать действительно нечего (разговор без изменений), скажи это и заканчивай — "
        "повторно хук не сработает."
    ),
}, ensure_ascii=False))
PY
