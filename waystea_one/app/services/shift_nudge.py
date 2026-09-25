"""Сотрудник написал, а смену не отметил — бот напоминает сам.

Решение владельца: если человек появился в чате утром, а смены на сегодня
нет, ждать утренней рассылки или чужой инициативы не нужно — бот пишет ему
лично. Это ловит обычный случай «пришёл, поздоровался, забыл отметиться».

Осторожность здесь в дозировке. Напоминание уходит один раз за день на
человека, только в первой половине дня и только если сообщение не было
попыткой открыть смену. Иначе бот превращается в того, кто переспрашивает
после каждой реплики.
"""
import datetime
import logging
from zoneinfo import ZoneInfo

from app.config import settings

logger = logging.getLogger(__name__)

# Окно, в котором напоминание уместно. Раньше — люди ещё в дороге, позже —
# смена либо уже идёт без отметки (это поймает вечерний отчёт), либо человек
# сегодня просто не работает и дёргать его незачем.
NUDGE_FROM_HOUR = 8
NUDGE_UNTIL_HOUR = 14

NUDGE_TEXT = (
    "Доброе утро, {name}! 🙂\n"
    "Вижу тебя в чате, а смену ты сегодня ещё не отмечал. Работаешь?\n\n"
    "Если да — напиши, на какой точке: «я на гаге», «черёмушки», «маркет». "
    "Если сегодня выходной — просто не отвечай, больше не потревожу."
)

# Кому уже писали сегодня. В памяти процесса: при перезапуске Render
# напоминание в худшем случае уйдёт второй раз за день — это терпимо,
# а отдельная таблица ради такого не нужна.
_nudged: set[tuple[int, datetime.date]] = set()


def local_now() -> datetime.datetime:
    return datetime.datetime.now(ZoneInfo(settings.timezone))


def within_morning_window(now: datetime.datetime) -> bool:
    return NUDGE_FROM_HOUR <= now.hour < NUDGE_UNTIL_HOUR


def should_nudge(
    *,
    now: datetime.datetime,
    has_shift_today: bool,
    is_shift_start_message: bool,
    is_manager: bool,
    already_nudged: bool,
) -> bool:
    """Все условия в одном месте — чтобы их было видно и можно было проверить."""
    if is_manager:
        return False  # руководителю смену отмечать не нужно
    if has_shift_today:
        return False
    if is_shift_start_message:
        return False  # человек как раз открывает смену, обычный путь справится
    if already_nudged:
        return False
    return within_morning_window(now)


def mark_nudged(employee_id: int, today: datetime.date) -> None:
    _nudged.add((employee_id, today))


def was_nudged(employee_id: int, today: datetime.date) -> bool:
    return (employee_id, today) in _nudged


def reset_for_tests() -> None:
    _nudged.clear()
