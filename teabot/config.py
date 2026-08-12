"""Конфигурация приложения: переменные окружения и параметры моделей."""
import os
from dataclasses import dataclass, field
from typing import FrozenSet, Tuple


GROQ_MODEL = "llama-3.3-70b-versatile"

# Тайм-ауты внешних запросов, секунды
SEARCH_TIMEOUT = 8
AI_TIMEOUT = 30
DEBUG_AI_TIMEOUT = 10
DEBUG_SEARCH_TIMEOUT = 5
SOCIAL_TIMEOUT = 20
DEBUG_SOCIAL_TIMEOUT = 8

# Кросспостинг через Metricool
METRICOOL_API_URL = "https://app.metricool.com/api/v2"
# «Опубликовать сейчас» = поставить в очередь через N минут: Metricool
# не принимает время в прошлом, а пока идёт диалог с ботом проходит время.
SOCIAL_PUBLISH_DELAY_MIN = 5
DEFAULT_SOCIAL_TIMEZONE = "Europe/Moscow"
# Сети, подключённые к бренду waystea в Metricool (переопределяется SOCIAL_NETWORKS)
DEFAULT_SOCIAL_NETWORKS = ("instagram", "facebook", "pinterest", "youtube")

# Кэш поиска
CACHE_TTL = 300
CACHE_MAX_SIZE = 200

# Ограничение длины ответа AI (лимит Telegram — 4096 символов на сообщение)
AI_ANSWER_MAX_LEN = 4000


def _parse_admins(raw: str) -> FrozenSet[int]:
    """Разбирает SOCIAL_ADMINS='123,456' в множество Telegram-ID. Мусор игнорируется."""
    ids = set()
    for part in raw.replace(";", ",").split(","):
        part = part.strip()
        if part.lstrip("-").isdigit():
            ids.add(int(part))
    return frozenset(ids)


def _parse_networks(raw: str) -> Tuple[str, ...]:
    """Разбирает SOCIAL_NETWORKS='instagram,facebook' в кортеж кодов сетей."""
    codes = tuple(p.strip().lower() for p in raw.split(",") if p.strip())
    return codes or DEFAULT_SOCIAL_NETWORKS


@dataclass(frozen=True)
class Settings:
    telegram_bot_token: str
    groq_api_key: str
    serper_key: str
    webhook_url: str
    port: int
    groq_model: str = GROQ_MODEL
    # Кросспостинг: пусто → функция выключена, бот отвечает подсказкой
    metricool_user_token: str = ""
    metricool_user_id: str = ""
    metricool_blog_id: str = ""
    social_timezone: str = DEFAULT_SOCIAL_TIMEZONE
    social_networks: Tuple[str, ...] = DEFAULT_SOCIAL_NETWORKS
    social_admins: FrozenSet[int] = field(default_factory=frozenset)

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", ""),
            groq_api_key=os.getenv("GROQ_API_KEY", ""),
            serper_key=os.getenv("SERPER_KEY", ""),
            webhook_url=os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com"),
            port=int(os.getenv("PORT", 8080)),
            metricool_user_token=os.getenv("METRICOOL_USER_TOKEN", ""),
            metricool_user_id=os.getenv("METRICOOL_USER_ID", ""),
            metricool_blog_id=os.getenv("METRICOOL_BLOG_ID", ""),
            social_timezone=os.getenv("SOCIAL_TIMEZONE", DEFAULT_SOCIAL_TIMEZONE),
            social_networks=_parse_networks(os.getenv("SOCIAL_NETWORKS", "")),
            social_admins=_parse_admins(os.getenv("SOCIAL_ADMINS", "")),
        )

    @property
    def social_enabled(self) -> bool:
        """Кросспостинг работает только при полном наборе доступов Metricool."""
        return bool(
            self.metricool_user_token and self.metricool_user_id and self.metricool_blog_id
        )

    def validate(self) -> None:
        """Вызывается при старте приложения, а не при импорте — чтобы тесты работали без токена."""
        if not self.telegram_bot_token:
            raise RuntimeError("❌ TELEGRAM_BOT_TOKEN не задан!")
