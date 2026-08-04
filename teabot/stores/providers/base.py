"""Базовый интерфейс провайдера картографической площадки.

Провайдер знает, как получить карточку и отзывы конкретной площадки, и ничего
не знает ни о Telegram, ни о других площадках. Добавление четвёртой площадки —
это новый файл в этом пакете и одна строка в providers/__init__.py.
"""
import logging
from abc import ABC, abstractmethod

import aiohttp

from ..models import Review, Store, StoreCard

logger = logging.getLogger(__name__)


class ReplyNotSupported(RuntimeError):
    """Площадка не даёт публичного API для ответа на отзывы."""


class MapsProvider(ABC):
    """Общий контракт всех площадок."""

    platform: str = ""
    title: str = ""
    #: отдаёт ли площадка тексты отзывов через API
    supports_reviews: bool = False
    #: можно ли отвечать на отзывы через API (нужен доступ владельца)
    supports_replies: bool = False
    #: ссылка на кабинет владельца — для действий, которых нет в API
    owner_console_url: str = ""

    def __init__(self, session: aiohttp.ClientSession):
        self.session = session

    @abstractmethod
    def configured(self) -> bool:
        """Заданы ли ключи, необходимые для работы провайдера."""

    @abstractmethod
    async def fetch_card(self, store: Store) -> StoreCard:
        """Карточка магазина на этой площадке."""

    async def fetch_reviews(self, store: Store, limit: int = 10) -> list[Review]:
        """Отзывы о магазине. По умолчанию площадка их не отдаёт."""
        return []

    async def reply_to_review(self, store: Store, review_id: str, text: str) -> None:
        """Ответ владельца на отзыв."""
        raise ReplyNotSupported(
            f"{self.title}: публичного API для ответа на отзывы нет — "
            f"ответьте в кабинете: {self.owner_console_url}"
        )

    @abstractmethod
    async def health_check(self) -> str:
        """Строка состояния для /debug."""

    def _empty_card(self, store: Store, error: str) -> StoreCard:
        ref = store.ref(self.platform)
        return StoreCard(
            platform=self.platform,
            store_slug=store.slug,
            name=store.name,
            address=store.address,
            url=ref.public_url() if ref else "",
            error=error,
        )
