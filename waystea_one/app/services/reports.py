"""Feature 6 (docs/08_MVP_REQUIREMENTS.md §10, docs/02_OPERATION_SYSTEM.md §15):
Daily Owner Report.
"""
import datetime
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import (
    Employee,
    MusicCheck,
    PurchaseRequest,
    ShiftLog,
    ShiftRevenue,
    Store,
    Task,
    TaskStatus,
)
from app.services.revenue import RevenueReport

logger = logging.getLogger(__name__)


async def build_daily_report(session: AsyncSession, date: datetime.date | None = None) -> str:
    date = date or datetime.date.today()

    shifts_result = await session.execute(
        select(ShiftLog, Employee, Store)
        .join(Employee, ShiftLog.employee_id == Employee.id)
        .join(Store, ShiftLog.store_id == Store.id)
        .where(ShiftLog.date == date)
    )
    shifts = shifts_result.all()

    tasks_result = await session.execute(select(Task).where(Task.date == date))
    tasks = list(tasks_result.scalars())
    completed = sum(1 for t in tasks if t.status == TaskStatus.COMPLETED.value)
    total_tasks = len(tasks)
    escalated = [t for t in tasks if t.owner_notified_at is not None]

    purchases_result = await session.execute(
        select(PurchaseRequest).where(
            PurchaseRequest.created_at >= datetime.datetime.combine(
                date, datetime.time.min, tzinfo=datetime.timezone.utc
            )
        )
    )
    purchases = list(purchases_result.scalars())

    revenue_result = await session.execute(select(ShiftRevenue).where(ShiftRevenue.date == date))
    revenues = list(revenue_result.scalars())

    music_result = await session.execute(
        select(MusicCheck, Employee)
        .join(Employee, MusicCheck.employee_id == Employee.id)
        .where(
            MusicCheck.created_at >= datetime.datetime.combine(
                date, datetime.time.min, tzinfo=datetime.timezone.utc
            )
        )
    )
    music_checks = music_result.all()

    lines = [f"WAYSTEA ONE — отчёт за {date.isoformat()}", ""]

    lines.append("Смены:")
    if shifts:
        for shift_log, employee, store in shifts:
            lines.append(f"  {store.name}: {employee.name}")
    else:
        lines.append("  Нет подтверждённых смен.")
    lines.append("")

    if total_tasks:
        pct_done = round(completed / total_tasks * 100)
        lines.append(f"Задачи: выполнено {completed}/{total_tasks} ({pct_done}%)")
    else:
        lines.append("Задачи: сегодня задач не было.")
    lines.append("")

    lines.append(f"Закупки: {len(purchases)} позиций")
    for purchase in purchases:
        lines.append(f"  - {purchase.product}")
    lines.append("")

    if revenues:
        total_revenue = sum(r.total for r in revenues)
        total_cash = sum(r.cash for r in revenues)
        total_non_cash = sum(r.non_cash for r in revenues)
        lines.append(
            f"Выручка: {total_revenue} (нал {total_cash} / безнал {total_non_cash})"
        )
    else:
        lines.append("Выручка: ещё не внесена.")
    lines.append("")

    if escalated:
        lines.append(f"Проблемы: {len(escalated)}")
        for task in escalated:
            lines.append(f"  - {task.title} (сотрудник не отреагировал на напоминания)")
    else:
        lines.append("Проблемы: не обнаружено.")
    lines.append("")

    lines.append("Музыка в зале:")
    if music_checks:
        for check, employee in music_checks:
            lines.append(f"  - {employee.name}: {check.note}")
    else:
        lines.append("  Пока нет отметок за сегодня.")

    return "\n".join(lines)


# Words in a task comment that signal something is missing / running out /
# needs attention, so it can be pulled into the document's "не хватает"
# section instead of the owner having to read every comment to spot it.
_SHORTAGE_MARKERS = [
    "нет",
    "нету",
    "мало",
    "не хватает",
    "нехватает",
    "закончил",
    "закончится",
    "заканчива",
    "пусто",
    "отсутству",
    "надо",
    "нужно",
    "докупить",
    "привезти",
    "сломан",
    "не работает",
    "грязн",
]


def _looks_like_shortage(comment: str | None) -> bool:
    if not comment:
        return False
    lowered = comment.lower()
    return any(marker in lowered for marker in _SHORTAGE_MARKERS)


def build_batch_document(
    employee_name: str, store_name: str, batch_number: int, completed_batch: list[Task]
) -> tuple[str, str]:
    """Build the per-batch report document (owner request: a formed document
    after each block, with anything missing called out). Returns
    `(filename, text)` — pure, so it's unit-testable without a bot/DB.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    lines = [
        f"WAYSTEA ONE — отчёт по блоку задач {batch_number}",
        f"Магазин: {store_name}",
        f"Сотрудник: {employee_name}",
        f"Дата: {now.strftime('%Y-%m-%d %H:%M')} UTC",
        "",
        "Выполненные задачи:",
    ]
    for task in completed_batch:
        line = f"  ✅ {task.title}"
        if task.proof_comment:
            line += f" — {task.proof_comment}"
        lines.append(line)

    shortages = [t for t in completed_batch if _looks_like_shortage(t.proof_comment)]
    lines.append("")
    if shortages:
        lines.append("⚠️ ТРЕБУЕТ ВНИМАНИЯ / НЕ ХВАТАЕТ:")
        for task in shortages:
            lines.append(f"  - {task.title}: {task.proof_comment}")
    else:
        lines.append("Нехватки не отмечено.")

    filename = f"otchet_blok_{batch_number}_{store_name}.txt".replace(" ", "_")
    return filename, "\n".join(lines)


async def notify_owner_batch_progress(
    bot, employee: Employee, store: Store | None, completed_batch: list[Task]
) -> None:
    """Per owner decision: after each task batch closes, form a document and
    send it to the owner — with anything the employee flagged as missing/
    running out pulled into a dedicated "не хватает" section so it's not
    buried in the per-task comments.
    """
    if not completed_batch:
        return

    batch_number = completed_batch[0].batch
    store_name = store.name if store else "?"
    filename, document_text = build_batch_document(
        employee.name, store_name, batch_number, completed_batch
    )

    shortage_count = sum(1 for t in completed_batch if _looks_like_shortage(t.proof_comment))
    caption = f"✅ {employee.name} ({store_name}): закрыт блок задач {batch_number}"
    if shortage_count:
        caption += f"\n⚠️ Требует внимания: {shortage_count}"

    from aiogram.types import BufferedInputFile

    document = BufferedInputFile(document_text.encode("utf-8"), filename=filename)
    try:
        await bot.send_document(settings.owner_telegram_id, document, caption=caption)
    except Exception:
        logger.exception("Failed to send batch %s document to owner", batch_number)
        # Fall back to a plain text message so the update isn't lost entirely
        # if sending the document fails.
        try:
            await bot.send_message(settings.owner_telegram_id, f"{caption}\n\n{document_text}")
        except Exception:
            logger.exception("Fallback batch %s message to owner also failed", batch_number)


async def notify_owner_revenue_submitted(
    bot, employee: Employee, store: Store | None, report: RevenueReport
) -> None:
    """Per owner decision: send the end-of-day revenue for a store to the
    owner the moment it's submitted, not only rolled into the once-a-day
    report.
    """
    store_name = store.name if store else "?"
    text = (
        f"💰 Выручка — {store_name} ({employee.name}):\n"
        f"Общая выручка: {report.total}\n"
        f"Наличка: {report.cash}\n"
        f"Безнал: {report.non_cash}"
    )
    try:
        await bot.send_message(settings.owner_telegram_id, text)
    except Exception:
        logger.exception("Failed to notify owner about revenue for store %s", store_name)
