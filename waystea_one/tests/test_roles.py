"""Правило «руководителю сообщения для персонала не идут»
(app/services/roles.py).

Второй тест здесь — не про логику, а про то, чтобы правило не забыли в
новом отправителе. Ровно так оно однажды и потерялось: викторина приходила
руководителю, потому что проверка была скопирована по файлам вручную.
"""
import pathlib

import pytest

from app.config import settings
from app.models import Employee
from app.services.roles import is_manager, skip_for_staff_message

# Модули, которые шлют сообщения сотруднику на смене
STAFF_SENDERS = ("quiz", "guest", "brew", "upsell", "music", "revenue_reminders")


def test_manager_is_recognized_by_id(monkeypatch):
    monkeypatch.setattr(settings, "owner_telegram_id", 777)
    assert is_manager(777)
    assert not is_manager(778)


def test_staff_messages_skip_the_manager(monkeypatch):
    monkeypatch.setattr(settings, "owner_telegram_id", 777)
    manager = Employee(telegram_user_id=777, name="Руководитель")
    seller = Employee(telegram_user_id=778, name="Аня")

    assert skip_for_staff_message(manager) is True
    assert skip_for_staff_message(seller) is False


def test_missing_employee_is_skipped_not_crashed(monkeypatch):
    monkeypatch.setattr(settings, "owner_telegram_id", 777)
    assert skip_for_staff_message(None) is True


@pytest.mark.parametrize("module_name", STAFF_SENDERS)
def test_every_staff_sender_uses_the_shared_rule(module_name):
    source = pathlib.Path("app/services", f"{module_name}.py").read_text(encoding="utf-8")
    assert "skip_for_staff_message" in source, (
        f"{module_name}.py шлёт сообщения сотруднику, но не проверяет роль через "
        "roles.skip_for_staff_message — руководителю прилетит лишнее"
    )
    assert "owner_telegram_id" not in source, (
        f"{module_name}.py сравнивает id руководителя вручную — проверка должна "
        "быть одна, в roles.py"
    )
