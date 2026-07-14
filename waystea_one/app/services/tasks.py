"""Feature 2 & 3 (docs/08_MVP_REQUIREMENTS.md §6-7): Daily Tasks + Task
Verification.

Tasks are revealed a batch at a time (owner decision) rather than all at
once: `create_daily_tasks_for_shift` creates every Task row for the day
up front (so completion/reminder bookkeeping has somewhere to live) but
only stamps `sent_at` on batch 1 — the rest sit with `sent_at=None`,
invisible to the employee and excluded from `list_open_tasks` and the
reminder engine, until `advance_to_next_batch` reveals them.
"""
import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ProofType, Task, TaskStatus, TaskTemplate

COMPLETION_PHRASES = ["готово", "сделал", "сделала", "выполнил", "выполнила", "всё", "все", "ок"]


async def downgrade_stale_photo_tasks(session: AsyncSession) -> int:
    """One-time data fix: photo proof was disabled (Decision 19), but
    `create_daily_tasks_for_shift` copies `proof_type` from the template
    onto the `Task` row at creation time and never revisits already-created
    rows. Any employee whose tasks for today were created before that
    change is stuck being asked for a photo forever. Run at every boot
    (idempotent — after the first run there's nothing left to downgrade,
    since templates no longer produce PHOTO tasks).
    """
    result = await session.execute(
        select(Task).where(
            Task.proof_type == ProofType.PHOTO.value,
            Task.status.in_((TaskStatus.CREATED.value, TaskStatus.WAITING_PROOF.value)),
        )
    )
    stale_tasks = list(result.scalars())
    for task in stale_tasks:
        task.proof_type = ProofType.COMMENT.value
    if stale_tasks:
        await session.commit()
    return len(stale_tasks)


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

    Returns only the batch-1 tasks (already marked `sent_at=now`) — these
    are what the caller should actually show the employee first. Later
    batches exist in the DB but stay hidden until `advance_to_next_batch`.
    """
    date = date or datetime.date.today()
    now = datetime.datetime.now(datetime.timezone.utc)

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

    lowest_batch = min((t.batch for t in templates), default=1)

    created = []
    for template in templates:
        if template.id in existing_template_ids:
            continue
        is_first_batch = template.batch == lowest_batch
        task = Task(
            template_id=template.id,
            employee_id=employee_id,
            store_id=store_id,
            date=date,
            title=template.title,
            requires_proof=template.requires_proof,
            proof_type=template.proof_type,
            verification_criteria=template.verification_criteria,
            batch=template.batch,
            status=TaskStatus.CREATED.value,
            sent_at=now if is_first_batch else None,
        )
        session.add(task)
        created.append(task)

    if created:
        await session.commit()
        for task in created:
            await session.refresh(task)
    return [task for task in created if task.sent_at is not None]


async def advance_to_next_batch(
    session: AsyncSession, employee_id: int, date: datetime.date | None = None
) -> list[Task]:
    """Call after completing a task. If every currently-visible task for
    today is COMPLETED, reveals the next batch (lowest batch number among
    tasks still `sent_at is None`) and returns it — otherwise returns [].
    """
    date = date or datetime.date.today()

    visible_result = await session.execute(
        select(Task).where(
            Task.employee_id == employee_id,
            Task.date == date,
            Task.sent_at.is_not(None),
        )
    )
    visible_tasks = list(visible_result.scalars())
    if any(t.status != TaskStatus.COMPLETED.value for t in visible_tasks):
        return []

    hidden_result = await session.execute(
        select(Task).where(
            Task.employee_id == employee_id,
            Task.date == date,
            Task.sent_at.is_(None),
        )
    )
    hidden_tasks = list(hidden_result.scalars())
    if not hidden_tasks:
        return []

    next_batch = min(t.batch for t in hidden_tasks)
    now = datetime.datetime.now(datetime.timezone.utc)
    to_reveal = [t for t in hidden_tasks if t.batch == next_batch]
    for task in to_reveal:
        task.sent_at = now
    await session.commit()
    for task in to_reveal:
        await session.refresh(task)
    return to_reveal


async def list_open_tasks(
    session: AsyncSession, employee_id: int, date: datetime.date | None = None
) -> list[Task]:
    """Only currently-visible (sent) tasks count as "open" for things like
    matching a bare "готово" to exactly one task — a task the employee
    hasn't been shown yet shouldn't be completable by accident.
    """
    date = date or datetime.date.today()
    result = await session.execute(
        select(Task).where(
            Task.employee_id == employee_id,
            Task.date == date,
            Task.status == TaskStatus.CREATED.value,
            Task.sent_at.is_not(None),
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
