"""Feature 4 (docs/08_MVP_REQUIREMENTS.md §8, docs/02_OPERATION_SYSTEM.md §10):
Reminder System. Polled periodically by APScheduler (see app/main.py) rather
than scheduled per-task — simplest correct option for MVP scale (a handful
of tasks across 3 stores).
"""
import datetime
import logging

from sqlalchemy import select

from app.config import settings
from app.models import Employee, Task, TaskStatus

logger = logging.getLogger(__name__)

OPEN_STATUSES = (TaskStatus.CREATED.value, TaskStatus.WAITING_PROOF.value)


async def check_reminders(bot, session_factory) -> None:
    now = datetime.datetime.now(datetime.timezone.utc)
    first_cutoff = now - datetime.timedelta(minutes=settings.first_reminder_minutes)
    second_cutoff = now - datetime.timedelta(minutes=settings.second_reminder_minutes)

    async with session_factory() as session:
        result = await session.execute(
            select(Task, Employee)
            .join(Employee, Task.employee_id == Employee.id)
            .where(Task.status.in_(OPEN_STATUSES))
        )
        rows = result.all()

        for task, employee in rows:
            created_at = task.created_at
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=datetime.timezone.utc)

            if task.second_reminder_sent_at is not None and task.owner_notified_at is None:
                await _notify_owner(bot, task, employee)
                task.owner_notified_at = now
                await session.commit()
                continue

            if created_at <= second_cutoff and task.second_reminder_sent_at is None:
                await _send_reminder(
                    bot,
                    employee.telegram_user_id,
                    f"Задача «{task.title}» ещё не закрыта.\nЕсть сложности? Нужна помощь?",
                )
                task.second_reminder_sent_at = now
                await session.commit()
                continue

            if created_at <= first_cutoff and task.first_reminder_sent_at is None:
                await _send_reminder(
                    bot,
                    employee.telegram_user_id,
                    f"Напоминаю про задачу «{task.title}» 😊\n"
                    "Когда будет возможность, отметь выполнение.",
                )
                task.first_reminder_sent_at = now
                await session.commit()


async def _send_reminder(bot, telegram_user_id: int, text: str) -> None:
    try:
        await bot.send_message(telegram_user_id, text)
    except Exception:
        logger.exception("Failed to send reminder to %s", telegram_user_id)


async def _notify_owner(bot, task: Task, employee: Employee) -> None:
    text = (
        "⚠️ Сотрудник не реагирует на напоминания.\n"
        f"Сотрудник: {employee.name}\n"
        f"Задача: {task.title}\n"
        f"Создана: {task.created_at.strftime('%Y-%m-%d %H:%M')}"
    )
    try:
        await bot.send_message(settings.owner_telegram_id, text)
    except Exception:
        logger.exception("Failed to notify owner about task %s", task.id)
