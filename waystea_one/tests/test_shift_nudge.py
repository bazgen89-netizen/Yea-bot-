"""Напоминание отметить смену (app/services/shift_nudge.py).

Проверяется дозировка: напоминание должно ловить «пришёл и забыл
отметиться» и молчать во всех остальных случаях. Слишком настойчивая версия
этой функции хуже её отсутствия — её начнут игнорировать вместе с задачами.
"""
import datetime
from zoneinfo import ZoneInfo

import pytest

from app.services import shift_nudge
from app.services.shift_nudge import (
    NUDGE_FROM_HOUR,
    NUDGE_UNTIL_HOUR,
    mark_nudged,
    should_nudge,
    was_nudged,
    within_morning_window,
)

MSK = ZoneInfo("Europe/Moscow")


def at(hour: int) -> datetime.datetime:
    return datetime.datetime(2026, 9, 22, hour, 30, tzinfo=MSK)


DEFAULTS = dict(
    has_shift_today=False,
    is_shift_start_message=False,
    is_manager=False,
    already_nudged=False,
)


@pytest.fixture(autouse=True)
def clean_state():
    shift_nudge.reset_for_tests()
    yield
    shift_nudge.reset_for_tests()


def test_writes_in_the_morning_without_an_open_shift():
    assert should_nudge(now=at(10), **DEFAULTS)


def test_silent_when_the_shift_is_already_open():
    assert not should_nudge(now=at(10), **{**DEFAULTS, "has_shift_today": True})


def test_silent_when_the_message_itself_opens_the_shift():
    """Человек как раз пишет «я на гаге» — обычный путь справится сам."""
    assert not should_nudge(now=at(10), **{**DEFAULTS, "is_shift_start_message": True})


def test_silent_for_the_manager():
    assert not should_nudge(now=at(10), **{**DEFAULTS, "is_manager": True})


def test_once_a_day_only():
    assert not should_nudge(now=at(10), **{**DEFAULTS, "already_nudged": True})


@pytest.mark.parametrize("hour", [0, 6, NUDGE_FROM_HOUR - 1, NUDGE_UNTIL_HOUR, 18, 23])
def test_silent_outside_the_morning_window(hour):
    """Ночью и вечером напоминание неуместно: человек либо в дороге, либо
    сегодня просто не работает."""
    assert not should_nudge(now=at(hour), **DEFAULTS)


@pytest.mark.parametrize("hour", [NUDGE_FROM_HOUR, 10, NUDGE_UNTIL_HOUR - 1])
def test_window_boundaries_are_inclusive_at_the_start(hour):
    assert within_morning_window(at(hour))


def test_marking_is_per_employee_and_per_day():
    today = datetime.date(2026, 9, 22)
    mark_nudged(1, today)

    assert was_nudged(1, today)
    assert not was_nudged(2, today)                      # другой сотрудник
    assert not was_nudged(1, today + datetime.timedelta(days=1))  # следующий день


def test_text_names_the_person_and_offers_an_exit():
    text = shift_nudge.NUDGE_TEXT.format(name="Аня")
    assert "Аня" in text
    # Человек в выходной не должен оправдываться перед ботом
    assert "выходной" in text
