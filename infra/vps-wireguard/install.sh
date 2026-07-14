#!/usr/bin/env bash
# Установка и настройка WireGuard-сервера на чистом Ubuntu/Debian VPS.
# Поднимает собственный VPN-выход в интернет: сервер + первый клиент.
#
# Использование (на сервере, от root):
#   sudo bash install.sh
#
# Переменные окружения (необязательно, есть значения по умолчанию):
#   WG_NIC        - имя интерфейса WireGuard          (по умолчанию wg0)
#   WG_PORT       - UDP-порт сервера                  (по умолчанию 51820)
#   WG_NET        - подсеть VPN                        (по умолчанию 10.66.66.0/24)
#   WG_SERVER_IP  - адрес сервера внутри VPN            (по умолчанию 10.66.66.1)
#   FIRST_CLIENT  - имя первого клиента                (по умолчанию phone)
#   DNS_SERVERS   - DNS, которые получат клиенты        (по умолчанию 1.1.1.1,1.0.0.1)

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "Запустите скрипт от root: sudo bash install.sh" >&2
    exit 1
fi

WG_NIC="${WG_NIC:-wg0}"
WG_PORT="${WG_PORT:-51820}"
WG_NET="${WG_NET:-10.66.66.0/24}"
WG_SERVER_IP="${WG_SERVER_IP:-10.66.66.1}"
FIRST_CLIENT="${FIRST_CLIENT:-phone}"
DNS_SERVERS="${DNS_SERVERS:-1.1.1.1,1.0.0.1}"
WG_DIR="/etc/wireguard"
CLIENTS_DIR="${WG_DIR}/clients"

if [[ ! -f /etc/os-release ]]; then
    echo "Не удалось определить дистрибутив (нет /etc/os-release)." >&2
    exit 1
fi
# shellcheck disable=SC1091
source /etc/os-release
if [[ "${ID}" != "ubuntu" && "${ID}" != "debian" ]]; then
    echo "Поддерживаются только Ubuntu и Debian (обнаружено: ${ID})." >&2
    exit 1
fi

echo "==> Определяем внешний сетевой интерфейс и IP сервера..."
PUB_NIC="$(ip route get 1.1.1.1 | awk '{for (i=1;i<=NF;i++) if ($i=="dev") print $(i+1)}' | head -n1)"
PUB_IP="$(curl -fsSL4 https://api.ipify.org || curl -fsSL4 https://ifconfig.me)"
if [[ -z "${PUB_NIC}" || -z "${PUB_IP}" ]]; then
    echo "Не удалось определить внешний интерфейс/IP автоматически." >&2
    exit 1
fi
echo "    интерфейс: ${PUB_NIC}, публичный IP: ${PUB_IP}"

echo "==> Устанавливаем пакеты (wireguard, qrencode, ufw)..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq wireguard qrencode ufw curl >/dev/null

mkdir -p "${WG_DIR}" "${CLIENTS_DIR}"
chmod 700 "${WG_DIR}" "${CLIENTS_DIR}"

if [[ ! -f "${WG_DIR}/server_private.key" ]]; then
    echo "==> Генерируем ключи сервера..."
    umask 077
    wg genkey | tee "${WG_DIR}/server_private.key" | wg pubkey > "${WG_DIR}/server_public.key"
fi
SERVER_PRIV="$(cat "${WG_DIR}/server_private.key")"
SERVER_PUB="$(cat "${WG_DIR}/server_public.key")"

echo "==> Включаем IP forwarding..."
cat > /etc/sysctl.d/99-wireguard.conf <<EOF
net.ipv4.ip_forward = 1
EOF
sysctl -p /etc/sysctl.d/99-wireguard.conf >/dev/null

if [[ ! -f "${WG_DIR}/${WG_NIC}.conf" ]]; then
    echo "==> Пишем конфигурацию сервера ${WG_DIR}/${WG_NIC}.conf..."
    cat > "${WG_DIR}/${WG_NIC}.conf" <<EOF
[Interface]
Address = ${WG_SERVER_IP}/24
ListenPort = ${WG_PORT}
PrivateKey = ${SERVER_PRIV}
PostUp = iptables -A FORWARD -i ${WG_NIC} -j ACCEPT; iptables -t nat -A POSTROUTING -o ${PUB_NIC} -j MASQUERADE
PostDown = iptables -D FORWARD -i ${WG_NIC} -j ACCEPT; iptables -t nat -D POSTROUTING -o ${PUB_NIC} -j MASQUERADE
EOF
    chmod 600 "${WG_DIR}/${WG_NIC}.conf"
else
    echo "==> Конфигурация ${WG_DIR}/${WG_NIC}.conf уже существует, не перезаписываю."
fi

echo "==> Открываем порты в файрволе (SSH + WireGuard)..."
ufw allow OpenSSH >/dev/null
ufw allow "${WG_PORT}/udp" >/dev/null
ufw --force enable >/dev/null

echo "==> Запускаем WireGuard..."
systemctl enable "wg-quick@${WG_NIC}" >/dev/null
systemctl restart "wg-quick@${WG_NIC}"

# Первого клиента добавляем через общий скрипт add-client.sh,
# чтобы логика создания пиров жила в одном месте.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WG_NIC="${WG_NIC}" WG_PORT="${WG_PORT}" WG_NET="${WG_NET}" \
    DNS_SERVERS="${DNS_SERVERS}" PUB_IP="${PUB_IP}" \
    bash "${SCRIPT_DIR}/add-client.sh" "${FIRST_CLIENT}"

echo
echo "==> Готово! WireGuard-сервер поднят на ${PUB_IP}:${WG_PORT}"
echo "    Конфиг клиента '${FIRST_CLIENT}': ${CLIENTS_DIR}/${FIRST_CLIENT}.conf"
