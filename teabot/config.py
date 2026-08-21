"""Конфигурация приложения: переменные окружения и параметры моделей."""
import os
from dataclasses import dataclass, field
from typing import Mapping, Optional


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

# Соцсети: как часто опрашивать площадки и сколько элементов брать за раз
SOCIAL_POLL_INTERVAL = 180
SOCIAL_FETCH_LIMIT = 10
# Не больше карточек за один опрос — остальное сворачивается в сводку
SOCIAL_MAX_CARDS = 8


def _as_bool(value: str) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on", "да"}


@dataclass(frozen=True)
class SocialSettings:
    """Настройки единого хаба соцсетей.

    admin_chat_id — чат, куда стекается всё из всех сетей и откуда
    разрешено управление. Без него хаб работает только по командам.
    """
    admin_chat_id: Optional[int]
    poll_interval: int
    autopilot: bool
    state_path: str
    env: Mapping[str, str] = field(default_factory=dict, repr=False)

    @classmethod
    def from_env(cls, env: Optional[Mapping[str, str]] = None) -> "SocialSettings":
        env = os.environ if env is None else env
        raw_chat = (env.get("SOCIAL_ADMIN_CHAT_ID") or env.get("YOUR_TELEGRAM_ID") or "").strip()
        try:
            admin_chat_id = int(raw_chat) if raw_chat else None
        except ValueError:
            admin_chat_id = None
        try:
            poll_interval = max(30, int(env.get("SOCIAL_POLL_INTERVAL", SOCIAL_POLL_INTERVAL)))
        except ValueError:
            poll_interval = SOCIAL_POLL_INTERVAL
        return cls(
            admin_chat_id=admin_chat_id,
            poll_interval=poll_interval,
            autopilot=_as_bool(env.get("SOCIAL_AUTOPILOT", "")),
            state_path=env.get("SOCIAL_STATE_PATH", "/tmp/teabot_social_seen.json"),
            env=dict(env),
        )

    @property
    def polling_enabled(self) -> bool:
        """Автономный опрос имеет смысл только если известно, куда слать."""
        return self.admin_chat_id is not None


@dataclass(frozen=True)
class Settings:
    telegram_bot_token: str
    groq_api_key: str
    serper_key: str
    webhook_url: str
    port: int
    groq_model: str = GROQ_MODEL
    social: Optional[SocialSettings] = None

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            telegram_bot_token=os.getenv("TELEGRAM_BOT_TOKEN", ""),
            groq_api_key=os.getenv("GROQ_API_KEY", ""),
            serper_key=os.getenv("SERPER_KEY", ""),
            webhook_url=os.getenv("RENDER_EXTERNAL_URL", "https://teabot-490p.onrender.com"),
            port=int(os.getenv("PORT", 8080)),
            social=SocialSettings.from_env(),
        )

    def validate(self) -> None:
        """Вызывается при старте приложения, а не при импорте — чтобы тесты работали без токена."""
        if not self.telegram_bot_token:
            raise RuntimeError("❌ TELEGRAM_BOT_TOKEN не задан!")
