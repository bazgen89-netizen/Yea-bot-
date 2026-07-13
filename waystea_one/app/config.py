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
    # Optional: the knowledge-base Q&A feature degrades to a fallback message
    # (see app/services/ai.py) rather than crashing when this isn't set.
    anthropic_api_key: str = os.environ.get("ANTHROPIC_API_KEY", "")


settings = Settings()
