"""HTTP-эндпоинт подписки: /sub/{token}.

Happ (и другие клиенты) периодически опрашивают этот адрес и получают
актуальный список ключей вместе с профилем маршрутизации по белому списку.
Пользователю достаточно один раз добавить ссылку в приложение.
"""
import logging

from aiohttp import web

from .handlers import VPN_KEY
from .services.happ import (
    build_routing_profile, routing_deeplink, subscription_body, subscription_headers,
)
from .services.rules import collect_domains, load_profile, load_services

logger = logging.getLogger(__name__)

ROUTING_KEY = "happ_routing_link"
SUB_UPDATE_INTERVAL = 12  # часов


def build_routing_link(profile_name: str) -> str:
    """Собирает happ://routing/onadd/... для странового профиля.

    Вызывается один раз при старте: у профиля есть поле LastUpdated, и если
    пересобирать ссылку на каждый запрос, Happ будет считать гео-базы
    устаревшими при каждом обновлении подписки.
    """
    profile = load_profile(profile_name)
    domains, geosite = collect_domains(profile, load_services())
    direct = profile.get("direct", {})
    happ_profile = build_routing_profile(
        name=f"Whitelist {profile.get('country', profile_name.upper())}",
        proxy_domains=domains,
        proxy_geosite=geosite,
        direct_domains=list(direct.get("domains", []))
        + [f"geosite:{g}" for g in direct.get("geosite", [])],
        direct_ip=[f"geoip:{c}" for c in direct.get("geoip", []) if c != "private"],
    )
    return routing_deeplink(happ_profile)


async def handle_subscription(request: web.Request) -> web.Response:
    ptb = request.app["ptb_app"]
    vpn = ptb.bot_data.get(VPN_KEY)
    if vpn is None:
        return web.Response(text="VPN не настроен", status=404)

    user = await vpn.find_by_token(request.match_info.get("token", ""))
    if user is None:
        # Тот же ответ, что и для отозванного ключа: перебор токенов не должен
        # отличать «нет такого» от «был, но отозван».
        return web.Response(text="Подписка не найдена", status=404)

    title = request.app["settings"].vpn_sub_title
    routing_link = request.app.get(ROUTING_KEY, "")
    links = [vpn.link(user)]

    body = subscription_body(links, title, routing_link,
                             update_interval=SUB_UPDATE_INTERVAL)
    headers = subscription_headers(title, routing_link,
                                   update_interval=SUB_UPDATE_INTERVAL)
    headers["cache-control"] = "no-store"
    return web.Response(text=body, headers=headers, content_type="text/plain")
