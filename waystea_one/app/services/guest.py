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

from app.models import Employee, GuestAnswer, GuestScenario, ShiftLog
from app.services.roles import skip_for_staff_message

logger = logging.getLogger(__name__)

INTRO = (
    "🎭 Ситуация у прилавка. Ответь своими словами, как сказал бы гостю вживую — "
    "не отличным ответом из учебника, а как есть.\n\n<b>Гость спрашивает:</b>\n«{question}»"
)


# Сколько дней сценарий не возвращается к тому же сотруднику, если есть
# из чего выбирать. Повтор сам по себе полезен — через месяц человек
# отвечает иначе и видит собственный рост, — но не через два дня.
REPEAT_COOLDOWN_DAYS = 30


async def pick_scenario(session, employee_id: int, today: datetime.date | None = None
                        ) -> GuestScenario | None:
    """Сначала то, чего сотрудник ещё не видел; потом — самое давнее.

    Когда свежие кончились, берём сценарий с самым старым ответом, а не
    случайный: случайный выбор способен прислать один и тот же вопрос два
    дня подряд, и упражнение превращается в шум.
    """
    today = today or datetime.date.today()

    answered_rows = (
        await session.execute(
            select(GuestAnswer.scenario_id, func.max(GuestAnswer.date))
            .where(GuestAnswer.employee_id == employee_id)
            .group_by(GuestAnswer.scenario_id)
        )
    ).all()
    last_seen = {scenario_id: last_date for scenario_id, last_date in answered_rows}

    all_scenarios = list((await session.execute(select(GuestScenario))).scalars())
    if not all_scenarios:
        return None

    fresh = [s for s in all_scenarios if s.id not in last_seen]
    if fresh:
        return random.choice(fresh)

    cooled = [
        s for s in all_scenarios
        if (today - last_seen[s.id]).days >= REPEAT_COOLDOWN_DAYS
    ]
    pool = cooled or all_scenarios
    # Самый давний. При равных датах — случайный из них, чтобы порядок
    # повторов не застывал раз и навсегда.
    oldest = min(last_seen[s.id] for s in pool)
    return random.choice([s for s in pool if last_seen[s.id] == oldest])


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
            if skip_for_staff_message(employee):
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
