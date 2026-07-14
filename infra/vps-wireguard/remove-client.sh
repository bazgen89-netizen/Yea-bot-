#!/usr/bin/env bash
# Отзывает доступ клиента у WireGuard-сервера.
#
# Использование (на сервере, от root):
#   sudo bash remove-client.sh <имя-клиента>

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "Запустите скрипт от root: sudo bash remove-client.sh <имя>" >&2
    exit 1
fi

CLIENT_NAME="${1:-}"
if [[ -z "${CLIENT_NAME}" ]]; then
    echo "Использование: sudo bash remove-client.sh <имя-клиента>" >&2
    exit 1
fi

WG_NIC="${WG_NIC:-wg0}"
WG_DIR="/etc/wireguard"
CLIENTS_DIR="${WG_DIR}/clients"
SERVER_CONF="${WG_DIR}/${WG_NIC}.conf"
CLIENT_CONF="${CLIENTS_DIR}/${CLIENT_NAME}.conf"

if [[ ! -f "${CLIENT_CONF}" ]]; then
    echo "Клиент '${CLIENT_NAME}' не найден: ${CLIENT_CONF}" >&2
    exit 1
fi

echo "==> Удаляем блок пира '${CLIENT_NAME}' из ${SERVER_CONF}..."
# Вырезаем блок между маркером "# --- client: <имя> ---" и следующей пустой строкой/концом файла.
sed -i "/# --- client: ${CLIENT_NAME} ---/,/^$/d" "${SERVER_CONF}"

rm -f "${CLIENT_CONF}"

wg syncconf "${WG_NIC}" <(wg-quick strip "${WG_NIC}") 2>/dev/null || systemctl restart "wg-quick@${WG_NIC}"

echo "==> Клиент '${CLIENT_NAME}' удалён и доступ отозван."
