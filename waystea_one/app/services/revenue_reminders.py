"""Owner request: proactively remind whoever's on shift today at specific
stores to send the end-of-day revenue report, at a per-group time (the
market closes later, so it gets a later reminder) — instead of waiting for
them to remember on their own. Scheduled via CronTrigger in app/main.py (one
job per time), not an interval poll — this fires once a day at a fixed
clock time, unlike e.g. app/services/upsell.py's "N minutes after shift
start" nudge.
"""
import datetime
import logging

from sqlalchemy import select

from app.models import Employee, ShiftLog, ShiftRevenue, Store

logger = logging.getLogger(__name__)

REVENUE_REMINDER_TEXT = (
    "Пора прислать выручку за сегодня 😊\n"
    "Общая выручка: <сумма>\nНаличка: <сумма>\nБезнал: <сумма>"
)


async def send_revenue_reminders(bot, session_factory, store_names: list[str]) -> None:
    today = datetime.date.today()

    async with session_factory() as session:
        stores_result = await session.execute(select(Store).where(Store.name.in_(store_names)))
        store_ids = {store.id for store in stores_result.scalars()}
        if not store_ids:
            return

        shifts_result = await session.execute(
            select(ShiftLog, Employee)
            .join(Employee, ShiftLog.employee_id == Employee.id)
            .where(ShiftLog.date == today, ShiftLog.store_id.in_(store_ids))
        )
        shifts = shifts_result.all()
        if not shifts:
            return

        submitted_result = await session.execute(
            select(ShiftRevenue.employee_id).where(ShiftRevenue.date == today)
        )
        already_submitted = set(submitted_result.scalars())

    for _shift_log, employee in shifts:
        if employee.id in already_submitted:
            continue
        try:
            await bot.send_message(employee.telegram_user_id, REVENUE_REMINDER_TEXT)
        except Exception:
            logger.exception("Failed to send revenue reminder to %s", employee.telegram_user_id)
