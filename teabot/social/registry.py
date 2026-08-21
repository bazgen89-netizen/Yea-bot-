"""Сборка коннекторов из переменных окружения.

Каждая площадка включается сама, как только заданы её переменные —
никаких флагов «включить сеть» не нужно.
"""
import logging
from typing import Mapping

import aiohttp

from .base import Connector
from .connectors import (
    AvitoConnector, FacebookConnector, GoogleBusinessConnector,
    InstagramConnector, OKConnector, TelegramChannelConnector,
    VKConnector, WhatsAppConnector, YandexBusinessConnector,
)

logger = logging.getLogger(__name__)

# (класс, {имя аргумента: переменная окружения})
SPECS: tuple = (
    (VKConnector, {"token": "VK_GROUP_TOKEN", "group_id": "VK_GROUP_ID"}),
    (TelegramChannelConnector, {"token": "TELEGRAM_BOT_TOKEN",
                                "channel_id": "TELEGRAM_CHANNEL_ID"}),
    (OKConnector, {"app_key": "OK_APP_KEY", "app_secret": "OK_APP_SECRET",
                   "access_token": "OK_ACCESS_TOKEN", "group_id": "OK_GROUP_ID"}),
    (FacebookConnector, {"page_id": "FB_PAGE_ID", "token": "FB_PAGE_TOKEN"}),
    (InstagramConnector, {"user_id": "IG_USER_ID", "token": "IG_TOKEN"}),
    (WhatsAppConnector, {"phone_id": "WA_PHONE_ID", "token": "WA_TOKEN"}),
    (AvitoConnector, {"client_id": "AVITO_CLIENT_ID",
                      "client_secret": "AVITO_CLIENT_SECRET",
                      "user_id": "AVITO_USER_ID"}),
    (YandexBusinessConnector, {"token": "YANDEX_BUSINESS_TOKEN",
                               "company_id": "YANDEX_COMPANY_ID",
                               "api_url": "YANDEX_API_URL"}),
    (GoogleBusinessConnector, {"client_id": "GOOGLE_CLIENT_ID",
                               "client_secret": "GOOGLE_CLIENT_SECRET",
                               "refresh_token": "GOOGLE_REFRESH_TOKEN",
                               "location": "GOOGLE_LOCATION"}),
)


def build_connectors(env: Mapping[str, str],
                     session: aiohttp.ClientSession) -> list[Connector]:
    """Создаёт все коннекторы; включённость каждый определяет сам по своим ключам."""
    connectors = []
    for cls, mapping in SPECS:
        creds = {arg: env.get(var, "") for arg, var in mapping.items()}
        connectors.append(cls(session, **creds))
    enabled = [c.title for c in connectors if c.enabled]
    logger.info("🌐 Соцсети подключены: %s", ", ".join(enabled) if enabled else "нет")
    return connectors

