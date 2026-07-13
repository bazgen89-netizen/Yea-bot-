"""Feature 6 (docs/08_MVP_REQUIREMENTS.md §10, docs/02_OPERATION_SYSTEM.md §15):
Daily Owner Report.
"""
import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Employee,
    PurchaseRequest,
    ShiftLog,
    ShiftRevenue,
    Store,
    Task,
    TaskStatus,
)


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

    return "\n".join(lines)
