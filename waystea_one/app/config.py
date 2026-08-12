import os

from dotenv import load_dotenv

load_dotenv()


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
    # Only used by app/health.py — Render (and similar free-tier hosts) expect
    # a Web Service to answer on $PORT even though the bot itself is a
    # polling client, not an HTTP server.
    port: int = int(os.environ.get("PORT", "8080"))
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
