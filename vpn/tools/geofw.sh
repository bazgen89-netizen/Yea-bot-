#!/usr/bin/env bash
# Гео-фильтр: порт VPN принимает подключения только с IP разрешённых стран.
#
# Зачем: скрывает сервер от массовых сканеров и от зондирования из стран,
# откуда пользователей заведомо нет. Правила касаются ТОЛЬКО порта VPN —
# SSH и остальные сервисы не трогаются, заблокировать себя нельзя.
#
#   sudo ./geofw.sh --countries ru,by,kz --port 443
#   sudo ./geofw.sh --countries ru --port 443 --dry-run
#   sudo ./geofw.sh --flush
#
# Источник списков: ipdeny.com (агрегированные CIDR по странам).
set -euo pipefail

COUNTRIES="${VPN_ALLOWED_COUNTRIES:-ru}"
PORT="${VPN_PORT:-443}"
TABLE="vpn_geofilter"
RULES_FILE="/etc/nftables.d/vpn-geofilter.nft"
CACHE_DIR="/var/cache/vpn-geofw"
IPDENY_V4="https://www.ipdeny.com/ipblocks/data/aggregated"
IPDENY_V6="https://www.ipdeny.com/ipv6/ipaddresses/aggregated"
DRY_RUN=0
FLUSH=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --countries) COUNTRIES="$2"; shift 2 ;;
    --port)      PORT="$2"; shift 2 ;;
    --out)       RULES_FILE="$2"; shift 2 ;;
    --dry-run)   DRY_RUN=1; shift ;;
    --flush)     FLUSH=1; shift ;;
    -h|--help)   sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Неизвестный аргумент: $1" >&2; exit 1 ;;
  esac
done

need() { command -v "$1" >/dev/null || { echo "❌ нужна утилита $1" >&2; exit 1; }; }
need nft
need curl

if [[ $FLUSH -eq 1 ]]; then
  nft delete table inet "$TABLE" 2>/dev/null || true
  rm -f "$RULES_FILE"
  echo "✅ гео-фильтр снят"
  exit 0
fi

mkdir -p "$CACHE_DIR"
IFS=',' read -ra CC <<< "$COUNTRIES"

fetch_zone() {  # $1=url $2=cache-файл
  local url="$1" out="$2"
  if curl -fsSL --retry 3 --retry-delay 2 -o "$out.tmp" "$url"; then
    mv "$out.tmp" "$out"
  elif [[ -s "$out" ]]; then
    echo "⚠️  $url недоступен, использую кэш $out" >&2
  else
    rm -f "$out.tmp"
    return 1
  fi
}

v4_elements=()
v6_elements=()
for cc in "${CC[@]}"; do
  cc="$(echo "$cc" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
  [[ -z "$cc" ]] && continue

  if fetch_zone "$IPDENY_V4/${cc}-aggregated.zone" "$CACHE_DIR/${cc}-v4.zone"; then
    mapfile -t -O "${#v4_elements[@]}" v4_elements < <(grep -E '^[0-9]' "$CACHE_DIR/${cc}-v4.zone")
  else
    echo "❌ не удалось получить IPv4-список для '$cc'" >&2; exit 1
  fi

  if fetch_zone "$IPDENY_V6/${cc}-aggregated.zone" "$CACHE_DIR/${cc}-v6.zone"; then
    mapfile -t -O "${#v6_elements[@]}" v6_elements < <(grep -E '^[0-9a-fA-F]' "$CACHE_DIR/${cc}-v6.zone")
  else
    echo "⚠️  IPv6-список для '$cc' недоступен, пропускаю" >&2
  fi
done

echo "📦 стран: ${#CC[@]}, префиксов IPv4: ${#v4_elements[@]}, IPv6: ${#v6_elements[@]}"

join_by_comma() { local IFS=','; echo "$*"; }

RULES=$(cat <<EOF
table inet $TABLE {
  set allow_v4 {
    type ipv4_addr
    flags interval
    auto-merge
    elements = { $(join_by_comma "${v4_elements[@]}") }
  }
  set allow_v6 {
    type ipv6_addr
    flags interval
    auto-merge
    elements = { $(join_by_comma "${v6_elements[@]:-::1}") }
  }
  chain input {
    type filter hook input priority filter - 5; policy accept;

    # Уже установленные соединения не пересматриваем.
    ct state established,related accept
    iif lo accept

    # Разрешённые страны — на порт VPN.
    tcp dport $PORT ip  saddr @allow_v4 accept
    tcp dport $PORT ip6 saddr @allow_v6 accept
    udp dport $PORT ip  saddr @allow_v4 accept
    udp dport $PORT ip6 saddr @allow_v6 accept

    # Все остальные — как будто порта нет (drop, а не reject: тише для сканеров).
    tcp dport $PORT drop
    udp dport $PORT drop
  }
}
EOF
)

if [[ $DRY_RUN -eq 1 ]]; then
  echo "$RULES"
  exit 0
fi

mkdir -p "$(dirname "$RULES_FILE")"
printf '%s\n' "$RULES" > "$RULES_FILE"
nft delete table inet "$TABLE" 2>/dev/null || true
nft -f "$RULES_FILE"

echo "✅ гео-фильтр применён: порт $PORT открыт только для [$COUNTRIES]"
echo "   правила: $RULES_FILE"
echo "   обновлять списки раз в неделю:"
echo "   echo '0 4 * * 1 root $(readlink -f "$0") --countries $COUNTRIES --port $PORT' > /etc/cron.d/vpn-geofw"
