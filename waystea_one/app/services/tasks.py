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

from app.models import Task, TaskStatus, TaskTemplate

COMPLETION_PHRASES = ["готово", "сделал", "сделала", "выполнил", "выполнила", "всё", "все", "ок"]


async def sync_stale_tasks_to_templates(session: AsyncSession) -> int:
    """`create_daily_tasks_for_shift` copies `requires_proof`/`proof_type`/
    `verification_criteria` from the template onto the `Task` row at
    creation time and never revisits already-created rows — so editing
    `scripts/seed_task_templates.py` (e.g. disabling photo proof, Decision
    19; or turning off comment proof for a simple on/off task) has no
    effect on tasks already created for someone's current shift. Run at
    every boot: for any not-yet-completed task, re-sync those three fields
    from its template if they've drifted, so an employee never gets stuck
    on a requirement the checklist doesn't actually have anymore.
    """
    result = await session.execute(
        select(Task).where(
            Task.status.in_((TaskStatus.CREATED.value, TaskStatus.WAITING_PROOF.value)),
            Task.template_id.is_not(None),
        )
    )
    open_tasks = list(result.scalars())
    if not open_tasks:
        return 0

    template_ids = {task.template_id for task in open_tasks}
    templates_result = await session.execute(
        select(TaskTemplate).where(TaskTemplate.id.in_(template_ids))
    )
    templates_by_id = {template.id: template for template in templates_result.scalars()}

    updated = 0
    for task in open_tasks:
        template = templates_by_id.get(task.template_id)
        if template is None:
            continue
        changed = (
            task.requires_proof != template.requires_proof
            or task.proof_type != template.proof_type
            or task.verification_criteria != template.verification_criteria
            or task.description != template.description
        )
        if not changed:
            continue
        task.requires_proof = template.requires_proof
        task.proof_type = template.proof_type
        task.verification_criteria = template.verification_criteria
        task.description = template.description
        # A task already sitting in WAITING_PROOF whose template no longer
        # requires proof at all should just close outright, not linger
        # waiting for a comment/photo nobody's going to send.
        if not template.requires_proof and task.status == TaskStatus.WAITING_PROOF.value:
            task.status = TaskStatus.COMPLETED.value
            task.completed_at = datetime.datetime.now(datetime.timezone.utc)
        updated += 1

    if updated:
        await session.commit()
    return updated


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
            description=template.description,
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
) -> tuple[list[Task], list[Task]]:
    """Call after completing a task. Returns `(completed_batch, revealed_batch)`:
    - `completed_batch` is the currently-visible batch, but only once every
      task in it is COMPLETED — otherwise `[]` (the batch isn't done yet).
    - `revealed_batch` is the next batch just revealed (`sent_at` stamped),
      picked as the lowest batch number among tasks still `sent_at is None`
      — `[]` if the completed batch was the last one, or if nothing's done.
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
        return [], []

    hidden_result = await session.execute(
        select(Task).where(
            Task.employee_id == employee_id,
            Task.date == date,
            Task.sent_at.is_(None),
        )
    )
    hidden_tasks = list(hidden_result.scalars())
    if not hidden_tasks:
        return visible_tasks, []

    next_batch = min(t.batch for t in hidden_tasks)
    now = datetime.datetime.now(datetime.timezone.utc)
    to_reveal = [t for t in hidden_tasks if t.batch == next_batch]
    for task in to_reveal:
        task.sent_at = now
    await session.commit()
    for task in to_reveal:
        await session.refresh(task)
    return visible_tasks, to_reveal


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
