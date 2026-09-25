"""Выключатель бота (app/config.py::pause_requested).

Логика маленькая, но цена ошибки высокая в обе стороны: ложное «работаем»
разбудит остановленного бота, ложное «пауза» оставит магазины без задач.
"""
import pytest

from app.config import PAUSED_BY_DEFAULT, pause_requested


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on", " On "])
def test_explicit_on_pauses(value):
    assert pause_requested(value) is True


@pytest.mark.parametrize("value", ["0", "false", "FALSE", "no", "off", " Off "])
def test_explicit_off_resumes(value):
    """Владелец снимает паузу из панели Render, не дожидаясь правки кода."""
    assert pause_requested(value) is False


@pytest.mark.parametrize("value", [None, "", "   ", "непонятно"])
def test_missing_or_unclear_value_falls_back_to_the_built_in_switch(value):
    """Удаление переменной не должно втихую будить остановленного бота."""
    assert pause_requested(value) is PAUSED_BY_DEFAULT


def test_bot_is_currently_paused_on_purpose():
    """Сторож против случайного запуска: бот остановлен по просьбе владельца,
    и снятие паузы должно быть осознанным изменением этого теста тоже."""
    assert PAUSED_BY_DEFAULT is True
