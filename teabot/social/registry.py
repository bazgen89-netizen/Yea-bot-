"""Сборка коннекторов из переменных окружения.

Каждая площадка включается сама, как только заданы её переменные —
никаких флагов «включить сеть» не нужно.
"""
import logging
from typing import Mapping

import aiohttp

from .. import branches
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
)


def _yandex_connectors(env: Mapping[str, str],
                       session: aiohttp.ClientSession) -> list[Connector]:
    """По коннектору на каждую карточку Яндекс Карт.

    YANDEX_COMPANIES перечисляет точки: «gagarina:123,gastromarket:456».
    Если задан только YANDEX_COMPANY_ID, работает одна карточка без
    привязки к точке — как было раньше.
    """
    common = {
        "token": env.get("YANDEX_BUSINESS_TOKEN", ""),
        "api_url": env.get("YANDEX_API_URL", ""),
    }
    pairs = env.get("YANDEX_COMPANIES", "").strip()
    if not pairs and env.get("YANDEX_COMPANY_ID", "").strip():
        # Явно заданная одна карточка — работает как раньше, без привязки к точке
        return [YandexBusinessConnector(
            session, company_id=env["YANDEX_COMPANY_ID"].strip(), **common,
        )]
    # По умолчанию — карточки точек, известные из branches.py
    pairs = pairs or branches.yandex_pairs()

    out = []
    for chunk in pairs.replace(";", ",").split(","):
        code, _, company_id = chunk.partition(":")
        code, company_id = code.strip(), company_id.strip()
        if not company_id:
            logger.warning("YANDEX_COMPANIES: пропущен id у «%s»", chunk.strip())
            continue
        if branches.find(code) is None:
            logger.warning(
                "YANDEX_COMPANIES: точка «%s» не описана в teabot/branches.py — "
                "отзывы придут без профиля магазина", code,
            )
        out.append(YandexBusinessConnector(
            session, company_id=company_id, branch=code, **common,
        ))
    return out


def _google_connectors(env: Mapping[str, str],
                       session: aiohttp.ClientSession) -> list[Connector]:
    """По коннектору на каждую локацию Google Business Profile.

    GOOGLE_LOCATIONS перечисляет точки через запятую:
    «gagarina:accounts/1/locations/2,cheryomushki:accounts/1/locations/3».
    Одиночный GOOGLE_LOCATION продолжает работать как раньше.
    """
    common = {
        "client_id": env.get("GOOGLE_CLIENT_ID", ""),
        "client_secret": env.get("GOOGLE_CLIENT_SECRET", ""),
        "refresh_token": env.get("GOOGLE_REFRESH_TOKEN", ""),
    }
    pairs = env.get("GOOGLE_LOCATIONS", "").strip()
    if not pairs:
        return [GoogleBusinessConnector(
            session, location=env.get("GOOGLE_LOCATION", ""), **common,
        )]

    out = []
    for chunk in pairs.split(","):
        code, _, location = chunk.partition(":")
        code, location = code.strip(), location.strip()
        if not location:
            logger.warning("GOOGLE_LOCATIONS: пропущена локация у «%s»", chunk.strip())
            continue
        if branches.find(code) is None:
            logger.warning(
                "GOOGLE_LOCATIONS: точка «%s» не описана в teabot/branches.py — "
                "отзывы придут без профиля магазина", code,
            )
        out.append(GoogleBusinessConnector(
            session, location=location, branch=code, **common,
        ))
    return out


def build_connectors(env: Mapping[str, str],
                     session: aiohttp.ClientSession) -> list[Connector]:
    """Создаёт все коннекторы; включённость каждый определяет сам по своим ключам."""
    connectors = []
    for cls, mapping in SPECS:
        creds = {arg: env.get(var, "") for arg, var in mapping.items()}
        connectors.append(cls(session, **creds))
    connectors += _yandex_connectors(env, session)
    connectors += _google_connectors(env, session)
    enabled = [c.title for c in connectors if c.enabled]
    logger.info("🌐 Соцсети подключены: %s", ", ".join(enabled) if enabled else "нет")
    return connectors

