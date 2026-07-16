import asyncio
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.bot import bot, dispatcher
from app.config import settings
from app.db import get_session, init_models
from app.health import run_health_server
from app.services.music import send_music_nudges
from app.services.reminders import check_reminders
from app.services.reports import build_daily_report
from app.services.revenue_reminders import send_revenue_reminders
from app.services.tasks import sync_stale_tasks_to_templates
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

    async with get_session() as session:
        synced = await sync_stale_tasks_to_templates(session)
        if synced:
            logging.getLogger(__name__).info(
                "Synced %d open task(s) to their current template settings", synced
            )

    # drop_pending_updates=False on purpose: on Render's free tier the
    # service is SIGTERM'd after ~15 min of no inbound HTTP (and on every
    # redeploy), so messages employees send while it's asleep/restarting
    # would be silently discarded if we dropped pending updates on boot.
    # Telegram retains updates ~24h, so keeping them means a "на месте"
    # sent during a short downtime is still processed once the bot wakes,
    # instead of the bot appearing to ignore it.
    await bot.delete_webhook(drop_pending_updates=False)

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
        send_music_nudges,
        "interval",
        seconds=settings.reminder_poll_seconds,
        args=[bot, get_session],
    )
    scheduler.add_job(
        send_daily_report,
        CronTrigger(
            hour=settings.daily_report_hour,
            minute=settings.daily_report_minute,
            timezone=settings.timezone,
        ),
    )
    # Owner decision: Гагарина/Черёмушки close earlier, so their revenue
    # reminder goes out at 20:55; Рынок на Студёной closes later (21:55).
    # Explicit timezone (settings.timezone, default Asia/Almaty) - without
    # it CronTrigger uses the server's local timezone (UTC on Render),
    # which would fire these hours completely off from actual local time.
    scheduler.add_job(
        send_revenue_reminders,
        CronTrigger(hour=20, minute=55, timezone=settings.timezone),
        args=[bot, get_session, ["Гагарина", "Черёмушки"]],
    )
    scheduler.add_job(
        send_revenue_reminders,
        CronTrigger(hour=21, minute=55, timezone=settings.timezone),
        args=[bot, get_session, ["Рынок на Студёной"]],
    )
    scheduler.start()

    await run_health_server(settings.port)
    await dispatcher.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
