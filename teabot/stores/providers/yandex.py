"""Яндекс Карты — Places API («Поиск по организациям»).

Что доступно публично: название, адрес, телефоны, часы работы, ссылка на
карточку. Рейтинг и тексты отзывов Яндекс через открытый API не отдаёт —
работа с отзывами ведётся в кабинете Яндекс Бизнеса (см. docs/STORES.md).

Поиск организации идёт текстом (`text`), потому что выдачи по id у API нет:
берём store.search_text() и, если задан id организации, оставляем только
совпадение по нему.
"""
import logging

import aiohttp

from ...config import STORES_TIMEOUT
from ..models import YANDEX, Store, StoreCard
from .base import MapsProvider

logger = logging.getLogger(__name__)

API_URL = "https://search-maps.yandex.ru/v1/"
OWNER_CONSOLE = "https://yandex.ru/sprav/"


class YandexMapsProvider(MapsProvider):
    platform = YANDEX
    title = "Яндекс Карты"
    supports_reviews = False
    supports_replies = False
    owner_console_url = OWNER_CONSOLE

    def __init__(self, api_key: str, session: aiohttp.ClientSession):
        super().__init__(session)
        self.api_key = api_key

    def configured(self) -> bool:
        return bool(self.api_key)

    async def _search(self, text: str, results: int = 5) -> list[dict]:
        params = {
            "apikey": self.api_key,
            "text": text,
            "lang": "ru_RU",
            "type": "biz",
            "results": results,
        }
        async with self.session.get(
            API_URL, params=params,
            timeout=aiohttp.ClientTimeout(total=STORES_TIMEOUT),
        ) as r:
            if r.status != 200:
                raise RuntimeError(f"HTTP {r.status}")
            data = await r.json()
        return data.get("features", [])

    async def fetch_card(self, store: Store) -> StoreCard:
        ref = store.ref(self.platform)
        if ref is None:
            return self._empty_card(store, "карточка не привязана")
        if not self.configured():
            return self._empty_card(store, "YANDEX_MAPS_KEY не задан")

        try:
            features = await self._search(store.search_text(self.platform))
        except Exception as e:
            logger.warning(f"Яндекс Карты, {store.slug}: {e}")
            return self._empty_card(store, str(e)[:80])

        feature = self._pick(features, ref.external_id)
        if feature is None:
            return self._empty_card(store, "организация не найдена")

        meta = feature.get("properties", {}).get("CompanyMetaData", {})
        phones = meta.get("Phones") or []
        return StoreCard(
            platform=self.platform,
            store_slug=store.slug,
            name=meta.get("name", store.name),
            address=meta.get("address", store.address),
            url=meta.get("url") or ref.public_url(),
            phone=phones[0].get("formatted", "") if phones else "",
            hours=(meta.get("Hours") or {}).get("text", ""),
        )

    @staticmethod
    def _pick(features: list[dict], org_id: str) -> dict | None:
        """Совпадение по id организации, иначе — первый результат выдачи."""
        if not features:
            return None
        if org_id:
            for f in features:
                if str(f.get("properties", {}).get("CompanyMetaData", {}).get("id")) == org_id:
                    return f
        return features[0]

    async def health_check(self) -> str:
        if not self.configured():
            return "⚠️ ключ не задан"
        try:
            await self._search("чай", results=1)
            return "✅ доступ есть"
        except Exception as e:
            return f"❌ {str(e)[:50]}"
