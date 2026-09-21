"""Выбор сценария «вопрос от гостя» (app/services/guest.py).

Главное, что здесь проверяется: один и тот же вопрос не приходит человеку
два дня подряд, пока есть из чего выбрать.
"""
import datetime

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models import Base, Employee, GuestAnswer, GuestScenario
from app.services.guest import REPEAT_COOLDOWN_DAYS, already_asked_today, pick_scenario

_TEST_TABLES = ("employees", "guest_scenarios", "guest_answers")
TODAY = datetime.date(2026, 9, 21)


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


async def _setup(session, scenario_count: int = 3) -> tuple[Employee, list[GuestScenario]]:
    employee = Employee(telegram_user_id=7, name="Аня")
    session.add(employee)
    scenarios = [
        GuestScenario(question=f"Вопрос {i}", good_answer_points="") for i in range(scenario_count)
    ]
    session.add_all(scenarios)
    await session.commit()
    return employee, scenarios


async def _answer(session, employee, scenario, date) -> None:
    session.add(
        GuestAnswer(
            employee_id=employee.id, scenario_id=scenario.id,
            date=date, answer="ответ", feedback="разбор",
        )
    )
    await session.commit()


@pytest.mark.asyncio
async def test_unseen_scenarios_come_first(session):
    employee, scenarios = await _setup(session)
    await _answer(session, employee, scenarios[0], TODAY - datetime.timedelta(days=1))

    picked = await pick_scenario(session, employee.id, TODAY)
    assert picked.id != scenarios[0].id


@pytest.mark.asyncio
async def test_no_scenarios_at_all(session):
    employee, _ = await _setup(session, scenario_count=0)
    assert await pick_scenario(session, employee.id, TODAY) is None


@pytest.mark.asyncio
async def test_when_all_seen_the_oldest_returns_not_a_random_one(session):
    """Случайный выбор мог прислать вчерашний вопрос снова — берём самый давний."""
    employee, scenarios = await _setup(session)
    await _answer(session, employee, scenarios[0], TODAY - datetime.timedelta(days=90))
    await _answer(session, employee, scenarios[1], TODAY - datetime.timedelta(days=60))
    await _answer(session, employee, scenarios[2], TODAY - datetime.timedelta(days=1))

    for _ in range(5):  # выбор случайен только при равных датах
        assert (await pick_scenario(session, employee.id, TODAY)).id == scenarios[0].id


@pytest.mark.asyncio
async def test_recently_seen_scenarios_are_skipped_while_cooled_ones_exist(session):
    employee, scenarios = await _setup(session)
    fresh_enough = TODAY - datetime.timedelta(days=REPEAT_COOLDOWN_DAYS + 1)
    await _answer(session, employee, scenarios[0], fresh_enough)
    await _answer(session, employee, scenarios[1], TODAY - datetime.timedelta(days=2))
    await _answer(session, employee, scenarios[2], TODAY)

    picked = await pick_scenario(session, employee.id, TODAY)
    assert picked.id == scenarios[0].id


@pytest.mark.asyncio
async def test_all_seen_recently_still_returns_something(session):
    """База маленькая и всё свежее — лучше повтор, чем тишина."""
    employee, scenarios = await _setup(session, scenario_count=2)
    await _answer(session, employee, scenarios[0], TODAY - datetime.timedelta(days=1))
    await _answer(session, employee, scenarios[1], TODAY)

    picked = await pick_scenario(session, employee.id, TODAY)
    assert picked.id == scenarios[0].id


@pytest.mark.asyncio
async def test_one_scenario_per_day(session):
    employee, scenarios = await _setup(session)
    assert not await already_asked_today(session, employee.id)

    await _answer(session, employee, scenarios[0], datetime.date.today())
    assert await already_asked_today(session, employee.id)


@pytest.mark.asyncio
async def test_seeded_library_lasts_more_than_two_weeks(session):
    """18 сценариев при одном за смену — около трёх недель без повторов."""
    from scripts.seed_guest_scenarios import SCENARIOS

    assert len(SCENARIOS) >= 18
    assert len({s["question"] for s in SCENARIOS}) == len(SCENARIOS)
