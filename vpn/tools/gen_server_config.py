#!/usr/bin/env python3
"""Сборка серверного конфига Xray (VLESS + Reality) из списка пользователей.

Список пользователей — vpn/data/users.json, его же ведёт Telegram-бот
(teabot/services/vpn.py). Параметры сервера читаются из окружения (vpn/.env).

    python3 vpn/tools/gen_server_config.py -o vpn/config/xray-server.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
USERS_PATH = ROOT / "data" / "users.json"


def load_users(path: Path) -> list[dict]:
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return [u for u in data.get("users", []) if not u.get("revoked")]


def server_config(users: list[dict], *, port: int, private_key: str, sni: str,
                  short_ids: list[str], dest: str, flow: str = "xtls-rprx-vision",
                  log_level: str = "warning") -> dict:
    clients = [{
        "id": u["uuid"],
        "email": u.get("label") or u["uuid"][:8],
        "flow": flow,
    } for u in users]

    return {
        "log": {"loglevel": log_level},
        "inbounds": [{
            "tag": "vless-reality",
            "listen": "0.0.0.0",
            "port": port,
            "protocol": "vless",
            "settings": {"clients": clients, "decryption": "none"},
            "streamSettings": {
                "network": "tcp",
                "security": "reality",
                "realitySettings": {
                    # Маскировка: соединение выглядит как обычный TLS к dest.
                    "show": False,
                    "dest": dest,
                    "xver": 0,
                    "serverNames": [sni],
                    "privateKey": private_key,
                    "shortIds": short_ids,
                },
            },
            "sniffing": {"enabled": True, "destOverride": ["http", "tls", "quic"]},
        }],
        "outbounds": [
            {"tag": "direct", "protocol": "freedom"},
            {"tag": "block", "protocol": "blackhole"},
        ],
        "routing": {
            "domainStrategy": "IPIfNonMatch",
            "rules": [
                # Не даём использовать сервер как прокси во внутреннюю сеть
                # и как торрент-выходную ноду (быстрый путь к abuse-жалобам).
                {"type": "field", "ip": ["geoip:private"], "outboundTag": "block"},
                {"type": "field", "protocol": ["bittorrent"], "outboundTag": "block"},
            ],
        },
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Генератор серверного конфига Xray")
    p.add_argument("--users", default=str(USERS_PATH), help="путь к users.json")
    p.add_argument("-o", "--out", help="куда записать конфиг (по умолчанию stdout)")
    p.add_argument("--port", type=int, default=int(os.getenv("VPN_PORT", "443")))
    p.add_argument("--private-key", default=os.getenv("REALITY_PRIVATE_KEY", ""))
    p.add_argument("--sni", default=os.getenv("REALITY_SNI", "www.microsoft.com"))
    p.add_argument("--short-ids", default=os.getenv("REALITY_SHORT_IDS", ""))
    p.add_argument("--dest", default=os.getenv("REALITY_DEST", ""))
    args = p.parse_args(argv)

    if not args.private_key:
        raise SystemExit("REALITY_PRIVATE_KEY не задан (см. vpn/.env.example)")

    short_ids = [s.strip() for s in args.short_ids.split(",") if s.strip()] or [""]
    dest = args.dest or f"{args.sni}:443"

    users = load_users(Path(args.users))
    cfg = server_config(users, port=args.port, private_key=args.private_key,
                        sni=args.sni, short_ids=short_ids, dest=dest)
    text = json.dumps(cfg, ensure_ascii=False, indent=2)

    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"✅ {args.out}: {len(users)} пользователь(ей)")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
