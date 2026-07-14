"""Owner request: turn-the-music-on / is-it-playing checks in the first
task batch, plus a couple of proactive check-ins during the shift asking
what's playing and whether the volume is right — logged and rolled into
the daily owner report (app/services/reports.py).

Uses the same "ask a question, wait for the next reply" pattern as
MoodCheck (app/handlers/shift.py) — a dedicated FSM state that the reply
handler is registered for. The difference is this question is sent
proactively from a scheduler job, not in response to a message, so
`send_music_nudges` sets the FSM state directly via the dispatcher's
storage rather than through a Message-triggered handler.
"""
import datetime
import logging

from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.base import StorageKey
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Employee, MusicCheck, ShiftLog

logger = logging.getLogger(__name__)

MUSIC_NUDGE_TEXT = (
    "Как там музыка? 🎵 Не громко и не тихо ли играет? "
    "Напиши, что сейчас играет."
)
FIRST_NUDGE_AFTER_MINUTES = 120
NUDGE_GAP_MINUTES = 180
MAX_NUDGES_PER_SHIFT = 2


class MusicNudge(StatesGroup):
    awaiting_response = State()


async def record_music_note(
    session: AsyncSession, employee_id: int, store_id: int, note: str
) -> MusicCheck:
    entry = MusicCheck(employee_id=employee_id, store_id=store_id, note=note[:500])
    session.add(entry)
    await session.commit()
    await session.refresh(entry)
    return entry


async def send_music_nudges(bot, session_factory) -> None:
    now = datetime.datetime.now(datetime.timezone.utc)
    today = datetime.date.today()

    # Imported here (not at module load) to avoid a circular import: app.bot
    # builds the Dispatcher that owns this storage, and app.main (which
    # schedules this job) already imports both app.bot and this module.
    from app.bot import dispatcher

    async with session_factory() as session:
        result = await session.execute(
            select(ShiftLog, Employee)
            .join(Employee, ShiftLog.employee_id == Employee.id)
            .where(ShiftLog.date == today, ShiftLog.music_nudges_sent < MAX_NUDGES_PER_SHIFT)
        )
        rows = result.all()

        for shift_log, employee in rows:
            if shift_log.music_nudges_sent == 0:
                anchor = shift_log.confirmed_at
                gap_minutes = FIRST_NUDGE_AFTER_MINUTES
            else:
                anchor = shift_log.last_music_nudge_at
                gap_minutes = NUDGE_GAP_MINUTES

            if anchor is None:
                continue
            if anchor.tzinfo is None:
                anchor = anchor.replace(tzinfo=datetime.timezone.utc)

            if now < anchor + datetime.timedelta(minutes=gap_minutes):
                continue

            try:
                await bot.send_message(employee.telegram_user_id, MUSIC_NUDGE_TEXT)
            except Exception:
                logger.exception("Failed to send music nudge to %s", employee.telegram_user_id)
                continue

            shift_log.music_nudges_sent += 1
            shift_log.last_music_nudge_at = now
            await session.commit()

            # Set FSM state directly via the storage — this job runs from
            # APScheduler, not from a Message handler, so there's no
            # FSMContext to hand the reply-capture state to any other way.
            key = StorageKey(
                bot_id=bot.id,
                chat_id=employee.telegram_user_id,
                user_id=employee.telegram_user_id,
            )
            await dispatcher.storage.set_state(key, MusicNudge.awaiting_response.state)
            await dispatcher.storage.set_data(key, {"music_store_id": shift_log.store_id})
