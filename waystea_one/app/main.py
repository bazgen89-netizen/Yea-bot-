import asyncio
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.bot import bot, dispatcher
from app.config import settings
from app.db import get_session, init_models
from app.health import run_health_server
from app.services.reminders import check_reminders
from app.services.reports import build_daily_report
from app.services.upsell import send_upsell_nudges
from scripts.seed_knowledge_base import seed as seed_knowledge_base
from scripts.seed_stores import seed as seed_stores
from scripts.seed_task_templates import seed as seed_task_templates

logging.basicConfig(level=logging.INFO)


async def send_daily_report() -> None:
    async with get_session() as session:
        report = await build_daily_report(session)
    await bot.send_message(settings.owner_telegram_id, report)


async def main() -> None:
    await init_models()
    # Free hosting tiers (e.g. Render's free Web Service) often don't offer
    # shell/one-off-job access to run `python -m scripts.seed_*` by hand, so
    # run the (idempotent — see each script) seeders on every boot instead.
    await seed_stores()
    await seed_task_templates()
    await seed_knowledge_base()

    await bot.delete_webhook(drop_pending_updates=True)

    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        check_reminders,
        "interval",
        seconds=settings.reminder_poll_seconds,
        args=[bot, get_session],
    )
    scheduler.add_job(
        send_upsell_nudges,
        "interval",
        seconds=settings.reminder_poll_seconds,
        args=[bot, get_session],
    )
    scheduler.add_job(
        send_daily_report,
        CronTrigger(hour=settings.daily_report_hour, minute=settings.daily_report_minute),
    )
    scheduler.start()

    await run_health_server(settings.port)
    await dispatcher.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
