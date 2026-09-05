#!/bin/sh
# Резервная копия базы. Запускать по расписанию на сервере, например
# ежедневно в 4 утра:
#   0 4 * * * cd /путь/к/warehouse-server && ./scripts/backup.sh
#
# Копии складываются в ./backups и хранятся 30 дней.
set -eu

DIR="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y-%m-%d_%H-%M)"

mkdir -p "$DIR/backups"

# pg_dump выполняется внутри контейнера базы: снаружи порт не открыт.
docker compose -f "$DIR/docker-compose.yml" exec -T db \
  pg_dump -U warehouse --format=custom warehouse > "$DIR/backups/warehouse-$STAMP.dump"

# Старые копии удаляются, чтобы диск не кончился незаметно.
find "$DIR/backups" -name 'warehouse-*.dump' -mtime +30 -delete

echo "Копия готова: backups/warehouse-$STAMP.dump"
