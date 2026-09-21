"""Пополнение библиотеки вопросов: из зала и из интернета
(app/services/scenario_intake.py).

Ключевое правило, которое здесь проверяется: между источником и
сотрудниками всегда стоит владелец.
"""
import datetime

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models import Base, Employee, GuestScenario, PendingScenario
from app.services.scenario_intake import (
    SOURCE_FLOOR,
    STATUS_ADDED,
    STATUS_NEW,
    STATUS_REJECTED,
    approve,
    reject,
)

_TEST_TABLES = ("employees", "guest_scenarios", "pending_scenarios")


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


async def _candidate(session, question="Можно заваривать пуэр в термосе?") -> PendingScenario:
    candidate = PendingScenario(
        question=question, draft_points="Термос передерживает лист", source=SOURCE_FLOOR
    )
    session.add(candidate)
    await session.commit()
    await session.refresh(candidate)
    return candidate


@pytest.mark.asyncio
async def test_approved_candidate_reaches_the_library(session):
    candidate = await _candidate(session)
    scenario = await approve(session, candidate.id)

    assert scenario.question == candidate.question
    assert scenario.good_answer_points == "Термос передерживает лист"
    assert (await session.get(PendingScenario, candidate.id)).status == STATUS_ADDED


@pytest.mark.asyncio
async def test_rejected_candidate_never_reaches_employees(session):
    candidate = await _candidate(session)
    assert await reject(session, candidate.id) is True

    assert (await session.get(PendingScenario, candidate.id)).status == STATUS_REJECTED
    assert list((await session.execute(select(GuestScenario))).scalars()) == []


@pytest.mark.asyncio
async def test_second_tap_on_the_same_candidate_does_nothing(session):
    """Кнопки остаются нажимаемыми в чате навсегда — второе нажатие не должно
    плодить дубли в библиотеке."""
    candidate = await _candidate(session)
    await approve(session, candidate.id)

    assert await approve(session, candidate.id) is None
    assert await reject(session, candidate.id) is False
    scenarios = list((await session.execute(select(GuestScenario))).scalars())
    assert len(scenarios) == 1


@pytest.mark.asyncio
async def test_approving_a_question_already_in_the_library_adds_no_duplicate(session):
    session.add(GuestScenario(question="Можно заваривать пуэр в термосе?", good_answer_points="x"))
    await session.commit()
    candidate = await _candidate(session)

    await approve(session, candidate.id)

    scenarios = list((await session.execute(select(GuestScenario))).scalars())
    assert len(scenarios) == 1
    assert (await session.get(PendingScenario, candidate.id)).status == STATUS_ADDED


@pytest.mark.asyncio
async def test_missing_candidate_is_not_an_error(session):
    assert await approve(session, 999) is None
    assert await reject(session, 999) is False
