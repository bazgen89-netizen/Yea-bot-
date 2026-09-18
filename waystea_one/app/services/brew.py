"""The tea brewed at the counter today.

Owner request, in their words: the brewed tea is a sales tool, not
background. A guest who is already buying and gets a cup of what's on the
table often takes that tea home too. So the bot asks what's brewed, names
it in the upsell reminders instead of talking about "tea" in the abstract,
counts who was treated, and asks the employee what they think of it — every
time they drink it, the impression goes into the shared base.
"""
import datetime
import logging

from sqlalchemy import select

from app.config import settings
from app.models import Employee, ShiftLog

logger = logging.getLogger(__name__)

ASK_BREWED_TEA = (
    "🫖 Какой чай сегодня завариваешь? Напиши название — буду напоминать "
    "угощать гостей именно им и спрошу твои впечатления."
)

ASK_FEEDBACK = (
    "✍️ Ты сегодня пил <b>{tea}</b>. Что скажешь?\n"
    "Вкус, аромат, как заваривал, кому такой зайдёт — двух-трёх строк хватит. "
    "Это идёт в общую базу, из неё потом собираются ответы гостям."
)


async def today_shift(session, employee_id: int) -> ShiftLog | None:
    return await session.scalar(
        select(ShiftLog).where(
            ShiftLog.employee_id == employee_id,
            ShiftLog.date == datetime.date.today(),
        )
    )


async def save_brewed_tea(session, employee_id: int, tea: str) -> ShiftLog | None:
    shift = await today_shift(session, employee_id)
    if shift is None:
        return None
    shift.brewed_tea = tea.strip()[:200]
    await session.commit()
    return shift


async def save_feedback(session, employee_id: int, note: str) -> ShiftLog | None:
    shift = await today_shift(session, employee_id)
    if shift is None:
        return None
    # Several impressions a day are appended, not overwritten: the employee
    # drinks the tea more than once and the later notes are usually the
    # better ones.
    previous = shift.brewed_tea_feedback
    shift.brewed_tea_feedback = f"{previous}\n---\n{note}"[:2000] if previous else note[:2000]
    await session.commit()
    return shift


async def count_treat(session, employee_id: int) -> int:
    shift = await today_shift(session, employee_id)
    if shift is None:
        return 0
    shift.treats_given += 1
    await session.commit()
    return shift.treats_given


async def send_feedback_prompts(bot, session_factory) -> None:
    """Scheduled once a day: ask everyone on shift about the brewed tea."""
    from app.handlers.shift import BrewFeedback
    from app.bot import dispatcher
    from aiogram.fsm.storage.base import StorageKey

    async with session_factory() as session:
        result = await session.execute(
            select(ShiftLog, Employee)
            .join(Employee, ShiftLog.employee_id == Employee.id)
            .where(ShiftLog.date == datetime.date.today(), ShiftLog.brewed_tea.is_not(None))
        )
        for shift, employee in result.all():
            if employee.telegram_user_id == settings.owner_telegram_id:
                continue
            try:
                await bot.send_message(
                    employee.telegram_user_id, ASK_FEEDBACK.format(tea=shift.brewed_tea)
                )
            except Exception:
                logger.exception("Failed to ask %s about the brewed tea", employee.name)
                continue
            # Set the FSM state directly: this runs from a scheduler job, not
            # a message handler, so there's no FSMContext to hand us one —
            # same approach as app/services/music.py's nudge.
            key = StorageKey(
                bot_id=bot.id,
                chat_id=employee.telegram_user_id,
                user_id=employee.telegram_user_id,
            )
            await dispatcher.storage.set_state(key, BrewFeedback.awaiting_note.state)
