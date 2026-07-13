"""Feature 2 & 3 (docs/08_MVP_REQUIREMENTS.md §6-7): Daily Tasks + Task
Verification.
"""
import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Task, TaskStatus, TaskTemplate

COMPLETION_PHRASES = ["готово", "сделал", "сделала", "выполнил", "выполнила", "всё", "все", "ок"]


def is_completion_phrase(text: str) -> bool:
    from app.services.store_matcher import normalize

    normalized = normalize(text).strip("!.,? ")
    return normalized in COMPLETION_PHRASES


async def create_daily_tasks_for_shift(
    session: AsyncSession,
    employee_id: int,
    store_id: int,
    date: datetime.date | None = None,
) -> list[Task]:
    """Instantiate today's tasks for this employee from active templates
    that apply to their store (or to every store, if store_id is NULL).
    Safe to call more than once for the same shift — already-created tasks
    are skipped via the (employee, template, date) unique constraint.
    """
    date = date or datetime.date.today()

    templates_result = await session.execute(
        select(TaskTemplate).where(
            TaskTemplate.active.is_(True),
            (TaskTemplate.store_id == store_id) | (TaskTemplate.store_id.is_(None)),
        )
    )
    templates = templates_result.scalars().all()

    existing_result = await session.execute(
        select(Task.template_id).where(
            Task.employee_id == employee_id, Task.date == date
        )
    )
    existing_template_ids = {row for row in existing_result.scalars() if row is not None}

    created = []
    for template in templates:
        if template.id in existing_template_ids:
            continue
        task = Task(
            template_id=template.id,
            employee_id=employee_id,
            store_id=store_id,
            date=date,
            title=template.title,
            requires_proof=template.requires_proof,
            proof_type=template.proof_type,
            verification_criteria=template.verification_criteria,
            status=TaskStatus.CREATED.value,
        )
        session.add(task)
        created.append(task)

    if created:
        await session.commit()
        for task in created:
            await session.refresh(task)
    return created


async def list_open_tasks(
    session: AsyncSession, employee_id: int, date: datetime.date | None = None
) -> list[Task]:
    date = date or datetime.date.today()
    result = await session.execute(
        select(Task).where(
            Task.employee_id == employee_id,
            Task.date == date,
            Task.status == TaskStatus.CREATED.value,
        )
    )
    return list(result.scalars())


async def get_waiting_proof_task(session: AsyncSession, employee_id: int) -> Task | None:
    result = await session.execute(
        select(Task).where(
            Task.employee_id == employee_id,
            Task.status == TaskStatus.WAITING_PROOF.value,
        )
    )
    return result.scalars().first()


async def get_task(session: AsyncSession, task_id: int) -> Task | None:
    return await session.get(Task, task_id)


async def start_completion(session: AsyncSession, task: Task) -> str:
    """Either completes the task outright, or moves it to WAITING_PROOF and
    returns which kind of proof to ask for. Returns "photo", "comment", or
    "" (task was completed with no proof needed).
    """
    if not task.requires_proof:
        await complete_task(session, task)
        return ""

    task.status = TaskStatus.WAITING_PROOF.value
    await session.commit()
    return task.proof_type


async def complete_task(session: AsyncSession, task: Task) -> None:
    task.status = TaskStatus.COMPLETED.value
    task.completed_at = datetime.datetime.now(datetime.timezone.utc)
    await session.commit()
