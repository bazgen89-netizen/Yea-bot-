"""Batch reveal/report logic (app/services/tasks.py).

These run against an in-memory SQLite database rather than pure functions:
the batching bugs this file covers (a batch report listing an earlier
batch's tasks, a closed batch being re-reported) only show up in the
interaction between `Task` rows and the templates they were created from,
so there's nothing to test without persistence. `Base.metadata.create_all`
is used directly instead of `app.db.init_models`, whose
MANUAL_COLUMN_MIGRATIONS are Postgres-specific DDL.
"""
import datetime

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models import Base, Employee, Task, TaskStatus, TaskTemplate
from app.services.tasks import (
    advance_to_next_batch,
    create_daily_tasks_for_shift,
    sync_stale_tasks_to_templates,
)

TODAY = datetime.date(2026, 8, 14)


# `Store.aliases` is a Postgres ARRAY column, which SQLite can't render — and
# none of the batching logic reads a Store row anyway (it only carries
# store_id around), so the stores table is left out of the test schema and
# STORE_ID is just a plain id. SQLite doesn't enforce the FK by default.
STORE_ID = 1
_TEST_TABLES = ("employees", "task_templates", "tasks")


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    tables = [Base.metadata.tables[name] for name in _TEST_TABLES]
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=tables)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


async def _setup(session, template_specs):
    """template_specs: list of (title, batch). Returns (employee_id, store_id)."""
    employee = Employee(telegram_user_id=1, name="Тест")
    session.add(employee)
    await session.commit()
    for title, batch in template_specs:
        session.add(TaskTemplate(title=title, batch=batch, requires_proof=False))
    await session.commit()
    return employee.id, STORE_ID


async def _complete_all_visible(session, employee_id):
    from sqlalchemy import select

    result = await session.execute(
        select(Task).where(Task.employee_id == employee_id, Task.sent_at.is_not(None))
    )
    for task in result.scalars():
        task.status = TaskStatus.COMPLETED.value
    await session.commit()


@pytest.mark.asyncio
async def test_second_batch_report_excludes_first_batch_tasks(session):
    employee_id, store_id = await _setup(
        session, [("A1", 1), ("A2", 1), ("B1", 2), ("B2", 2)]
    )
    await create_daily_tasks_for_shift(session, employee_id, store_id, TODAY)

    await _complete_all_visible(session, employee_id)
    closed, revealed = await advance_to_next_batch(session, employee_id, TODAY)
    assert [t.title for t in closed] == ["A1", "A2"]
    assert [t.title for t in revealed] == ["B1", "B2"]

    await _complete_all_visible(session, employee_id)
    closed, revealed = await advance_to_next_batch(session, employee_id, TODAY)
    assert [t.title for t in closed] == ["B1", "B2"], "блок 2 не должен содержать задачи блока 1"
    assert revealed == []


@pytest.mark.asyncio
async def test_not_yet_revealed_task_picks_up_edited_batch(session):
    """The seeder upserts templates by title on every boot, so a task created
    before a mid-day redeploy keeps the batch number it was created with while
    its template moves on. Render restarts often, so this is routine rather
    than exotic. A task the employee hasn't seen yet should follow the edited
    checklist.
    """
    from sqlalchemy import select

    employee_id, store_id = await _setup(session, [("A1", 1), ("B1", 2)])
    await create_daily_tasks_for_shift(session, employee_id, store_id, TODAY)

    template = (
        await session.execute(select(TaskTemplate).where(TaskTemplate.title == "B1"))
    ).scalar_one()
    template.batch = 3
    await session.commit()

    await sync_stale_tasks_to_templates(session)

    task = (await session.execute(select(Task).where(Task.title == "B1"))).scalar_one()
    assert task.batch == 3, "скрытая задача должна подтянуть batch из шаблона"


@pytest.mark.asyncio
async def test_already_revealed_task_keeps_its_batch(session):
    """The mirror of the test above: renumbering a task the employee is already
    working through would regroup blocks under them, and could drop it into a
    block that was already reported to the owner.
    """
    from sqlalchemy import select

    employee_id, store_id = await _setup(session, [("A1", 1), ("A2", 1), ("B1", 2)])
    await create_daily_tasks_for_shift(session, employee_id, store_id, TODAY)

    template = (
        await session.execute(select(TaskTemplate).where(TaskTemplate.title == "A2"))
    ).scalar_one()
    template.batch = 2
    await session.commit()

    await sync_stale_tasks_to_templates(session)

    task = (await session.execute(select(Task).where(Task.title == "A2"))).scalar_one()
    assert task.batch == 1, "показанная задача не должна менять блок под сотрудником"


@pytest.mark.asyncio
async def test_reused_batch_number_does_not_pull_in_earlier_block(session):
    """A template seeded mid-shift can land on a batch number that has already
    been revealed and reported. The new task must be reported on its own, not
    together with the earlier block's tasks all over again.
    """
    employee_id, store_id = await _setup(session, [("A1", 1), ("A2", 1)])
    await create_daily_tasks_for_shift(session, employee_id, store_id, TODAY)
    await _complete_all_visible(session, employee_id)

    closed, _ = await advance_to_next_batch(session, employee_id, TODAY)
    assert [t.title for t in closed] == ["A1", "A2"]

    # New checklist item seeded mid-shift, reusing batch 1.
    session.add(TaskTemplate(title="A3", batch=1, requires_proof=False))
    await session.commit()
    await create_daily_tasks_for_shift(session, employee_id, store_id, TODAY)
    await _complete_all_visible(session, employee_id)

    closed, _ = await advance_to_next_batch(session, employee_id, TODAY)
    assert [t.title for t in closed] == ["A3"], "в блок не должны попасть уже отчитанные задачи"


@pytest.mark.asyncio
async def test_closed_final_batch_is_not_reported_twice(session):
    """`advance_to_next_batch` is called after every completion event, including
    text replies. Once the last batch closed there is nothing left to reveal,
    so a second call must not hand the owner the same "block done" report again.
    """
    employee_id, store_id = await _setup(session, [("A1", 1), ("A2", 1)])
    await create_daily_tasks_for_shift(session, employee_id, store_id, TODAY)
    await _complete_all_visible(session, employee_id)

    closed, _ = await advance_to_next_batch(session, employee_id, TODAY)
    assert [t.title for t in closed] == ["A1", "A2"]

    closed_again, _ = await advance_to_next_batch(session, employee_id, TODAY)
    assert closed_again == [], "закрытый блок не должен отправляться владельцу повторно"
