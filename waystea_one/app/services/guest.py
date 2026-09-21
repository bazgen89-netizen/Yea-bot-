"""Вопрос от гостя: сотрудник отвечает своими словами, LLM разбирает ответ.

Кнопочная викторина проверяет узнавание вариантов. У прилавка этого мало:
нужно связно и коротко объяснить живому человеку, почему ему стоит взять
именно этот чай. Поэтому здесь свободный ответ — текстом или голосом — и
разбор вместо оценки: что прозвучало хорошо, что упущено, как сказать
короче.

Ответ принимается текстом. Голосовые пока не поддержаны: в проекте нет
расшифровки речи, а Claude аудио на вход не принимает — обещать сотруднику
голосовой ответ, который никто не прочитает, хуже, чем не предлагать его.
"""
import datetime
import logging
import random

from sqlalchemy import func, select

from app.config import settings
from app.models import Employee, GuestAnswer, GuestScenario, ShiftLog

logger = logging.getLogger(__name__)

INTRO = (
    "🎭 Ситуация у прилавка. Ответь своими словами, как сказал бы гостю вживую — "
    "не отличным ответом из учебника, а как есть.\n\n<b>Гость спрашивает:</b>\n«{question}»"
)


async def pick_scenario(session, employee_id: int) -> GuestScenario | None:
    """Сценарий, который этот сотрудник ещё не проходил; когда пройдены все —
    любой, давно не встречавшийся."""
    answered = select(GuestAnswer.scenario_id).where(GuestAnswer.employee_id == employee_id)
    fresh = list(
        (await session.execute(select(GuestScenario).where(GuestScenario.id.not_in(answered))))
        .scalars()
    )
    if fresh:
        return random.choice(fresh)

    all_scenarios = list((await session.execute(select(GuestScenario))).scalars())
    return random.choice(all_scenarios) if all_scenarios else None


async def already_asked_today(session, employee_id: int) -> bool:
    asked = await session.scalar(
        select(func.count(GuestAnswer.id)).where(
            GuestAnswer.employee_id == employee_id,
            GuestAnswer.date == datetime.date.today(),
        )
    )
    return bool(asked)


async def record_answer(session, employee_id: int, scenario_id: int, answer: str,
                        feedback: str) -> None:
    session.add(
        GuestAnswer(
            employee_id=employee_id,
            scenario_id=scenario_id,
            date=datetime.date.today(),
            answer=answer[:4000],
            feedback=feedback[:4000],
        )
    )
    await session.commit()


async def send_guest_questions(bot, session_factory) -> None:
    """Раз в день, тем, кто на смене. Состояние ставится напрямую в хранилище
    FSM — джоб планировщика, а не хендлер сообщения (как в music.py).
    """
    from aiogram.fsm.storage.base import StorageKey

    from app.bot import dispatcher
    from app.handlers.shift import GuestReply

    async with session_factory() as session:
        result = await session.execute(
            select(ShiftLog, Employee)
            .join(Employee, ShiftLog.employee_id == Employee.id)
            .where(ShiftLog.date == datetime.date.today())
        )
        for shift, employee in result.all():
            if employee.telegram_user_id == settings.owner_telegram_id:
                continue
            if await already_asked_today(session, employee.id):
                continue
            scenario = await pick_scenario(session, employee.id)
            if scenario is None:
                return  # сценариев нет — молчим, а не шлём пустое
            try:
                await bot.send_message(
                    employee.telegram_user_id, INTRO.format(question=scenario.question)
                )
            except Exception:
                logger.exception("Failed to send a guest scenario to %s", employee.name)
                continue

            key = StorageKey(
                bot_id=bot.id,
                chat_id=employee.telegram_user_id,
                user_id=employee.telegram_user_id,
            )
            await dispatcher.storage.set_state(key, GuestReply.awaiting_answer.state)
            await dispatcher.storage.set_data(key, {"guest_scenario_id": scenario.id})
