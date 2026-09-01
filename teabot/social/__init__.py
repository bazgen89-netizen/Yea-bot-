"""Единый хаб соцсетей: все площадки в одном Telegram-чате.

Публичный API пакета: SocialHub, SeenStore, build_connectors, модели.
"""
from .base import CAP_INBOX, CAP_PUBLISH, CAP_REPLY, Connector, ConnectorError
from .hub import SocialHub
from .models import (
    KIND_COMMENT, KIND_MENTION, KIND_MESSAGE, KIND_REVIEW,
    PublishResult, SocialItem,
)
from .registry import build_connectors
from .state import SeenStore

__all__ = [
    "CAP_INBOX", "CAP_PUBLISH", "CAP_REPLY",
    "Connector", "ConnectorError", "SocialHub", "SeenStore",
    "SocialItem", "PublishResult", "build_connectors",
    "KIND_COMMENT", "KIND_MENTION", "KIND_MESSAGE", "KIND_REVIEW",
]
