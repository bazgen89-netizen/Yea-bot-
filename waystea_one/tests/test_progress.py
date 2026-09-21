"""Ранг, серия и личная сводка (app/services/progress.py)."""
import datetime

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models import Base, Employee, ShiftLog
from app.services.progress import format_stats, next_rank, rank_for, tasting_streak

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


def test_rank_grows_with_cards():
    assert rank_for(0) == "🌱 Новичок"
    assert rank_for(3) == "🍃 Ученик"
    assert rank_for(11) == "🫖 Знаток"
    assert rank_for(100) == "🐉 Чайный дракон"


def test_next_rank_counts_remaining_cards():
    assert next_rank(5) == ("🫖 Знаток", 2)
    assert next_rank(0) == ("🍃 Ученик", 3)


def test_top_rank_has_nothing_next():
    assert next_rank(20) is None


@pytest.mark.asyncio
async def test_streak_counts_shifts_not_calendar_days(session):
    """Выходной не рвёт серию: она про небрежность, а не про график."""
    employee = Employee(telegram_user_id=5, name="Аня")
    session.add(employee)
    await session.flush()

    # Смены с пропуском в три дня — все с записанным впечатлением
    for offset in (0, 4, 5):
        session.add(
            ShiftLog(
                employee_id=employee.id,
                store_id=STORE_ID,
                date=datetime.date(2026, 9, 21) - datetime.timedelta(days=offset),
                confirmed_at=datetime.datetime.now(datetime.timezone.utc),
                brewed_tea_feedback="Плотный, с карамелью",
            )
        )
    await session.commit()

    assert await tasting_streak(session, employee.id, datetime.date(2026, 9, 21)) == 3


@pytest.mark.asyncio
async def test_streak_breaks_on_a_shift_without_a_note(session):
    employee = Employee(telegram_user_id=6, name="Пётр")
    session.add(employee)
    await session.flush()

    notes = {0: "Есть", 1: None, 2: "Есть"}
    for offset, note in notes.items():
        session.add(
            ShiftLog(
                employee_id=employee.id,
                store_id=STORE_ID,
                date=datetime.date(2026, 9, 21) - datetime.timedelta(days=offset),
                confirmed_at=datetime.datetime.now(datetime.timezone.utc),
                brewed_tea_feedback=note,
            )
        )
    await session.commit()

    assert await tasting_streak(session, employee.id, datetime.date(2026, 9, 21)) == 1


def test_format_stats_reads_as_progress_not_a_grade():
    text = format_stats(
        "Аня",
        {
            "cards_learned": 5,
            "rank": "🍃 Ученик",
            "next_rank": ("🫖 Знаток", 2),
            "streak": 4,
            "quiz_total": 6,
            "quiz_correct": 5,
            "guest_answers": 2,
            "pending_reviews": 1,
        },
    )
    assert "Аня" in text and "🍃 Ученик" in text
    assert "осталось карт: 2" in text
    assert "Смен подряд с дегустацией: 4" in text
    assert "5 из 6" in text
    assert "На повторении: 1" in text


def test_broken_streak_suggests_what_to_do():
    text = format_stats("Аня", {
        "cards_learned": 0, "rank": "🌱 Новичок", "next_rank": ("🍃 Ученик", 3),
        "streak": 0, "quiz_total": 0, "quiz_correct": 0,
        "guest_answers": 0, "pending_reviews": 0,
    })
    assert "/feedback" in text
    assert "Вопросов пока не было" in text
