#!/usr/bin/env python3
"""Агент рабочей сети: кто сейчас подключён к Wi-Fi магазина.

Запускается на точке — на любом компьютере или мини-ПК в той же сети
(бот живёт в облаке и за роутер заглянуть не может). Раз в несколько
минут собирает список устройств и отправляет его боту; бот сверяет с
реестром и пишет в чат, если появилось что-то новое.

    export WIFI_AGENT_TOKEN=...            # тот же, что у бота
    export WIFI_BRANCH=gagarina            # gagarina | gastromarket | cheryomushki
    export WIFI_ENDPOINT=https://ваш-бот/security/wifi
    python3 scripts/wifi_agent.py          # один прогон
    python3 scripts/wifi_agent.py --watch  # каждые 5 минут

Как собирается список: агент опрашивает соседей по сети (ARP-таблица
системы, при необходимости — быстрый пинг по диапазону, чтобы таблица
заполнилась). Пароли и трафик он не трогает — только «кто в сети».
"""
import json
import os
import platform
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

INTERVAL = int(os.getenv("WIFI_INTERVAL", "300"))
PING_TIMEOUT = "1"

ARP_LINE = re.compile(
    r"(?P<ip>\d+\.\d+\.\d+\.\d+).*?(?P<mac>(?:[0-9a-fA-F]{1,2}[:-]){5}[0-9a-fA-F]{1,2})"
)


def env(name: str, default: str = "") -> str:
    value = os.getenv(name, default).strip()
    if not value:
        sys.exit(f"❌ Не задана переменная {name}")
    return value


def local_prefix() -> str:
    """Адрес сети вида 192.168.1. — по адресу самого агента."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))  # соединение не устанавливается, адрес локальный
        ip = sock.getsockname()[0]
    finally:
        sock.close()
    return ip.rsplit(".", 1)[0] + "."


def ping(address: str) -> None:
    flag = "-n" if platform.system() == "Windows" else "-c"
    wait = "-w" if platform.system() == "Windows" else "-W"
    subprocess.run(["ping", flag, "1", wait, PING_TIMEOUT, address],
                   capture_output=True, timeout=5)


def wake_arp_table(prefix: str) -> None:
    """Пингует диапазон, чтобы в ARP-таблице оказались все соседи."""
    with ThreadPoolExecutor(max_workers=64) as pool:
        pool.map(ping, [f"{prefix}{i}" for i in range(1, 255)])


def read_arp() -> list:
    try:
        out = subprocess.run(["arp", "-a"], capture_output=True, text=True,
                             timeout=20).stdout
    except (OSError, subprocess.SubprocessError) as e:
        sys.exit(f"❌ Не удалось прочитать таблицу соседей: {e}")

    devices, seen = [], set()
    for line in out.splitlines():
        match = ARP_LINE.search(line)
        if not match:
            continue
        mac = match.group("mac").lower().replace("-", ":")
        mac = ":".join(part.zfill(2) for part in mac.split(":"))
        if mac in seen or mac.startswith("ff:ff") or mac == "00:00:00:00:00:00":
            continue
        seen.add(mac)
        name = ""
        if "(" in line and ")" in line and not line.strip().startswith("?"):
            name = line.split("(")[0].strip()
        devices.append({"mac": mac, "ip": match.group("ip"), "name": name})
    return devices


def collect() -> list:
    prefix = local_prefix()
    wake_arp_table(prefix)
    return read_arp()


def send(devices: list) -> dict:
    payload = json.dumps({
        "branch": env("WIFI_BRANCH"),
        "devices": devices,
    }).encode()
    request = urllib.request.Request(
        env("WIFI_ENDPOINT"), data=payload,
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {env('WIFI_AGENT_TOKEN')}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            return json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        sys.exit(f"❌ Бот ответил {e.code}: {e.read().decode(errors='replace')[:200]}")
    except urllib.error.URLError as e:
        sys.exit(f"❌ Бот недоступен: {e.reason}")


def run_once() -> None:
    devices = collect()
    answer = send(devices)
    print(f"{time.strftime('%H:%M:%S')} — в сети {len(devices)}, "
          f"новых {answer.get('new', 0)}, вернулись {answer.get('returned', 0)}")


def main() -> None:
    watch = "--watch" in sys.argv
    while True:
        run_once()
        if not watch:
            return
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
