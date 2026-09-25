import os

from dotenv import load_dotenv

load_dotenv()


# Остановлен по просьбе владельца. Строка ниже — единственное, что нужно
# поменять, чтобы бот снова заработал после деплоя.
PAUSED_BY_DEFAULT = True

_PAUSE_ON = {"1", "true", "yes", "on"}
_PAUSE_OFF = {"0", "false", "no", "off"}


def pause_requested(env_value: str | None) -> bool:
    """Стоит ли бот на паузе.

    Явное значение BOT_PAUSED сильнее вшитого: так владелец снимает паузу
    сам, из панели Render, не дожидаясь правки кода и деплоя. Пустая или
    отсутствующая переменная — значит решает PAUSED_BY_DEFAULT, а не
    «работаем»: иначе вшитая остановка снималась бы случайным удалением
    переменной.
    """
    value = (env_value or "").strip().lower()
    if value in _PAUSE_ON:
        return True
    if value in _PAUSE_OFF:
        return False
    return PAUSED_BY_DEFAULT


class Settings:
    bot_token: str = os.environ["BOT_TOKEN"]
    database_url: str = os.environ["DATABASE_URL"]
    owner_telegram_id: int = int(os.environ["OWNER_TELEGRAM_ID"])
    first_reminder_minutes: int = int(os.environ.get("FIRST_REMINDER_MINUTES", "30"))
    second_reminder_minutes: int = int(os.environ.get("SECOND_REMINDER_MINUTES", "60"))
    reminder_poll_seconds: int = int(os.environ.get("REMINDER_POLL_SECONDS", "300"))
    daily_report_hour: int = int(os.environ.get("DAILY_REPORT_HOUR", "21"))
    daily_report_minute: int = int(os.environ.get("DAILY_REPORT_MINUTE", "0"))
    # All CronTrigger-scheduled jobs (daily report, revenue reminders) use
    # this timezone explicitly — without it, APScheduler falls back to the
    # server's local timezone (UTC on Render), so "20:55" would fire at
    # 20:55 UTC instead of 20:55 in the stores' actual timezone.
    timezone: str = os.environ.get("TIMEZONE", "Europe/Moscow")
    # Optional: the knowledge-base Q&A feature degrades to a fallback message
    # (see app/services/ai.py) rather than crashing when this isn't set.
    anthropic_api_key: str = os.environ.get("ANTHROPIC_API_KEY", "")
    # Поиск живых вопросов покупателей в интернете (app/services/websearch.py).
    # Тот же ключ, что у чайного бота. Не задан — функция просто выключена.
    serper_key: str = os.environ.get("SERPER_KEY", "")
    # Only used by app/health.py — Render (and similar free-tier hosts) expect
    # a Web Service to answer on $PORT even though the bot itself is a
    # polling client, not an HTTP server.
    port: int = int(os.environ.get("PORT", "8080"))
    # Выключатель. В паузе app/main.py продолжает отвечать на $PORT (Render не
    # считает сервис упавшим, keep-alive и сторож работают), но не поднимает ни
    # polling, ни планировщик: ни задач, ни напоминаний, ни отчётов.
    #
    # Значение берётся из BOT_PAUSED, а если переменной нет — из PAUSED_BY_DEFAULT
    # ниже. Владелец попросил остановить бота 25.09.2026, а доступа к панели
    # Render у агента нет, поэтому выключатель вшит в код: деплой этой ветки
    # останавливает бота сам.
    #
    # Включить обратно — любым из двух способов:
    #   1. BOT_PAUSED=0 в переменных Render (кода не касается);
    #   2. PAUSED_BY_DEFAULT = False здесь и деплой.
    paused: bool = pause_requested(os.environ.get("BOT_PAUSED"))
    # Optional: a dedicated "какой чай привезти" chat/topic (see
    # app/handlers/tea_requests.py). Unset by default — the feature is off
    # until both/either are configured. TEA_REQUEST_THREAD_ID is only needed
    # if it's a forum topic inside an existing group rather than its own
    # chat; TEA_REQUEST_CHAT_ID is required either way.
    tea_request_chat_id: int | None = (
        int(os.environ["TEA_REQUEST_CHAT_ID"]) if os.environ.get("TEA_REQUEST_CHAT_ID") else None
    )
    tea_request_thread_id: int | None = (
        int(os.environ["TEA_REQUEST_THREAD_ID"])
        if os.environ.get("TEA_REQUEST_THREAD_ID")
        else None
    )


settings = Settings()
