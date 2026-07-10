"""Поиск через Serper API: китайские и российские источники."""
import asyncio
import logging
from typing import Optional

import aiohttp

from ..cache import TTLCache
from ..config import SEARCH_TIMEOUT, DEBUG_SEARCH_TIMEOUT

logger = logging.getLogger(__name__)

SERPER_URL = "https://google.serper.dev/search"


class SerperClient:
    """Клиент Serper с кэшированием результатов и параллельным поиском cn+ru."""

    def __init__(self, api_key: str, session: aiohttp.ClientSession, cache: TTLCache):
        self.api_key = api_key
        self.session = session
        self.cache = cache

    async def _query(self, params: dict, label: str, limit: int) -> Optional[str]:
        """Один запрос к Serper; возвращает отформатированный блок или None."""
        try:
            async with self.session.post(
                SERPER_URL,
                headers={"X-API-KEY": self.api_key},
                json=params,
                timeout=aiohttp.ClientTimeout(total=SEARCH_TIMEOUT),
            ) as r:
                if r.status != 200:
                    return None
                data = await r.json()
                lines = "\n".join(
                    f"• {i.get('title', '')}: {i.get('snippet', '')}"
                    for i in data.get("organic", [])[:limit]
                )
                return f"[{label}]\n{lines}" if lines else None
        except Exception as e:
            logger.warning(f"{label}: поиск не удался: {e}")
            return None

    async def search_china(self, q: str) -> str:
        """Поиск на китайских источниках + русскоязычное дополнение (параллельно)."""
        if not self.api_key:
            return ""

        cache_key = f"cn_{q.lower().strip()}"
        cached = self.cache.get(cache_key)
        if cached is not None:
            return cached

        cn, ru = await asyncio.gather(
            self._query(
                {"q": q, "num": 3, "hl": "zh-cn", "gl": "cn"},
                "Китайские источники", 3,
            ),
            self._query(
                {"q": q + " Россия", "num": 2, "hl": "ru", "gl": "ru"},
                "Российские источники", 2,
            ),
        )

        combined = "\n\n".join(part for part in (cn, ru) if part)
        if combined:
            self.cache.set(cache_key, combined)

        return combined

    async def health_check(self) -> str:
        """Проверка доступности Serper для /debug."""
        if not self.api_key:
            return "⚠️ Ключ не задан"
        try:
            async with self.session.post(
                SERPER_URL,
                headers={"X-API-KEY": self.api_key},
                json={"q": "茶叶", "num": 1, "hl": "zh-cn", "gl": "cn"},
                timeout=aiohttp.ClientTimeout(total=DEBUG_SEARCH_TIMEOUT),
            ) as r:
                return "✅ китайский поиск работает" if r.status == 200 else f"❌ статус {r.status}"
        except Exception as e:
            return f"❌ {str(e)[:50]}"
