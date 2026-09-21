"""Интервальное повторение ошибок (app/services/quiz.py).

SQLite в памяти, как в tests/test_batches.py. Таблица quiz_questions в
тестовую схему не входит — её `options` это Postgres ARRAY, который SQLite не
рендерит; расписание повторений на сам вопрос не смотрит, ему хватает id.
"""
import datetime

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models import Base, Employee, QuizReview
from app.services.quiz import REVIEW_INTERVALS_DAYS, _schedule_review

_TEST_TABLES = ("employees", "quiz_reviews")
QUESTION_ID = 42
TODAY = datetime.date.today()


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


async def _employee(session) -> Employee:
    employee = Employee(telegram_user_id=1001, name="Аня")
    session.add(employee)
    await session.commit()
    return employee


async def _review(session, employee_id: int) -> QuizReview | None:
    return await session.scalar(
        select(QuizReview).where(
            QuizReview.employee_id == employee_id, QuizReview.question_id == QUESTION_ID
        )
    )


@pytest.mark.asyncio
async def test_correct_first_time_schedules_nothing(session):
    """Знал сразу — повторять нечего, иначе очередь забьётся выученным."""
    employee = await _employee(session)
    await _schedule_review(session, employee.id, QUESTION_ID, correct=True)
    await session.commit()

    assert await _review(session, employee.id) is None


@pytest.mark.asyncio
async def test_wrong_answer_returns_in_two_days(session):
    employee = await _employee(session)
    await _schedule_review(session, employee.id, QUESTION_ID, correct=False)
    await session.commit()

    review = await _review(session, employee.id)
    assert review.stage == 0
    assert review.completed is False
    assert review.due_date == TODAY + datetime.timedelta(days=REVIEW_INTERVALS_DAYS[0])


@pytest.mark.asyncio
async def test_intervals_grow_then_the_question_is_done(session):
    employee = await _employee(session)
    await _schedule_review(session, employee.id, QUESTION_ID, correct=False)
    await session.commit()

    for expected_days in REVIEW_INTERVALS_DAYS[1:]:
        await _schedule_review(session, employee.id, QUESTION_ID, correct=True)
        await session.commit()
        review = await _review(session, employee.id)
        assert review.due_date == TODAY + datetime.timedelta(days=expected_days)
        assert review.completed is False

    # Верный ответ на последнем интервале закрывает вопрос
    await _schedule_review(session, employee.id, QUESTION_ID, correct=True)
    await session.commit()
    assert (await _review(session, employee.id)).completed is True


@pytest.mark.asyncio
async def test_a_later_mistake_reopens_a_finished_question(session):
    """Забыл через месяц — вопрос снова в работе, с самого начала."""
    employee = await _employee(session)
    await _schedule_review(session, employee.id, QUESTION_ID, correct=False)
    for _ in REVIEW_INTERVALS_DAYS:
        await _schedule_review(session, employee.id, QUESTION_ID, correct=True)
    await session.commit()
    assert (await _review(session, employee.id)).completed is True

    await _schedule_review(session, employee.id, QUESTION_ID, correct=False)
    await session.commit()

    review = await _review(session, employee.id)
    assert review.completed is False
    assert review.stage == 0
    assert review.due_date == TODAY + datetime.timedelta(days=REVIEW_INTERVALS_DAYS[0])
