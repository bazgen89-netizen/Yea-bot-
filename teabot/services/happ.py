"""Форматы клиента Happ: routing-профиль, deep link и тело подписки.

Опирается на официальную документацию https://www.happ.su/main/dev-docs/
(разделы «Routing» и «App management»). Реализованы только документированные
механизмы:

* ``happ://routing/add/{base64}`` и ``happ://routing/onadd/{base64}`` —
  добавление и активация routing-профиля;
* параметры подписки (``profile-title``, ``profile-update-interval``,
  ``announce``, ``routing``, ...) — и как HTTP-заголовки, и как строки тела
  с префиксом ``#``.

Схемы ``happ://add/...`` для добавления подписки в документации нет, поэтому
подписка отдаётся обычным https-URL — его Happ принимает из буфера обмена или
по QR-коду.
"""
from __future__ import annotations

import base64
import json
import time

# Гео-базы по умолчанию — те же, что использует сам Happ.
GEOIP_URL = "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geoip.dat"
GEOSITE_URL = "https://github.com/Loyalsoldier/v2ray-rules-dat/releases/latest/download/geosite.dat"

# Приватные диапазоны из профиля Happ по умолчанию — всегда мимо туннеля.
PRIVATE_RANGES = [
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "169.254.0.0/16",
    "224.0.0.0/4",
    "255.255.255.255",
]

# Ограничение Happ на длину имени подписки.
PROFILE_TITLE_MAX = 25


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def build_routing_profile(
    name: str,
    proxy_domains: list[str],
    proxy_geosite: list[str] | None = None,
    direct_domains: list[str] | None = None,
    direct_ip: list[str] | None = None,
    block_sites: list[str] | None = None,
    *,
    remote_dns: str = "https://cloudflare-dns.com/dns-query",
    remote_dns_ip: str = "1.1.1.1",
    domestic_dns_ip: str = "8.8.8.8",
    last_updated: int | None = None,
) -> dict:
    """Routing-профиль Happ в режиме белого списка.

    ``GlobalProxy: "false"`` означает, что выход по умолчанию — direct, а в
    туннель уходит только то, что перечислено в ``ProxySites``/``ProxyIp``.
    Это и есть белый список: всё неназванное идёт напрямую.
    """
    proxy_sites = [f"domain:{d}" for d in proxy_domains]
    proxy_sites += [f"geosite:{g}" for g in (proxy_geosite or [])]

    return {
        "Name": name,
        "GlobalProxy": "false",
        "RemoteDNSType": "DoH",
        "RemoteDNSDomain": remote_dns,
        "RemoteDNSIP": remote_dns_ip,
        "DomesticDNSType": "DoU",
        "DomesticDNSDomain": "",
        "DomesticDNSIP": domestic_dns_ip,
        "Geoipurl": GEOIP_URL,
        "Geositeurl": GEOSITE_URL,
        # Меняющаяся метка заставляет Happ перекачать гео-базы после правки
        # правил; без неё клиент может остаться на старых файлах.
        "LastUpdated": str(last_updated if last_updated is not None else int(time.time())),
        "DnsHosts": {"cloudflare-dns.com": remote_dns_ip},
        "DirectSites": list(direct_domains or []),
        "DirectIp": list(direct_ip or []) + PRIVATE_RANGES,
        "ProxySites": proxy_sites,
        "ProxyIp": [],
        "BlockSites": list(block_sites or []),
        "BlockIp": [],
        "DomainStrategy": "IPIfNonMatch",
        "FakeDNS": "false",
    }


def routing_deeplink(profile: dict, activate: bool = True) -> str:
    """happ://routing/onadd/{base64} — добавить и сразу включить профиль."""
    action = "onadd" if activate else "add"
    payload = _b64(json.dumps(profile, ensure_ascii=False, indent=2))
    return f"happ://routing/{action}/{payload}"


def subscription_headers(
    title: str,
    routing_link: str = "",
    update_interval: int = 12,
    announce: str = "",
    web_page_url: str = "",
) -> dict[str, str]:
    """HTTP-заголовки подписки, которые читает Happ."""
    headers = {
        "profile-title": f"base64:{_b64(title[:PROFILE_TITLE_MAX])}",
        "profile-update-interval": str(update_interval),
        "subscription-userinfo": "upload=0; download=0; total=0; expire=0",
    }
    if routing_link:
        headers["routing"] = routing_link
    if announce:
        headers["announce"] = f"base64:{_b64(announce)}"
    if web_page_url:
        headers["profile-web-page-url"] = web_page_url
    return headers


def subscription_body(
    links: list[str],
    title: str,
    routing_link: str = "",
    update_interval: int = 12,
    announce: str = "",
) -> str:
    """Тело подписки: те же параметры строками с «#», затем ссылки.

    Дублирует заголовки намеренно: часть клиентов читает только тело, и
    подписка остаётся рабочей, если прокси по пути срежет заголовки.
    """
    lines = [
        f"#profile-title: base64:{_b64(title[:PROFILE_TITLE_MAX])}",
        f"#profile-update-interval: {update_interval}",
        "#subscription-userinfo: upload=0; download=0; total=0; expire=0",
    ]
    if announce:
        lines.append(f"#announce: base64:{_b64(announce)}")
    if routing_link:
        lines.append(routing_link)
    lines.extend(links)
    return "\n".join(lines) + "\n"
