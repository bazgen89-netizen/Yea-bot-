"""Кто есть кто для бота.

Правило одно: руководитель отмечает смену наравне со всеми, но рабочие и
учебные сообщения — задачи, апсейл-подсказки, музыка, викторина, вопросы
гостя — не для него. Ему идут отчёты и эскалации.

Раньше эта проверка была скопирована в каждом отправителе по отдельности, и
ровно поэтому в викторине её однажды забыли: руководителю приходили вопросы
по чаю. Теперь она одна на всех — добавляя новый вид сообщения сотруднику,
вызывай `is_manager` здесь, а не сравнивай id заново.
"""
from app.config import settings
from app.models import Employee


def is_manager(telegram_user_id: int) -> bool:
    return telegram_user_id == settings.owner_telegram_id


def skip_for_staff_message(employee: Employee | None) -> bool:
    """True — этому человеку сообщение для персонала слать не нужно."""
    return employee is None or is_manager(employee.telegram_user_id)
