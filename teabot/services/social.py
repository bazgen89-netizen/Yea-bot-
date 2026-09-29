"""Клиент Metricool: постановка одного поста сразу в несколько соцсетей.

Metricool выступает единой точкой публикации — бот не хранит токены Instagram,
Facebook, Pinterest и YouTube по отдельности, а отдаёт пост планировщику,
который уже разводит его по подключённым к бренду аккаунтам.

Для каждой сети делается отдельный запрос: если одна площадка отклонит пост
(например, Instagram — из-за отсутствия медиа), остальные всё равно уйдут,
и пользователь увидит построчный отчёт.
"""
import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List, Optional, Sequence

import aiohttp

from ..config import (
    METRICOOL_API_URL, SOCIAL_TIMEOUT, DEBUG_SOCIAL_TIMEOUT,
    SOCIAL_PUBLISH_DELAY_MIN,
)
from ..social import title as network_title

logger = logging.getLogger(__name__)

POSTS_URL = f"{METRICOOL_API_URL}/scheduler/posts"


@dataclass(frozen=True)
class PostResult:
    """Итог публикации в одну сеть."""
    network: str
    ok: bool
    detail: str

    def format(self) -> str:
        mark = "✅" if self.ok else "❌"
        return f"{mark} {network_title(self.network)} — {self.detail}"


def publish_time(timezone: str, delay_min: int = SOCIAL_PUBLISH_DELAY_MIN) -> datetime:
    """Ближайшее допустимое время публикации в часовом поясе бренда."""
    try:
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo(timezone))
    except Exception:  # нет базы tzdata в окружении — падаем на локальное время
        logger.warning(f"Часовой пояс {timezone} недоступен, беру локальное время")
        now = datetime.now()
    return now + timedelta(minutes=delay_min)


class MetricoolClient:
    """Публикация и диагностика через API Metricool v2."""

    def __init__(
        self,
        user_token: str,
        user_id: str,
        blog_id: str,
        timezone: str,
        session: aiohttp.ClientSession,
    ):
        self.user_token = user_token
        self.user_id = user_id
        self.blog_id = blog_id
        self.timezone = timezone
        self.session = session

    @property
    def enabled(self) -> bool:
        return bool(self.user_token and self.user_id and self.blog_id)

    @property
    def _params(self) -> dict:
        return {
            "blogId": self.blog_id,
            "userId": self.user_id,
            "userToken": self.user_token,
        }

    @property
    def _headers(self) -> dict:
        return {"X-Mc-Auth": self.user_token, "Content-Type": "application/json"}

    def _payload(
        self,
        text: str,
        network: str,
        media: Sequence[str],
        when: datetime,
        draft: bool,
    ) -> dict:
        return {
            "text": text,
            "providers": [{"network": network}],
            "publicationDate": {
                "dateTime": when.strftime("%Y-%m-%dT%H:%M:%S"),
                "timezone": self.timezone,
            },
            "media": list(media),
            "autoPublish": not draft,
            "draft": draft,
            "shortener": False,
        }

    async def _publish_one(
        self,
        text: str,
        network: str,
        media: Sequence[str],
        when: datetime,
        draft: bool,
    ) -> PostResult:
        try:
            async with self.session.post(
                POSTS_URL,
                params=self._params,
                headers=self._headers,
                json=self._payload(text, network, media, when, draft),
                timeout=aiohttp.ClientTimeout(total=SOCIAL_TIMEOUT),
            ) as r:
                body = await r.text()
                if r.status in (200, 201):
                    label = "черновик создан" if draft else f"в очереди на {when:%d.%m %H:%M}"
                    return PostResult(network, True, label)
                if r.status in (401, 403):
                    return PostResult(network, False, "нет доступа: проверьте токен Metricool")
                logger.error(f"Metricool {network}: статус {r.status}: {body[:200]}")
                return PostResult(network, False, f"статус {r.status}: {body[:80]}")
        except asyncio.TimeoutError:
            return PostResult(network, False, "Metricool не ответил вовремя")
        except Exception as e:
            logger.error(f"Metricool {network}: ошибка {e}")
            return PostResult(network, False, str(e)[:80])

    async def publish(
        self,
        text: str,
        networks: Sequence[str],
        media: Optional[Sequence[str]] = None,
        when: Optional[datetime] = None,
        draft: bool = False,
    ) -> List[PostResult]:
        """Ставит пост во все переданные сети параллельно и возвращает отчёт."""
        if not self.enabled:
            return [
                PostResult(n, False, "кросспостинг не настроен")
                for n in networks
            ]

        media = list(media or [])
        when = when or publish_time(self.timezone)
        return list(await asyncio.gather(*(
            self._publish_one(text, n, media, when, draft) for n in networks
        )))

    async def health_check(self) -> str:
        """Проверка доступов Metricool для /debug: читаем расписание бренда."""
        if not self.enabled:
            return "⚠️ Не настроен (METRICOOL_USER_TOKEN / USER_ID / BLOG_ID)"

        now = datetime.now()
        params = dict(self._params, **{
            "start": now.strftime("%Y-%m-%dT00:00:00"),
            "end": (now + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00"),
            "timezone": self.timezone,
        })
        try:
            async with self.session.get(
                POSTS_URL,
                params=params,
                headers=self._headers,
                timeout=aiohttp.ClientTimeout(total=DEBUG_SOCIAL_TIMEOUT),
            ) as r:
                if r.status == 200:
                    return f"✅ бренд {self.blog_id} доступен"
                if r.status in (401, 403):
                    return "❌ неверный токен или нет прав на бренд"
                return f"❌ статус {r.status}"
        except asyncio.TimeoutError:
            return "⏱ Таймаут"
        except Exception as e:
            return f"💥 {str(e)[:60]}"


def format_report(results: Sequence[PostResult]) -> str:
    """Человекочитаемый отчёт о раскладке поста по сетям."""
    ok = sum(1 for r in results if r.ok)
    header = f"📡 <b>Синхронизация:</b> {ok} из {len(results)} сетей"
    return "\n".join([header, ""] + [r.format() for r in results])
