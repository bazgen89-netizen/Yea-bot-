#!/usr/bin/env bash
# Переходник для ночного обновления Wayshop.
# Ночная сессия открывается на ветке от main, а программа склада и настоящий
# ночной скрипт живут в ветке claude/warehouse-management-app-i7jnvr.
# Этот файл переключается туда и запускает warehouse/scripts/ночь.sh —
# так ночь не срывается, на какой бы ветке задание ни проснулось.
set -e
cd "$(dirname "$0")/.."
B=claude/warehouse-management-app-i7jnvr
for i in 1 2 3 4; do git fetch -q origin "$B" && break; sleep $((2**i)); done
git checkout -q -B "$B" "origin/$B"
echo "ветка: $B"
cd warehouse
exec bash scripts/ночь.sh "$@"
