"""StoresService — единый доступ к магазинам на всех площадках.

Собирает карточки и отзывы параллельно, кэширует результаты и ничего не знает
о Telegram: форматированием занимается formatting.py, отправкой — handlers.
"""
import asyncio
import logging
from typing import Iterable, Optional

from ..cache import TTLCache
from .models import PLATFORM_TITLES, Review, Store, StoreCard
from .providers import MapsProvider, ReplyNotSupported
from .registry import StoreRegistry

logger = logging.getLogger(__name__)


class StoresService:
    """Фасад над реестром магазинов и провайдерами площадок."""

    def __init__(self, registry: StoreRegistry, providers: Iterable[MapsProvider],
                 cache: TTLCache):
        self.registry = registry
        self.providers: dict[str, MapsProvider] = {p.platform: p for p in providers}
        self.cache = cache

    @property
    def enabled(self) -> bool:
        """Есть ли что показывать: хотя бы одна точка и один настроенный провайдер."""
        return bool(len(self.registry)) and any(
            p.configured() for p in self.providers.values()
        )

    def provider(self, platform: str) -> Optional[MapsProvider]:
        return self.providers.get(platform)

    def store(self, slug: str) -> Optional[Store]:
        return self.registry.get(slug)

    # --- карточки ----------------------------------------------------------

    async def cards_for(self, store: Store) -> list[StoreCard]:
        """Карточки одной точки со всех привязанных площадок (параллельно)."""
        cache_key = f"cards_{store.slug}"
        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        targets = [
            self.providers[platform]
            for platform in store.refs
            if platform in self.providers
        ]
        cards = await asyncio.gather(
            *(p.fetch_card(store) for p in targets), return_exceptions=True
        )

        result: list[StoreCard] = []
        for provider, card in zip(targets, cards):
            if isinstance(card, BaseException):
                logger.warning(f"{provider.title}, {store.slug}: {card}")
                result.append(StoreCard(
                    platform=provider.platform, store_slug=store.slug,
                    name=store.name, error=str(card)[:80],
                ))
            else:
                result.append(card)

        if any(c.ok for c in result):
            self.cache.set(cache_key, result)
        return result

    async def all_cards(self) -> list[tuple[Store, list[StoreCard]]]:
        """Карточки всех точек."""
        stores = self.registry.stores
        batches = await asyncio.gather(*(self.cards_for(s) for s in stores))
        return list(zip(stores, batches))

    # --- отзывы ------------------------------------------------------------

    async def reviews_for(self, store: Store, limit: int = 10) -> list[Review]:
        """Отзывы одной точки со всех площадок, что их отдают."""
        targets = [
            self.providers[platform]
            for platform in store.refs
            if platform in self.providers
            and self.providers[platform].supports_reviews
            and self.providers[platform].configured()
        ]
        batches = await asyncio.gather(
            *(p.fetch_reviews(store, limit) for p in targets), return_exceptions=True
        )
        out: list[Review] = []
        for provider, batch in zip(targets, batches):
            if isinstance(batch, BaseException):
                logger.warning(f"{provider.title} отзывы, {store.slug}: {batch}")
                continue
            out.extend(batch)
        out.sort(key=lambda r: r.created_at, reverse=True)
        return out

    async def all_reviews(self, limit_per_store: int = 10) -> list[Review]:
        stores = self.registry.stores
        batches = await asyncio.gather(
            *(self.reviews_for(s, limit_per_store) for s in stores)
        )
        return [r for batch in batches for r in batch]

    async def reply_to_review(self, store_slug: str, platform: str,
                              review_id: str, text: str) -> None:
        """Ответ владельца на отзыв (там, где площадка это позволяет)."""
        store = self.store(store_slug)
        if store is None:
            raise ValueError(f"магазин «{store_slug}» не найден в реестре")
        provider = self.provider(platform)
        if provider is None:
            raise ValueError(f"площадка «{platform}» не подключена")
        await provider.reply_to_review(store, review_id, text)

    # --- диагностика -------------------------------------------------------

    async def health_check(self) -> list[str]:
        """Строки состояния площадок для /debug."""
        used = self.registry.platforms_in_use()
        lines = [f"📍 Точек в реестре: {len(self.registry)}"]
        checks = await asyncio.gather(
            *(p.health_check() for p in self.providers.values()),
            return_exceptions=True,
        )
        for provider, status in zip(self.providers.values(), checks):
            if isinstance(status, BaseException):
                status = f"❌ {str(status)[:50]}"
            mark = "" if provider.platform in used else " (нет точек в реестре)"
            title = PLATFORM_TITLES.get(provider.platform, provider.platform)
            lines.append(f"  {title}: {status}{mark}")
        return lines


__all__ = ["StoresService", "ReplyNotSupported"]
