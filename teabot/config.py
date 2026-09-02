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

# VPN: путь к списку ключей и лимит ключей на пользователя
VPN_USERS_PATH = "vpn/data/users.json"
VPN_MAX_KEYS_PER_USER = 3


def parse_admin_ids(raw: str) -> frozenset[int]:
    """Разбирает VPN_ADMINS вида "123,456"; мусор игнорируется, а не роняет старт."""
    ids = set()
    for part in raw.split(","):
        part = part.strip()
        if part.lstrip("-").isdigit():
            ids.add(int(part))
    return frozenset(ids)


@dataclass(frozen=True)
class Settings:
    telegram_bot_token: str
    groq_api_key: str
    serper_key: str
    webhook_url: str
    port: int
    vpn_admins: frozenset[int]
    vpn_profile: str
    vpn_users_path: str
    vpn_reload_cmd: str
    groq_model: str = GROQ_MODEL

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", ""),
            groq_api_key=os.getenv("GROQ_API_KEY", ""),
            serper_key=os.getenv("SERPER_KEY", ""),
            webhook_url=os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com"),
            port=int(os.getenv("PORT", 8080)),
            vpn_admins=parse_admin_ids(os.getenv("VPN_ADMINS", "")),
            vpn_profile=os.getenv("VPN_PROFILE", "ru"),
            vpn_users_path=os.getenv("VPN_USERS_PATH", VPN_USERS_PATH),
            vpn_reload_cmd=os.getenv("VPN_RELOAD_CMD", ""),
        )

    def validate(self) -> None:
        """Вызывается при старте приложения, а не при импорте — чтобы тесты работали без токена."""
        if not self.telegram_bot_token:
            raise RuntimeError("❌ TELEGRAM_BOT_TOKEN не задан!")
