"""Коннекторы отдельных площадок."""
from .avito import AvitoConnector
from .google_business import GoogleBusinessConnector
from .meta import FacebookConnector, InstagramConnector
from .ok import OKConnector
from .telegram_channel import TelegramChannelConnector
from .vk import VKConnector
from .whatsapp import WhatsAppConnector
from .yandex_business import YandexBusinessConnector

__all__ = [
    "AvitoConnector",
    "FacebookConnector",
    "GoogleBusinessConnector",
    "InstagramConnector",
    "OKConnector",
    "TelegramChannelConnector",
    "VKConnector",
    "WhatsAppConnector",
    "YandexBusinessConnector",
]
