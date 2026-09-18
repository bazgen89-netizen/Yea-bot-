"""Knowledge check on the technological cards.

Owner request: ask whoever is on shift a couple of questions about tea
during the day, and prefer the card of the tea they have brewed right now —
a question about the cup in their hand sticks, an abstract one doesn't.
"""
import datetime
import logging
import random

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Employee, QuizAnswer, QuizQuestion, ShiftLog
from app.services.messaging import notify_employee

logger = logging.getLogger(__name__)

QUESTIONS_PER_ROUND = 2


async def pick_questions(
    session: AsyncSession, brewed_tea: str | None, limit: int = QUESTIONS_PER_ROUND
) -> list[QuizQuestion]:
    """Questions for one round: the brewed tea's card first, then others.

    Spreading the rest across different cards keeps a round from being two
    questions about the same tea when the base has more to offer.
    """
    all_questions = list((await session.execute(select(QuizQuestion))).scalars())
    if not all_questions:
        return []

    chosen: list[QuizQuestion] = []
    if brewed_tea:
        card = match_card(all_questions, brewed_tea)
        matching = [q for q in all_questions if q.card == card]
        if matching:
            chosen.append(random.choice(matching))

    rest = [q for q in all_questions if q not in chosen]
    random.shuffle(rest)
    seen_cards = {q.card for q in chosen}
    for question in rest:
        if len(chosen) >= limit:
            break
        if question.card in seen_cards:
            continue
        chosen.append(question)
        seen_cards.add(question.card)

    # Fewer cards than questions asked for — fall back to repeating a card.
    for question in rest:
        if len(chosen) >= limit:
            break
        if question not in chosen:
            chosen.append(question)
    return chosen


def match_card(questions: list[QuizQuestion], tea: str) -> str | None:
    """Resolve a card from however the employee wrote the tea's name.

    They type "шен пуэр" or "дахунпао" into the brewed-tea prompt; cards are
    titled properly ("Шэн пуэр молодой"), so compare loosely in both
    directions instead of demanding an exact match.
    """
    needle = _normalize(tea)
    if not needle:
        return None
    for question in questions:
        card = _normalize(question.card)
        if needle in card or card in needle:
            return question.card
    # No substring match: try word overlap ("да хун пао" vs "Да Хун Пао 2023")
    needle_words = set(needle.split())
    for question in questions:
        if needle_words & set(_normalize(question.card).split()):
            return question.card
    return None


def _normalize(text: str) -> str:
    return text.strip().lower().replace("ё", "е")


async def record_answer(
    session: AsyncSession, employee: Employee, question: QuizQuestion, chosen_index: int
) -> bool:
    correct = chosen_index == question.answer_index
    session.add(
        QuizAnswer(
            employee_id=employee.id,
            question_id=question.id,
            date=datetime.date.today(),
            chosen_index=chosen_index,
            correct=correct,
        )
    )
    await session.commit()
    return correct


async def already_asked_today(session: AsyncSession, employee_id: int) -> bool:
    asked = await session.scalar(
        select(func.count(QuizAnswer.id)).where(
            QuizAnswer.employee_id == employee_id,
            QuizAnswer.date == datetime.date.today(),
        )
    )
    return bool(asked)


async def send_quiz_round(bot, get_session_factory) -> None:
    """Scheduled once a day at a random moment inside the window."""
    from app.handlers.quiz import quiz_keyboard

    async with get_session_factory() as session:
        shifts = list(
            (
                await session.execute(
                    select(ShiftLog).where(ShiftLog.date == datetime.date.today())
                )
            ).scalars()
        )
        for shift in shifts:
            if await already_asked_today(session, shift.employee_id):
                continue
            questions = await pick_questions(session, shift.brewed_tea)
            if not questions:
                return  # база вопросов пуста — молчим, а не шлём пустое сообщение
            employee = await session.get(Employee, shift.employee_id)
            if employee is None:
                continue
            await notify_employee(
                bot,
                employee,
                "🧠 Пара вопросов по чаю — это не экзамен, просто держим знания в тонусе.",
            )
            for question in questions:
                await notify_employee(
                    bot,
                    employee,
                    f"<b>{question.card}</b>\n{question.question}",
                    reply_markup=quiz_keyboard(question),
                )
