#!/usr/bin/env bash
# Напоминает каждой новой сессии о хранилище знаний в knowledge/.
# Вывод — JSON с additionalContext, который попадает в контекст модели.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VAULT="$ROOT/knowledge"

if [ ! -d "$VAULT" ]; then
  exit 0
fi

COUNT=$(find "$VAULT" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')
OPEN="$VAULT/Открытые вопросы.md"
OPEN_HINT=""
[ -f "$OPEN" ] && OPEN_HINT=" Незакрытые задачи перечислены в «Открытые вопросы»."

python3 - "$COUNT" "$OPEN_HINT" <<'PY'
import json, sys
count, hint = sys.argv[1], sys.argv[2]
text = (
    f"В этом репозитории есть база знаний: папка knowledge/ ({count} заметок), "
    "оформленная как хранилище Obsidian со ссылками [[...]]." + hint + "\n\n"
    "Правила работы с ней:\n"
    "1. В начале работы прочитай knowledge/README.md и относящиеся к задаче заметки — "
    "там записаны причины прошлых решений и уже отвергнутые варианты.\n"
    "2. Закончив содержательную работу, допиши заметки: что было сломано, чем оказалась "
    "причина, какие проверки это доказали, что изменено и где лежит правка. "
    "Фиксируй и собственные ошибки — они самое ценное.\n"
    "3. Обнови «Открытые вопросы».\n"
    "4. Закоммить и запушь — контейнер эфемерный, незакоммиченное пропадёт.\n"
    "5. Пароли, ключи и токены в заметки не попадают. Только указание, где они хранятся.\n\n"
    "Готовая процедура — навык /second-brain."
)
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": text,
    }
}, ensure_ascii=False))
PY
