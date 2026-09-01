"""Базовый контракт коннектора соцсети.

Коннектор реализует только то, что умеет сеть: часть площадок не даёт
читать входящие по запросу (WhatsApp — только webhook), часть не даёт
публиковать текстовые посты (Instagram требует медиа). Возможности
объявляются в capabilities, хаб не вызывает то, чего сеть не умеет.
"""
import asyncio
import logging
from typing import Any, ClassVar

import aiohttp

from .models import PublishResult, SocialItem

logger = logging.getLogger(__name__)

# Что умеет коннектор
CAP_INBOX = "inbox"      # читать входящие
CAP_REPLY = "reply"      # отвечать на входящее
CAP_PUBLISH = "publish"  # публиковать пост

SOCIAL_TIMEOUT = 15
SOCIAL_HEALTH_TIMEOUT = 8


class ConnectorError(Exception):
    """Ошибка обращения к API сети. Хаб ловит её и продолжает с другими сетями."""


class Connector:
    """Один аккаунт в одной сети."""

    network: ClassVar[str] = ""
    title: ClassVar[str] = ""
    capabilities: ClassVar[frozenset] = frozenset()

    #: Переменные окружения, без которых коннектор не включается
    required_env: ClassVar[tuple] = ()

    def __init__(self, session: aiohttp.ClientSession, **creds: str):
        self.session = session
        self.creds = {k: (v or "").strip() for k, v in creds.items()}

    @property
    def enabled(self) -> bool:
        return all(self.creds.get(k) for k in self._cred_keys())

    def _cred_keys(self) -> tuple:
        return tuple(self.creds.keys())

    def can(self, capability: str) -> bool:
        return capability in self.capabilities

    async def fetch(self, limit: int = 10) -> list[SocialItem]:
        """Свежие входящие. Пустой список, если сеть не поддерживает чтение."""
        return []

    async def reply(self, item: SocialItem, text: str) -> PublishResult:
        return PublishResult(self.network, False, error="ответы не поддерживаются")

    async def publish(self, text: str, link: str = "") -> PublishResult:
        return PublishResult(self.network, False, error="публикация не поддерживается")

    async def health_check(self) -> str:
        """Короткая строка статуса для панели /social."""
        return "✅ настроен"

    def __repr__(self) -> str:
        return f"<{type(self).__name__} {self.network}>"


class HttpConnector(Connector):
    """Коннектор поверх HTTP-API с общей обработкой таймаутов и ошибок."""

    async def _request(self, method: str, url: str, *, timeout: int = SOCIAL_TIMEOUT,
                       **kwargs: Any) -> tuple[int, Any]:
        """Возвращает (статус, тело). Тело — dict/list для JSON, иначе строка."""
        try:
            async with self.session.request(
                method, url, timeout=aiohttp.ClientTimeout(total=timeout), **kwargs
            ) as r:
                try:
                    body = await r.json(content_type=None)
                except Exception:
                    body = (await r.text())[:500]
                return r.status, body
        except asyncio.TimeoutError:
            raise ConnectorError("таймаут запроса")
        except aiohttp.ClientError as e:
            raise ConnectorError(f"сеть недоступна: {str(e)[:80]}")

    async def _get(self, url: str, **kwargs: Any) -> Any:
        status, body = await self._request("GET", url, **kwargs)
        return self._unwrap(status, body)

    async def _post(self, url: str, **kwargs: Any) -> Any:
        status, body = await self._request("POST", url, **kwargs)
        return self._unwrap(status, body)

    @staticmethod
    def _unwrap(status: int, body: Any) -> Any:
        if status == 401 or status == 403:
            raise ConnectorError(f"нет доступа (HTTP {status}) — проверьте токен")
        if status == 429:
            raise ConnectorError("лимит запросов (429)")
        if status >= 400:
            detail = body if isinstance(body, str) else str(body)[:150]
            raise ConnectorError(f"HTTP {status}: {detail}")
        return body

    async def health_check(self) -> str:
        if not self.enabled:
            return "⚪️ не настроен"
        try:
            return await self._probe()
        except ConnectorError as e:
            return f"❌ {e}"
        except Exception as e:  # noqa: BLE001 — статус не должен ронять панель
            logger.warning("health_check %s: %s", self.network, e)
            return f"💥 {str(e)[:60]}"

    async def _probe(self) -> str:
        """Лёгкий запрос, подтверждающий валидность токена."""
        return "✅ настроен"

