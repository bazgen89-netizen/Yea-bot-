#!/usr/bin/env bash
# Пересобрать серверный конфиг из users.json и перезапустить Xray.
# Эту команду вызывает бот после выдачи или отзыва ключа (VPN_RELOAD_CMD).
set -euo pipefail

VPN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$VPN_DIR"

[[ -f .env ]] && set -a && . ./.env && set +a

python3 tools/gen_server_config.py -o config/xray-server.json

# Xray не перечитывает конфиг на лету — нужен рестарт контейнера.
if docker compose version >/dev/null 2>&1; then
  docker compose restart xray
else
  docker-compose restart xray
fi

echo "✅ конфиг применён"
