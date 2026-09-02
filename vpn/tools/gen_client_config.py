#!/usr/bin/env python3
"""Генератор whitelist-конфигов клиента (split tunnel).

Через VPN идут только домены из выбранных групп сервисов, остальной трафик —
напрямую. Это и быстрее, и незаметнее для DPI: локальные банки/госуслуги
продолжают видеть местный IP.

Примеры:
    python3 vpn/tools/gen_client_config.py --profile ru --link "vless://..." -o out/
    python3 vpn/tools/gen_client_config.py --profile ir --groups ai,dev --format singbox
    python3 vpn/tools/gen_client_config.py --profile ru --format domains
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
SERVICES_PATH = ROOT / "data" / "services.json"
PROFILES_DIR = ROOT / "config" / "profiles"

SINGBOX_RULESET_BASE = "https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set"

PROXY_TAG = "proxy"
DIRECT_TAG = "direct"
BLOCK_TAG = "block"


# --------------------------------------------------------------------------- #
# Загрузка данных
# --------------------------------------------------------------------------- #

def load_services(path: Path = SERVICES_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))["groups"]


def load_profile(name: str, profiles_dir: Path = PROFILES_DIR) -> dict:
    path = profiles_dir / f"{name}.json"
    if not path.exists():
        available = ", ".join(sorted(p.stem for p in profiles_dir.glob("*.json")))
        raise SystemExit(f"Профиль '{name}' не найден. Доступные: {available}")
    return json.loads(path.read_text(encoding="utf-8"))


def collect_domains(profile: dict, services: dict, groups: list[str] | None = None,
                    with_geosite: bool = False) -> tuple[list[str], list[str]]:
    """Возвращает (домены для проксирования, теги geosite для проксирования)."""
    wanted = groups if groups is not None else profile.get("groups", [])
    domains: list[str] = []
    geosite: list[str] = []
    for name in wanted:
        group = services.get(name)
        if group is None:
            raise SystemExit(f"Неизвестная группа сервисов: {name}")
        domains.extend(group.get("domains", []))
        if with_geosite:
            geosite.extend(group.get("geosite", []))
    return dedup(domains), dedup(geosite)


def dedup(items: list[str]) -> list[str]:
    """Уникальные значения с сохранением порядка."""
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


# --------------------------------------------------------------------------- #
# Разбор vless://-ссылки
# --------------------------------------------------------------------------- #

def parse_vless_link(link: str) -> dict:
    """Разбирает vless://uuid@host:port?params#label в словарь параметров."""
    url = urlparse(link.strip())
    if url.scheme != "vless":
        raise SystemExit("Ожидается ссылка вида vless://...")
    if not url.hostname or not url.port or not url.username:
        raise SystemExit("В ссылке не хватает uuid, хоста или порта")
    q = {k: v[0] for k, v in parse_qs(url.query).items()}
    return {
        "uuid": url.username,
        "host": url.hostname,
        "port": url.port,
        "label": unquote(url.fragment) or "vpn",
        "sni": q.get("sni", url.hostname),
        "public_key": q.get("pbk", ""),
        "short_id": q.get("sid", ""),
        "flow": q.get("flow", "xtls-rprx-vision"),
        "fingerprint": q.get("fp", "chrome"),
        "security": q.get("security", "reality"),
    }


# --------------------------------------------------------------------------- #
# Xray
# --------------------------------------------------------------------------- #

def xray_outbounds(server: dict | None) -> list[dict]:
    outbounds: list[dict] = []
    if server:
        outbounds.append({
            "tag": PROXY_TAG,
            "protocol": "vless",
            "settings": {"vnext": [{
                "address": server["host"],
                "port": server["port"],
                "users": [{
                    "id": server["uuid"],
                    "encryption": "none",
                    "flow": server["flow"],
                }],
            }]},
            "streamSettings": {
                "network": "tcp",
                "security": server["security"],
                "realitySettings": {
                    "serverName": server["sni"],
                    "publicKey": server["public_key"],
                    "shortId": server["short_id"],
                    "fingerprint": server["fingerprint"],
                },
            },
        })
    outbounds.append({"tag": DIRECT_TAG, "protocol": "freedom"})
    outbounds.append({"tag": BLOCK_TAG, "protocol": "blackhole"})
    return outbounds


def xray_config(profile: dict, domains: list[str], geosite: list[str],
                server: dict | None, socks_port: int, http_port: int) -> dict:
    direct = profile.get("direct", {})
    proxy_domains = [f"domain:{d}" for d in domains] + [f"geosite:{g}" for g in geosite]
    direct_domains = list(direct.get("domains", [])) + \
        [f"geosite:{g}" for g in direct.get("geosite", [])]
    direct_ips = [f"geoip:{c}" for c in direct.get("geoip", ["private"])]

    rules: list[dict] = [
        # Служебное: сначала блокируем то, что не должно утекать в туннель.
        {"type": "field", "protocol": ["bittorrent"], "outboundTag": DIRECT_TAG},
    ]
    if proxy_domains:
        # Whitelist: только эти домены идут через VPN.
        rules.append({"type": "field", "domain": proxy_domains, "outboundTag": PROXY_TAG})
    if direct_domains:
        rules.append({"type": "field", "domain": direct_domains, "outboundTag": DIRECT_TAG})
    rules.append({"type": "field", "ip": direct_ips, "outboundTag": DIRECT_TAG})
    # Всё, что не попало в whitelist, — напрямую.
    rules.append({"type": "field", "network": "tcp,udp", "outboundTag": DIRECT_TAG})

    return {
        "log": {"loglevel": "warning"},
        "dns": {
            "servers": [
                # Домены из whitelist резолвим через удалённый DNS, чтобы обойти
                # DNS-подмену провайдера; остальное — местным резолвером.
                {"address": "https://1.1.1.1/dns-query", "domains": proxy_domains or ["domain:example.invalid"]},
                {"address": "localhost"},
            ],
            "queryStrategy": "UseIPv4",
        },
        "inbounds": [
            {
                "tag": "socks-in",
                "listen": "127.0.0.1",
                "port": socks_port,
                "protocol": "socks",
                "settings": {"udp": True},
                "sniffing": {"enabled": True, "destOverride": ["http", "tls", "quic"]},
            },
            {
                "tag": "http-in",
                "listen": "127.0.0.1",
                "port": http_port,
                "protocol": "http",
                "sniffing": {"enabled": True, "destOverride": ["http", "tls"]},
            },
        ],
        "outbounds": xray_outbounds(server),
        "routing": {"domainStrategy": "IPIfNonMatch", "rules": rules},
    }


# --------------------------------------------------------------------------- #
# sing-box (Hiddify, NekoBox, sing-box CLI)
# --------------------------------------------------------------------------- #

def singbox_config(profile: dict, domains: list[str], geosite: list[str],
                   server: dict | None, socks_port: int) -> dict:
    direct = profile.get("direct", {})
    outbounds: list[dict] = []
    if server:
        outbounds.append({
            "type": "vless",
            "tag": PROXY_TAG,
            "server": server["host"],
            "server_port": server["port"],
            "uuid": server["uuid"],
            "flow": server["flow"],
            "tls": {
                "enabled": True,
                "server_name": server["sni"],
                "utls": {"enabled": True, "fingerprint": server["fingerprint"]},
                "reality": {
                    "enabled": True,
                    "public_key": server["public_key"],
                    "short_id": server["short_id"],
                },
            },
        })
    outbounds.append({"type": "direct", "tag": DIRECT_TAG})
    outbounds.append({"type": "block", "tag": BLOCK_TAG})

    rules: list[dict] = [{"ip_is_private": True, "outbound": DIRECT_TAG}]
    if domains or geosite:
        rule = {"outbound": PROXY_TAG if server else DIRECT_TAG}
        if domains:
            rule["domain_suffix"] = domains
        if geosite:
            rule["rule_set"] = [f"geosite-{g}" for g in geosite]
        rules.append(rule)
    direct_suffixes = [d.split(":", 1)[1] for d in direct.get("domains", []) if d.startswith("domain:")]
    if direct_suffixes:
        rules.append({"domain_suffix": direct_suffixes, "outbound": DIRECT_TAG})

    route: dict = {
        "rules": rules,
        "final": DIRECT_TAG,
        "auto_detect_interface": True,
    }
    if geosite:
        # sing-box 1.8+ подтягивает правила по сети; без этих описаний
        # ссылки rule_set в правилах не разрешатся.
        route["rule_set"] = [{
            "type": "remote",
            "tag": f"geosite-{g}",
            "format": "binary",
            "url": f"{SINGBOX_RULESET_BASE}/geosite-{g}.srs",
            "download_detour": PROXY_TAG if server else DIRECT_TAG,
        } for g in geosite]

    return {
        "log": {"level": "warn"},
        "inbounds": [{
            "type": "mixed",
            "tag": "mixed-in",
            "listen": "127.0.0.1",
            "listen_port": socks_port,
            "sniff": True,
        }],
        "outbounds": outbounds,
        "route": route,
    }


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def build(args) -> dict[str, str]:
    """Возвращает {имя файла: содержимое} для выбранного формата."""
    services = load_services()
    profile = load_profile(args.profile)
    groups = [g.strip() for g in args.groups.split(",")] if args.groups else None
    domains, geosite = collect_domains(profile, services, groups, args.with_geosite)
    server = parse_vless_link(args.link) if args.link else None

    out: dict[str, str] = {}
    if args.format in ("xray", "all"):
        cfg = xray_config(profile, domains, geosite, server, args.socks_port, args.http_port)
        out[f"xray-client-{args.profile}.json"] = json.dumps(cfg, ensure_ascii=False, indent=2)
    if args.format in ("singbox", "all"):
        cfg = singbox_config(profile, domains, geosite, server, args.socks_port)
        out[f"singbox-client-{args.profile}.json"] = json.dumps(cfg, ensure_ascii=False, indent=2)
    if args.format in ("domains", "all"):
        out[f"proxy-domains-{args.profile}.txt"] = "\n".join(domains) + "\n"
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Генератор whitelist-конфигов VPN-клиента")
    p.add_argument("--profile", default="ru", help="страновой профиль (ru, ir, by, cn, global)")
    p.add_argument("--groups", help="список групп через запятую (по умолчанию — из профиля)")
    p.add_argument("--link", help="vless://-ссылка сервера; без неё генерируется шаблон без outbound")
    p.add_argument("--format", default="all", choices=["xray", "singbox", "domains", "all"])
    p.add_argument("--with-geosite", action="store_true",
                   help="добавить теги geosite:* (нужен geosite.dat, иначе конфиг не загрузится)")
    p.add_argument("--socks-port", type=int, default=10808)
    p.add_argument("--http-port", type=int, default=10809)
    p.add_argument("-o", "--out", help="каталог для файлов; без него — вывод в stdout")
    args = p.parse_args(argv)

    files = build(args)
    if not args.out:
        for name, content in files.items():
            if len(files) > 1:
                print(f"===== {name} =====")
            print(content)
        return 0

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        (out_dir / name).write_text(content, encoding="utf-8")
        print(f"✅ {out_dir / name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
