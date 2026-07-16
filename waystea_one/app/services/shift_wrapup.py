"""Owner request: when an employee has completed ALL task blocks for the
day (often before/after lunch), the bot congratulates them, tells them
what to focus on for the rest of the shift (guests + upselling, keeping
the place tidy and stocked), and asks whether they have any comments about
today's shift — which get forwarded to the owner.

Same "ask a question, capture the next reply" pattern as MusicNudge
(app/services/music.py): the reply handler is registered for the
`ShiftWrapUp.awaiting_comment` FSM state in app/handlers/shift.py. Because
this can be triggered from a button callback (app/handlers/tasks.py) as
well as a text reply, the state is set directly on the dispatcher storage
rather than through an FSMContext.
"""
import logging

from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.base import StorageKey

logger = logging.getLogger(__name__)

WELL_DONE_TEXT = (
    "Молодец! 🎉 Все задачи на сегодня выполнены.\n\n"
    "Теперь главный фокус — гости и продажи: предлагай дегустацию, "
    "пробники 10 г готового чая, подсказывай сочетания («с этим чаем часто "
    "берут вот такой»). И поддерживай чистоту и наличие товара на местах.\n\n"
    "Есть комментарии по сегодняшней смене? Напиши — передам владельцу. "
    "Если всё хорошо, можешь просто написать «нет»."
)


class ShiftWrapUp(StatesGroup):
    awaiting_comment = State()


async def send_shift_wrapup(bot, telegram_user_id: int, store_id: int) -> None:
    """Send the well-done message and arm the FSM state that captures the
    employee's shift comment. Safe to call from either a message handler or
    a button callback — sets the state on the storage directly.
    """
    try:
        await bot.send_message(telegram_user_id, WELL_DONE_TEXT)
    except Exception:
        logger.exception("Failed to send shift wrap-up to %s", telegram_user_id)
        return

    from app.bot import dispatcher

    key = StorageKey(bot_id=bot.id, chat_id=telegram_user_id, user_id=telegram_user_id)
    await dispatcher.storage.set_state(key, ShiftWrapUp.awaiting_comment.state)
    await dispatcher.storage.set_data(key, {"wrapup_store_id": store_id})
