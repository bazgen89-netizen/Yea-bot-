"""Brewed tea of the day: what's on the counter, who was treated, what the
employee thinks of it (app/services/brew.py).

Runs against in-memory SQLite like tests/test_batches.py; the stores table is
left out because `Store.aliases` is a Postgres ARRAY column SQLite can't
render, and none of this logic reads a Store row.
"""
import datetime

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models import Base, Employee, ShiftLog
from app.services.brew import count_treat, save_brewed_tea, save_feedback, today_shift

_TEST_TABLES = ("employees", "shift_logs")
STORE_ID = 1


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


async def _employee_on_shift(session) -> Employee:
    employee = Employee(telegram_user_id=555, name="Аня")
    session.add(employee)
    await session.flush()
    session.add(
        ShiftLog(
            employee_id=employee.id,
            store_id=STORE_ID,
            date=datetime.date.today(),
            confirmed_at=datetime.datetime.now(datetime.timezone.utc),
        )
    )
    await session.commit()
    return employee


@pytest.mark.asyncio
async def test_brewed_tea_is_saved_on_the_shift(session):
    employee = await _employee_on_shift(session)
    await save_brewed_tea(session, employee.id, "  Шу Пуэр 9978  ")

    shift = await today_shift(session, employee.id)
    assert shift.brewed_tea == "Шу Пуэр 9978"


@pytest.mark.asyncio
async def test_feedback_accumulates_instead_of_overwriting(session):
    """Сотрудник пьёт чай не один раз за смену, и поздние заметки обычно
    содержательнее ранних — затирать первые нельзя."""
    employee = await _employee_on_shift(session)
    await save_brewed_tea(session, employee.id, "Да Хун Пао")
    await save_feedback(session, employee.id, "Первый пролив — карамель")
    await save_feedback(session, employee.id, "К пятому уходит в печёное яблоко")

    shift = await today_shift(session, employee.id)
    assert "карамель" in shift.brewed_tea_feedback
    assert "печёное яблоко" in shift.brewed_tea_feedback


@pytest.mark.asyncio
async def test_treats_are_counted(session):
    employee = await _employee_on_shift(session)
    assert await count_treat(session, employee.id) == 1
    assert await count_treat(session, employee.id) == 2

    shift = await today_shift(session, employee.id)
    assert shift.treats_given == 2


@pytest.mark.asyncio
async def test_no_shift_today_is_not_an_error(session):
    """Сотрудник пишет боту в выходной — это не повод падать."""
    employee = Employee(telegram_user_id=777, name="Без смены")
    session.add(employee)
    await session.commit()

    assert await today_shift(session, employee.id) is None
    assert await save_brewed_tea(session, employee.id, "Любой чай") is None
    assert await save_feedback(session, employee.id, "Заметка") is None
    assert await count_treat(session, employee.id) == 0
