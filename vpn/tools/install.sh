#!/usr/bin/env bash
# Установка VPN-сервера: Xray (VLESS + Reality) в Docker + гео-фильтр по странам.
# Проверено на Ubuntu 22.04/24.04 и Debian 12. Запускать от root.
#
#   sudo ./tools/install.sh --host 203.0.113.10 --countries ru,by
set -euo pipefail

VPN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$VPN_DIR"

HOST=""
PORT=443
COUNTRIES="ru"
SNI="www.microsoft.com"
SKIP_GEOFW=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)       HOST="$2"; shift 2 ;;
    --port)       PORT="$2"; shift 2 ;;
    --countries)  COUNTRIES="$2"; shift 2 ;;
    --sni)        SNI="$2"; shift 2 ;;
    --no-geofw)   SKIP_GEOFW=1; shift ;;
    -h|--help)    sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Неизвестный аргумент: $1" >&2; exit 1 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "❌ запускать от root (sudo)" >&2; exit 1; }

if [[ -z "$HOST" ]]; then
  HOST="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
  [[ -n "$HOST" ]] || { echo "❌ не определить внешний IP, укажите --host" >&2; exit 1; }
  echo "🌐 внешний адрес: $HOST"
fi

# --- Docker ---------------------------------------------------------------
if ! command -v docker >/dev/null; then
  echo "📦 ставлю Docker..."
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { echo "❌ нужен docker compose v2" >&2; exit 1; }

# --- Проверка сайта-маскировки -------------------------------------------
echo "🔍 проверяю $SNI на TLS 1.3 + HTTP/2..."
if ! curl -fsS --max-time 10 --tlsv1.3 --http2 -o /dev/null "https://$SNI"; then
  echo "⚠️  $SNI не ответил по TLS 1.3 + HTTP/2 — маскировка может не сработать."
  echo "   Подберите другой сайт и переустановите с --sni."
fi

# --- Ключи Reality --------------------------------------------------------
echo "🔑 генерирую ключи Reality..."
docker pull -q ghcr.io/xtls/xray-core:latest
KEYS="$(docker run --rm ghcr.io/xtls/xray-core:latest x25519)"
PRIVATE_KEY="$(echo "$KEYS" | grep -iE 'private' | awk -F': *' '{print $2}' | tr -d '\r')"
PUBLIC_KEY="$(echo "$KEYS"  | grep -iE 'public|password' | awk -F': *' '{print $2}' | tr -d '\r')"
[[ -n "$PRIVATE_KEY" && -n "$PUBLIC_KEY" ]] || { echo "❌ не разобрать вывод x25519:"; echo "$KEYS"; exit 1; }
SHORT_ID="$(openssl rand -hex 8)"

# --- .env -----------------------------------------------------------------
cat > .env <<EOF
VPN_HOST=$HOST
VPN_PORT=$PORT
REALITY_PRIVATE_KEY=$PRIVATE_KEY
REALITY_PUBLIC_KEY=$PUBLIC_KEY
REALITY_SNI=$SNI
REALITY_DEST=$SNI:443
REALITY_SHORT_IDS=$SHORT_ID
VPN_ALLOWED_COUNTRIES=$COUNTRIES
VPN_PROFILE=ru
VPN_RELOAD_CMD=$VPN_DIR/tools/apply.sh
EOF
chmod 600 .env
echo "✅ .env записан (права 600 — там приватный ключ)"

# --- Первый пользователь --------------------------------------------------
mkdir -p data
if [[ ! -s data/users.json ]]; then
  FIRST_UUID="$(cat /proc/sys/kernel/random/uuid)"
  # Токен подписки: тот же алфавит, что у secrets.token_urlsafe в боте.
  SUB_TOKEN="$(openssl rand -base64 16 | tr '+/' '-_' | tr -d '=')"
  cat > data/users.json <<EOF
{"users": [{"uuid": "$FIRST_UUID", "sub_token": "$SUB_TOKEN", "label": "admin", "tg_id": null, "created_at": null}]}
EOF
fi

# --- Запуск ---------------------------------------------------------------
set -a; . ./.env; set +a
python3 tools/gen_server_config.py -o config/xray-server.json
docker compose up -d
sleep 2
docker compose ps

# --- Гео-фильтр -----------------------------------------------------------
if [[ $SKIP_GEOFW -eq 0 ]]; then
  command -v nft >/dev/null || { apt-get update -qq && apt-get install -y -qq nftables; }
  ./tools/geofw.sh --countries "$COUNTRIES" --port "$PORT"
fi

# --- Ссылка для клиента ---------------------------------------------------
UUID="$(python3 -c "import json;print(json.load(open('data/users.json'))['users'][0]['uuid'])")"
LINK="vless://$UUID@$HOST:$PORT?type=tcp&security=reality&sni=$SNI&fp=chrome&pbk=$PUBLIC_KEY&sid=$SHORT_ID&flow=xtls-rprx-vision#vpn-admin"

cat <<EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Сервер поднят.

Ссылка для клиента (v2rayNG / Hiddify / Streisand / NekoBox):

$LINK

Конфиг клиента с whitelist-маршрутизацией:
  python3 tools/gen_client_config.py --profile ru --link "$LINK" -o out/

Для Happ — routing-профиль одной ссылкой:
  python3 tools/gen_client_config.py --profile ru --format happ

Дальше:
  • Ключи ботом:  VPN_ADMINS=<ваш tg id> в окружении бота
    Тогда /vpn_new пришлёт ссылку подписки и QR для Happ
  • Добавить ключ вручную: правьте data/users.json → ./tools/apply.sh
  • Снять гео-фильтр:      ./tools/geofw.sh --flush
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
