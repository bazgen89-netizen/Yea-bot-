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

# Магазины на картах: тайм-аут запросов и кэш карточек
STORES_TIMEOUT = 10
STORES_CACHE_TTL = 1800
STORES_CACHE_MAX_SIZE = 100

# Мониторинг отзывов
REVIEWS_POLL_INTERVAL = 1800
REVIEWS_PER_STORE = 10

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
    # Магазины на картах (все необязательные — без них раздел просто отключён)
    yandex_maps_key: str = ""
    twogis_key: str = ""
    twogis_reviews_key: str = ""
    google_places_key: str = ""
    google_gbp_client_id: str = ""
    google_gbp_client_secret: str = ""
    google_gbp_refresh_token: str = ""
    stores_file: str = "stores.json"
    reviews_state_file: str = "reviews_state.json"
    admin_chat_id: int = 0
    reviews_poll_interval: int = REVIEWS_POLL_INTERVAL

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", ""),
            groq_api_key=os.getenv("GROQ_API_KEY", ""),
            serper_key=os.getenv("SERPER_KEY", ""),
            webhook_url=os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com"),
            port=int(os.getenv("PORT", 8080)),
            yandex_maps_key=os.getenv("YANDEX_MAPS_KEY", ""),
            twogis_key=os.getenv("TWOGIS_KEY", ""),
            twogis_reviews_key=os.getenv("TWOGIS_REVIEWS_KEY", ""),
            google_places_key=os.getenv("GOOGLE_PLACES_KEY", ""),
            google_gbp_client_id=os.getenv("GOOGLE_GBP_CLIENT_ID", ""),
            google_gbp_client_secret=os.getenv("GOOGLE_GBP_CLIENT_SECRET", ""),
            google_gbp_refresh_token=os.getenv("GOOGLE_GBP_REFRESH_TOKEN", ""),
            stores_file=os.getenv("STORES_FILE", "stores.json"),
            reviews_state_file=os.getenv("REVIEWS_STATE_FILE", "reviews_state.json"),
            admin_chat_id=int(os.getenv("ADMIN_CHAT_ID", 0) or 0),
            reviews_poll_interval=int(
                os.getenv("REVIEWS_POLL_INTERVAL", REVIEWS_POLL_INTERVAL)
            ),
        )

    def validate(self) -> None:
        """Вызывается при старте приложения, а не при импорте — чтобы тесты работали без токена."""
        if not self.telegram_bot_token:
            raise RuntimeError("❌ TELEGRAM_BOT_TOKEN не задан!")
