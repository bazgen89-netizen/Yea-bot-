"""Конфигурация приложения: переменные окружения и параметры моделей."""
import os
from dataclasses import dataclass


# Провайдер по умолчанию — Groq. Любой OpenAI-совместимый шлюз подключается
# через AI_BASE_URL + AI_API_KEY + AI_MODEL без правки кода.
AI_BASE_URL = "https://api.groq.com/openai/v1"
AI_MODEL = "llama-3.3-70b-versatile"

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
    ai_api_key: str
    serper_key: str
    webhook_url: str
    port: int
    ai_model: str = AI_MODEL
    ai_base_url: str = AI_BASE_URL

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", ""),
            # GROQ_* остаются рабочими, чтобы не переделывать уже настроенный деплой.
            ai_api_key=os.getenv("AI_API_KEY") or os.getenv("GROQ_API_KEY", ""),
            serper_key=os.getenv("SERPER_KEY", ""),
            webhook_url=os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com"),
            port=int(os.getenv("PORT", 8080)),
            ai_model=os.getenv("AI_MODEL") or os.getenv("GROQ_MODEL") or AI_MODEL,
            ai_base_url=(os.getenv("AI_BASE_URL") or AI_BASE_URL).rstrip("/"),
        )

    def validate(self) -> None:
        """Вызывается при старте приложения, а не при импорте — чтобы тесты работали без токена."""
        if not self.telegram_bot_token:
            raise RuntimeError("❌ TELEGRAM_BOT_TOKEN не задан!")
