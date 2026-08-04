"""2ГИС — Catalog API (карточка филиала) и Reviews API (отзывы).

Карточка берётся по id филиала из справочника (`items/byid`): название, адрес,
телефон, график, рейтинг и число отзывов. Тексты отзывов отдаёт отдельный
Reviews API, для него нужен свой ключ (TWOGIS_REVIEWS_KEY); если он не задан,
показываются только рейтинг и счётчик из карточки.

Публичного API для ответа на отзывы у 2ГИС нет — отвечают в кабинете.
"""
import logging
from typing import Optional

import aiohttp

from ...config import STORES_TIMEOUT
from ..models import TWOGIS, Review, Store, StoreCard
from .base import MapsProvider

logger = logging.getLogger(__name__)

CATALOG_URL = "https://catalog.api.2gis.com/3.0/items/byid"
REVIEWS_URL = "https://public-api.reviews.2gis.com/2.0/branches/{branch_id}/reviews"
OWNER_CONSOLE = "https://account.2gis.com/"

CARD_FIELDS = ",".join([
    "items.contact_groups",
    "items.schedule",
    "items.reviews",
    "items.point",
    "items.external_content",
])

WEEKDAYS = {
    "Mon": "Пн", "Tue": "Вт", "Wed": "Ср", "Thu": "Чт",
    "Fri": "Пт", "Sat": "Сб", "Sun": "Вс",
}


class TwoGisProvider(MapsProvider):
    platform = TWOGIS
    title = "2ГИС"
    supports_reviews = True
    supports_replies = False
    owner_console_url = OWNER_CONSOLE

    def __init__(self, api_key: str, session: aiohttp.ClientSession,
                 reviews_key: str = ""):
        super().__init__(session)
        self.api_key = api_key
        self.reviews_key = reviews_key

    def configured(self) -> bool:
        return bool(self.api_key)

    async def _item(self, branch_id: str) -> Optional[dict]:
        params = {
            "id": branch_id,
            "key": self.api_key,
            "fields": CARD_FIELDS,
            "locale": "ru_RU",
        }
        async with self.session.get(
            CATALOG_URL, params=params,
            timeout=aiohttp.ClientTimeout(total=STORES_TIMEOUT),
        ) as r:
            if r.status != 200:
                raise RuntimeError(f"HTTP {r.status}")
            data = await r.json()
        items = (data.get("result") or {}).get("items") or []
        return items[0] if items else None

    async def fetch_card(self, store: Store) -> StoreCard:
        ref = store.ref(self.platform)
        if ref is None or not ref.external_id:
            return self._empty_card(store, "не указан id филиала")
        if not self.configured():
            return self._empty_card(store, "TWOGIS_KEY не задан")

        try:
            item = await self._item(ref.external_id)
        except Exception as e:
            logger.warning(f"2ГИС, {store.slug}: {e}")
            return self._empty_card(store, str(e)[:80])

        if item is None:
            return self._empty_card(store, "филиал не найден")

        reviews = item.get("reviews") or {}
        return StoreCard(
            platform=self.platform,
            store_slug=store.slug,
            name=item.get("name", store.name),
            address=item.get("full_address_name") or item.get("address_name") or store.address,
            url=ref.public_url(),
            phone=self._phone(item),
            hours=self._schedule(item.get("schedule") or {}),
            rating=reviews.get("general_rating") or reviews.get("rating"),
            reviews_count=reviews.get("general_review_count") or reviews.get("review_count"),
        )

    @staticmethod
    def _phone(item: dict) -> str:
        for group in item.get("contact_groups") or []:
            for contact in group.get("contacts") or []:
                if contact.get("type") == "phone":
                    return contact.get("text") or contact.get("value", "")
        return ""

    @staticmethod
    def _schedule(schedule: dict) -> str:
        """Компактный график: «Пн–Вс 10:00–20:00» в виде списка по дням."""
        if schedule.get("is_24x7"):
            return "круглосуточно"
        parts = []
        for code, ru in WEEKDAYS.items():
            day = schedule.get(code)
            if not day:
                continue
            hours = "/".join(
                f"{w.get('from', '')}–{w.get('to', '')}"
                for w in day.get("working_hours") or []
            )
            if hours:
                parts.append(f"{ru} {hours}")
        return ", ".join(parts)

    async def fetch_reviews(self, store: Store, limit: int = 10) -> list[Review]:
        ref = store.ref(self.platform)
        key = self.reviews_key or self.api_key
        if ref is None or not ref.external_id or not key:
            return []

        params = {
            "key": key,
            "limit": min(limit, 50),
            "locale": "ru_RU",
            "sort_by": "date_created",
        }
        try:
            async with self.session.get(
                REVIEWS_URL.format(branch_id=ref.external_id), params=params,
                timeout=aiohttp.ClientTimeout(total=STORES_TIMEOUT),
            ) as r:
                if r.status != 200:
                    logger.warning(f"2ГИС отзывы, {store.slug}: HTTP {r.status}")
                    return []
                data = await r.json()
        except Exception as e:
            logger.warning(f"2ГИС отзывы, {store.slug}: {e}")
            return []

        out = []
        for item in (data.get("reviews") or [])[:limit]:
            answer = item.get("official_answer") or {}
            out.append(Review(
                platform=self.platform,
                store_slug=store.slug,
                review_id=str(item.get("id", "")),
                author=(item.get("user") or {}).get("name", ""),
                rating=item.get("rating"),
                text=item.get("text", ""),
                created_at=item.get("date_created", ""),
                reply_text=answer.get("text", ""),
                url=ref.public_url(),
            ))
        return out

    async def health_check(self) -> str:
        if not self.configured():
            return "⚠️ ключ не задан"
        try:
            async with self.session.get(
                CATALOG_URL,
                params={"id": "141265769336054", "key": self.api_key, "locale": "ru_RU"},
                timeout=aiohttp.ClientTimeout(total=STORES_TIMEOUT),
            ) as r:
                if r.status == 200:
                    return "✅ доступ есть"
                return f"❌ статус {r.status}"
        except Exception as e:
            return f"❌ {str(e)[:50]}"
