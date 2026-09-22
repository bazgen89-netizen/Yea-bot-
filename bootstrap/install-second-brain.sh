#!/usr/bin/env bash
#
# Ставит второй мозг глобально — для ВСЕХ проектов в этом окружении,
# а не только для репозитория, где лежит скрипт.
#
# Запускать из setup-скрипта окружения Claude Code:
#   curl -fsSL https://raw.githubusercontent.com/bazgen89-netizen/Yea-bot-/main/bootstrap/install-second-brain.sh | bash
#
# Идемпотентен: повторный запуск ничего не ломает.
set -euo pipefail

BRAIN_REPO="${SECOND_BRAIN_REPO:-bazgen89-netizen/Yea-bot-}"
BRAIN_PATH="${SECOND_BRAIN_PATH:-knowledge}"
CLAUDE_DIR="$HOME/.claude"
HOOKS="$CLAUDE_DIR/hooks"

mkdir -p "$HOOKS"

# ── хук старта: рассказывает сессии про мозг ───────────────────────────────
cat > "$HOOKS/second-brain-start.sh" <<HOOK
#!/usr/bin/env bash
set -uo pipefail
PAYLOAD="\$(cat 2>/dev/null || echo '{}')"
SID="\$(printf '%s' "\$PAYLOAD" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("session_id") or "nosid")
except Exception: print("nosid")' 2>/dev/null || echo nosid)"
: > "/tmp/second-brain-\$SID.start" 2>/dev/null || true

python3 <<'PY'
import json
print(json.dumps({"hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": (
        "Второй мозг — база знаний по всем проектам владельца — живёт в репозитории "
        "$BRAIN_REPO, папка $BRAIN_PATH/. Заметки разложены по проектам, формат Obsidian.\\n\\n"
        "Правила, обязательные к исполнению:\\n"
        "1. В начале работы прочитай $BRAIN_PATH/README.md и заметки нужного проекта. "
        "Если репозитория нет в сессии — подключи его (add_repo) или прочитай через GitHub. "
        "Там записаны причины прошлых решений и уже отвергнутые варианты.\\n"
        "2. Закончив содержательную работу, допиши заметки: что было сломано, какая причина "
        "установлена и чем доказана, что изменено и где лежит правка, какие свои ошибки пришлось "
        "чинить. Последнее особенно важно.\\n"
        "3. Работаешь над проектом, которого в базе нет — заведи ему папку и строку в README.\\n"
        "4. Обнови «Открытые вопросы», закоммить и запушь. Контейнер эфемерный.\\n"
        "5. Пароли, ключи и токены в заметки не попадают — только указание, где они хранятся."
    ),
}}, ensure_ascii=False))
PY
HOOK
chmod +x "$HOOKS/second-brain-start.sh"

# ── хук завершения: не отпускает сессию, пока не записано ──────────────────
cat > "$HOOKS/second-brain-stop.sh" <<'HOOK'
#!/usr/bin/env bash
set -uo pipefail
PAYLOAD="$(cat 2>/dev/null || echo '{}')"
SID="$(printf '%s' "$PAYLOAD" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("session_id") or "nosid")
except Exception: print("nosid")' 2>/dev/null || echo nosid)"

START="/tmp/second-brain-$SID.start"
NAGGED="/tmp/second-brain-$SID.nagged"
[ -f "$NAGGED" ] && exit 0
[ -f "$START" ] || exit 0

NOW=$(date +%s); STARTED=$(stat -c %Y "$START" 2>/dev/null || echo "$NOW")
[ $((NOW - STARTED)) -lt 600 ] && exit 0

# Заметки трогали после старта сессии — в любом клоне мозга под текущей папкой?
if find . -path '*/knowledge/*.md' -newer "$START" -print -quit 2>/dev/null | grep -q .; then
  exit 0
fi

: > "$NAGGED"
python3 <<'PY'
import json
print(json.dumps({
    "decision": "block",
    "reason": (
        "Работа этой сессии ещё не записана во второй мозг. Прежде чем закончить: "
        "допиши заметки нужного проекта — что было сломано, какая причина установлена и чем "
        "доказана, что изменено и где лежит правка, какие свои ошибки пришлось чинить. "
        "Обнови «Открытые вопросы», убедись что секретов в тексте нет, закоммить и запушь. "
        "Если записывать нечего — разговор без изменений — скажи это и заканчивай, "
        "повторно хук не сработает."
    ),
}, ensure_ascii=False))
PY
HOOK
chmod +x "$HOOKS/second-brain-stop.sh"

# ── вписываем хуки в ~/.claude/settings.json, не затирая чужие ─────────────
python3 - "$CLAUDE_DIR/settings.json" <<'PY'
import json, os, sys
path = sys.argv[1]
try:
    with open(path, encoding='utf-8') as f:
        cfg = json.load(f)
except Exception:
    cfg = {}

hooks = cfg.setdefault('hooks', {})
wanted = {
    'SessionStart': '"$HOME/.claude/hooks/second-brain-start.sh" 2>/dev/null || true',
    'Stop':         '"$HOME/.claude/hooks/second-brain-stop.sh"',
}
for event, cmd in wanted.items():
    entries = hooks.setdefault(event, [])
    already = any(
        'second-brain' in (h.get('command') or '')
        for entry in entries for h in entry.get('hooks', [])
    )
    if not already:
        entries.append({'hooks': [{'type': 'command', 'command': cmd, 'timeout': 15}]})

os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'w', encoding='utf-8') as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write('\n')
print('готово:', path)
PY

echo "Второй мозг установлен глобально. Репозиторий: $BRAIN_REPO/$BRAIN_PATH"
