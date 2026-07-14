#!/usr/bin/env bash
# Добавляет нового клиента (пира) на уже настроенный WireGuard-сервер.
#
# Использование (на сервере, от root):
#   sudo bash add-client.sh <имя-клиента>
#
# Пример:
#   sudo bash add-client.sh laptop
#
# После выполнения конфиг клиента лежит в /etc/wireguard/clients/<имя>.conf,
# а в терминал выводится QR-код для сканирования мобильным приложением WireGuard.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "Запустите скрипт от root: sudo bash add-client.sh <имя>" >&2
    exit 1
fi

CLIENT_NAME="${1:-}"
if [[ -z "${CLIENT_NAME}" ]]; then
    echo "Использование: sudo bash add-client.sh <имя-клиента>" >&2
    exit 1
fi
if [[ ! "${CLIENT_NAME}" =~ ^[a-zA-Z0-9_-]+$ ]]; then
    echo "Имя клиента может содержать только буквы, цифры, '-' и '_'." >&2
    exit 1
fi

WG_NIC="${WG_NIC:-wg0}"
WG_DIR="/etc/wireguard"
CLIENTS_DIR="${WG_DIR}/clients"
SERVER_CONF="${WG_DIR}/${WG_NIC}.conf"
CLIENT_CONF="${CLIENTS_DIR}/${CLIENT_NAME}.conf"
DNS_SERVERS="${DNS_SERVERS:-1.1.1.1,1.0.0.1}"

if [[ ! -f "${SERVER_CONF}" ]]; then
    echo "Не найден ${SERVER_CONF} — сначала запустите install.sh." >&2
    exit 1
fi
if [[ -f "${CLIENT_CONF}" ]]; then
    echo "Клиент '${CLIENT_NAME}' уже существует: ${CLIENT_CONF}" >&2
    exit 1
fi

mkdir -p "${CLIENTS_DIR}"
chmod 700 "${CLIENTS_DIR}"

SERVER_PUB="$(cat "${WG_DIR}/server_public.key")"
WG_PORT="$(awk -F'= ' '/^ListenPort/{print $2}' "${SERVER_CONF}")"
SERVER_ADDR_CIDR="$(awk -F'= ' '/^Address/{print $2}' "${SERVER_CONF}")"
SUBNET_PREFIX="$(echo "${SERVER_ADDR_CIDR}" | cut -d. -f1-3)"

PUB_IP="${PUB_IP:-}"
if [[ -z "${PUB_IP}" ]]; then
    PUB_IP="$(curl -fsSL4 https://api.ipify.org || curl -fsSL4 https://ifconfig.me)"
fi

# Ищем первый свободный последний октет в подсети (начиная с .2, .1 занят сервером).
USED_OCTETS="$(grep -h '^Address' "${CLIENTS_DIR}"/*.conf 2>/dev/null | sed -E 's/Address = [0-9]+\.[0-9]+\.[0-9]+\.([0-9]+).*/\1/' || true)"
NEXT_OCTET=2
while echo "${USED_OCTETS}" | grep -qx "${NEXT_OCTET}"; do
    NEXT_OCTET=$((NEXT_OCTET + 1))
done
if [[ "${NEXT_OCTET}" -ge 255 ]]; then
    echo "В подсети ${SUBNET_PREFIX}.0/24 больше нет свободных адресов." >&2
    exit 1
fi
CLIENT_IP="${SUBNET_PREFIX}.${NEXT_OCTET}"

echo "==> Генерируем ключи для '${CLIENT_NAME}' (${CLIENT_IP})..."
umask 077
CLIENT_PRIV="$(wg genkey)"
CLIENT_PUB="$(echo "${CLIENT_PRIV}" | wg pubkey)"
CLIENT_PSK="$(wg genpsk)"

cat > "${CLIENT_CONF}" <<EOF
[Interface]
PrivateKey = ${CLIENT_PRIV}
Address = ${CLIENT_IP}/24
DNS = ${DNS_SERVERS}

[Peer]
PublicKey = ${SERVER_PUB}
PresharedKey = ${CLIENT_PSK}
Endpoint = ${PUB_IP}:${WG_PORT}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
EOF
chmod 600 "${CLIENT_CONF}"

echo "==> Добавляем пира на сервере..."
{
    echo ""
    echo "# --- client: ${CLIENT_NAME} ---"
    echo "[Peer]"
    echo "PublicKey = ${CLIENT_PUB}"
    echo "PresharedKey = ${CLIENT_PSK}"
    echo "AllowedIPs = ${CLIENT_IP}/32"
} >> "${SERVER_CONF}"

wg syncconf "${WG_NIC}" <(wg-quick strip "${WG_NIC}") 2>/dev/null || systemctl restart "wg-quick@${WG_NIC}"

echo
echo "==> Клиент '${CLIENT_NAME}' добавлен: ${CLIENT_CONF}"
if command -v qrencode >/dev/null 2>&1; then
    echo "==> QR-код для мобильного приложения WireGuard:"
    qrencode -t ansiutf8 < "${CLIENT_CONF}"
fi
