"""Конфигурация приложения: переменные окружения и параметры моделей."""
import os
from dataclasses import dataclass


GROQ_MODEL = "llama-3.3-70b-versatile"

# Тайм-ауты внешних запросов, секунды
SEARCH_TIMEOUT = 8
AI_TIMEOUT = 30
DEBUG_AI_TIMEOUT = 10
DEBUG_SEARCH_TIMEOUT = 5

# Кэш поиска
CACHE_TTL = 300
CACHE_MAX_SIZE = 200

# Ограничение длины ответа AI (лимит Telegram — 4096 символов на сообщение)
AI_ANSWER_MAX_LEN = 4000


@dataclass(frozen=True)
class Settings:
    telegram_bot_token: str
    groq_api_key: str
    serper_key: str
    webhook_url: str
    port: int
    groq_model: str = GROQ_MODEL

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", ""),
            groq_api_key=os.getenv("GROQ_API_KEY", ""),
            serper_key=os.getenv("SERPER_KEY", ""),
            webhook_url=os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com"),
            port=int(os.getenv("PORT", 8080)),
        )

    def validate(self) -> None:
        """Вызывается при старте приложения, а не при импорте — чтобы тесты работали без токена."""
        if not self.telegram_bot_token:
            raise RuntimeError("❌ TELEGRAM_BOT_TOKEN не задан!")
