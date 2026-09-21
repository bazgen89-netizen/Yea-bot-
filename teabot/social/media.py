"""Хостинг картинок для постов.

Instagram и Facebook не принимают файл: они просят публичную ссылку и
скачивают картинку сами. Фото из Telegram живёт на серверах Telegram по
временной ссылке с токеном бота — отдавать её Meta нельзя. Поэтому
картинка сначала попадает в медиатеку сайта, а площадкам уходит уже
постоянный адрес оттуда.

Настройка: WP_URL (например https://waystea.ru), WP_USER и
WP_APP_PASSWORD — пароль приложения WordPress, не пароль от учётки.
"""
import asyncio
import base64
import logging
import re

import aiohttp

logger = logging.getLogger(__name__)

UPLOAD_TIMEOUT = 60

# Требования Instagram к картинке в ленте
INSTAGRAM_MAX_BYTES = 8 * 1024 * 1024
INSTAGRAM_FORMAT = "image/jpeg"


class MediaError(Exception):
    """Картинку не удалось выложить — публикация без неё не поедет."""


def check_for_instagram(data: bytes, content_type: str) -> str:
    """Проверяет картинку до загрузки. Возвращает текст проблемы или ''."""
    if content_type != INSTAGRAM_FORMAT:
        return f"Instagram принимает только JPEG, а это {content_type}"
    if len(data) > INSTAGRAM_MAX_BYTES:
        return f"Instagram принимает до 8 МБ, а это {len(data) / 1024 / 1024:.1f} МБ"
    return ""


class WordPressMedia:
    """Медиатека WordPress как хранилище картинок для постов."""

    def __init__(self, site_url: str, user: str, app_password: str,
                 session: aiohttp.ClientSession):
        self.site_url = (site_url or "").rstrip("/")
        self.user = user
        self.app_password = app_password
        self.session = session

    @property
    def available(self) -> bool:
        return bool(self.site_url and self.user and self.app_password)

    @property
    def _headers(self) -> dict:
        # Пароль приложения WordPress передаётся обычной базовой авторизацией
        token = base64.b64encode(
            f"{self.user}:{self.app_password}".encode()
        ).decode()
        return {"Authorization": f"Basic {token}"}

    @staticmethod
    def _safe_name(name: str) -> str:
        """Имя файла без путей и лишних точек: его увидит весь интернет."""
        name = re.sub(r"[^\w.-]+", "-", name)
        name = re.sub(r"[.-]{2,}", "-", name).strip(".-") or "post"
        return name if name.lower().endswith((".jpg", ".jpeg")) else f"{name}.jpg"

    async def upload(self, data: bytes, filename: str = "post.jpg",
                     content_type: str = INSTAGRAM_FORMAT) -> str:
        """Кладёт картинку в медиатеку и возвращает её постоянный адрес."""
        if not self.available:
            raise MediaError(
                "Хостинг картинок не настроен: задайте WP_URL, WP_USER и WP_APP_PASSWORD"
            )
        name = self._safe_name(filename)
        try:
            async with self.session.post(
                f"{self.site_url}/wp-json/wp/v2/media",
                headers={
                    **self._headers,
                    "Content-Type": content_type,
                    "Content-Disposition": f'attachment; filename="{name}"',
                },
                data=data,
                timeout=aiohttp.ClientTimeout(total=UPLOAD_TIMEOUT),
            ) as resp:
                body = await resp.json(content_type=None)
                if resp.status >= 400:
                    detail = (body or {}).get("message") if isinstance(body, dict) else body
                    raise MediaError(f"Сайт отклонил картинку (HTTP {resp.status}): "
                                     f"{str(detail)[:150]}")
                url = (body or {}).get("source_url") if isinstance(body, dict) else ""
                if not url:
                    raise MediaError("Сайт не вернул ссылку на картинку")
                logger.info("🖼 Картинка выложена: %s", url)
                return url
        except asyncio.TimeoutError:
            raise MediaError("Сайт не ответил вовремя — картинка не выложена")
        except aiohttp.ClientError as e:
            raise MediaError(f"Сайт недоступен: {str(e)[:100]}")

    async def health_check(self) -> str:
        if not self.available:
            return "⚪️ не настроен"
        try:
            async with self.session.get(
                f"{self.site_url}/wp-json/wp/v2/media?per_page=1",
                headers=self._headers,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as r:
                if r.status == 200:
                    return "✅ медиатека доступна"
                if r.status in (401, 403):
                    return "❌ неверный пароль приложения"
                return f"❌ статус {r.status}"
        except Exception as e:  # noqa: BLE001 — статус не должен ронять панель
            return f"💥 {str(e)[:60]}"
