#!/bin/sh
# Восстановление базы из копии:
#   ./scripts/restore.sh backups/warehouse-2026-08-03_04-00.dump
#
# ВНИМАНИЕ: содержимое базы будет заменено копией.
set -eu

if [ $# -ne 1 ]; then
  echo "Укажите файл копии: ./scripts/restore.sh backups/warehouse-....dump" >&2
  exit 1
fi

DIR="$(cd "$(dirname "$0")/.." && pwd)"

printf 'Заменить текущие данные копией %s? [y/N] ' "$1"
read -r answer
[ "$answer" = "y" ] || { echo 'Отменено'; exit 1; }

docker compose -f "$DIR/docker-compose.yml" exec -T db \
  pg_restore -U warehouse --dbname=warehouse --clean --if-exists < "$1"

echo 'Восстановлено'
