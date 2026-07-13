import asyncio
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.bot import bot, dispatcher
from app.config import settings
from app.db import get_session, init_models
from app.services.reminders import check_reminders

logging.basicConfig(level=logging.INFO)


async def main() -> None:
    await init_models()
    await bot.delete_webhook(drop_pending_updates=True)

    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        check_reminders,
        "interval",
        seconds=settings.reminder_poll_seconds,
        args=[bot, get_session],
    )
    scheduler.start()

    await dispatcher.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
