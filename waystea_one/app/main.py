import asyncio
import datetime
import logging
import random

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.bot import bot, dispatcher
from app.config import settings
from app.db import get_session, init_models
from app.health import heartbeat, mark_started, run_health_server
from app.services.brew import send_feedback_prompts
from app.services.guest import send_guest_questions
from app.services.music import send_music_nudges
from app.services.quiz import send_quiz_round
from app.services.scenario_intake import propose_internet_questions
from app.services.reminders import check_reminders
from app.services.reports import build_daily_report
from app.services.revenue_reminders import send_revenue_reminders
from app.services.tasks import sync_stale_tasks_to_templates
from app.services.upsell import send_upsell_nudges
from scripts.seed_knowledge_base import seed as seed_knowledge_base
from scripts.seed_guest_scenarios import seed as seed_guest_scenarios
from scripts.seed_quiz import seed as seed_quiz
from scripts.seed_stores import seed as seed_stores
from scripts.seed_task_templates import seed as seed_task_templates

logging.basicConfig(level=logging.INFO)


async def _heartbeat_job() -> None:
    """Liveness probe behind `/health` (app/health.py). Deliberately makes a
    real Telegram round-trip rather than just stamping a timestamp: the
    failure worth catching is "process is up, scheduler is running, but the
    bot is no longer talking to Telegram" (revoked token, wedged session),
    which a self-referential heartbeat would happily report as healthy.
    Failing to stamp is the signal — the heartbeat goes stale and /health
    starts answering 503, which is what the watchdog workflow alerts on.
    """
    try:
        await bot.get_me()
    except Exception:
        logging.getLogger(__name__).exception("Heartbeat: Telegram unreachable")
        return
    heartbeat()


# The knowledge check fires somewhere between these hours, local time.
QUIZ_WINDOW_START_HOUR = 13
QUIZ_WINDOW_END_HOUR = 17
# Ситуация у прилавка — ближе к обеду, когда поток гостей обычно спокойнее
GUEST_QUESTION_HOUR = 12


def _schedule_quiz_round(scheduler: AsyncIOScheduler) -> None:
    delay_minutes = random.randint(0, (QUIZ_WINDOW_END_HOUR - QUIZ_WINDOW_START_HOUR) * 60)
    scheduler.add_job(
        send_quiz_round,
        "date",
        run_date=datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(minutes=delay_minutes),
        args=[bot, get_session],
    )


async def send_daily_report() -> None:
    async with get_session() as session:
        report = await build_daily_report(session)
    await bot.send_message(settings.owner_telegram_id, report)


async def main() -> None:
    # Bind the HTTP port FIRST, before any slow startup work. Render's free
    # Web Service (and the UptimeRobot keep-alive that pings it) expect the
    # service to answer on $PORT quickly after boot; if the health endpoint
    # only came up AFTER init_models + all three seeders + sync + webhook
    # cleanup (30-60s on a cold DB), Render/UptimeRobot see the URL as
    # "down" the whole time and the service can be marked unhealthy. The
    # health server is a static responder that touches no DB, so it's safe
    # to start immediately; the rest of init runs right after.
    await run_health_server(settings.port)

    mark_started(paused=settings.paused)

    if settings.paused:
        # Maintenance mode (BOT_PAUSED): the HTTP port stays bound so Render
        # keeps the service healthy and the keep-alive workflow keeps
        # succeeding, but nothing else starts — no DB init, no seeding, no
        # scheduler, no polling. Employees' messages simply go unanswered
        # (Telegram queues them; the drop_pending_updates below discards the
        # backlog on resume, so nothing replays at once).
        logging.getLogger(__name__).warning(
            "BOT_PAUSED is set — maintenance mode. Health endpoint is up; "
            "polling, scheduler and seeding are all disabled. Unset BOT_PAUSED "
            "and restart to resume."
        )
        await asyncio.Event().wait()
        return

    await init_models()
    # Free hosting tiers (e.g. Render's free Web Service) often don't offer
    # shell/one-off-job access to run `python -m scripts.seed_*` by hand, so
    # run the (idempotent — see each script) seeders on every boot instead.
    await seed_stores()
    await seed_task_templates()
    await seed_knowledge_base()
    await seed_quiz()
    await seed_guest_scenarios()

    async with get_session() as session:
        synced = await sync_stale_tasks_to_templates(session)
        if synced:
            logging.getLogger(__name__).info(
                "Synced %d open task(s) to their current template settings", synced
            )

    # drop_pending_updates=True: on Render's free tier the process restarts
    # often (redeploys, inactivity SIGTERM). Keeping pending updates caused
    # the bot to RE-PROCESS the same backlog on every restart, sending the
    # same greeting/onboarding prompt several times over (and scrambling
    # onboarding — a replayed message got captured as an employee's name).
    # Dropping the backlog on boot trades "messages sent during downtime are
    # lost" for "no duplicate/rescrambled processing", which is the better
    # deal here until the bot is on stable (non-sleeping) hosting.
    await bot.delete_webhook(drop_pending_updates=True)

    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        _heartbeat_job,
        "interval",
        seconds=settings.reminder_poll_seconds,
        next_run_time=datetime.datetime.now(datetime.timezone.utc),
    )
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
    # Owner request: check knowledge during the shift, at an unpredictable
    # moment — a fixed hour would just be waited out. A cron job at the start
    # of the window schedules the actual round at a random offset inside it.
    scheduler.add_job(
        _schedule_quiz_round,
        CronTrigger(
            hour=QUIZ_WINDOW_START_HOUR, minute=0, timezone=settings.timezone
        ),
        args=[scheduler],
    )
    # Вопрос от гостя — один раз за смену, отдельно от викторины, чтобы два
    # «учебных» сообщения не приходили подряд.
    scheduler.add_job(
        send_guest_questions,
        CronTrigger(hour=GUEST_QUESTION_HOUR, minute=15, timezone=settings.timezone),
        args=[bot, get_session],
    )
    scheduler.add_job(
        send_feedback_prompts,
        CronTrigger(hour=17, minute=30, timezone=settings.timezone),
        args=[bot, get_session],
    )
    # Раз в неделю: кандидаты в библиотеку вопросов из интернета. По
    # понедельникам утром, до открытия точек — владельцу спокойнее решать.
    scheduler.add_job(
        propose_internet_questions,
        CronTrigger(day_of_week="mon", hour=9, minute=30, timezone=settings.timezone),
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

    await dispatcher.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
