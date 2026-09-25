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

from app.models import Employee, QuizAnswer, QuizQuestion, QuizReview, ShiftLog
from app.services.messaging import notify_employee
from app.services.roles import skip_for_staff_message

logger = logging.getLogger(__name__)

QUESTIONS_PER_ROUND = 2

# Через сколько дней вопрос возвращается после каждого верного повторения.
# Ошибся — расписание сбрасывается в начало.
REVIEW_INTERVALS_DAYS = (2, 7, 30)


async def pick_questions(
    session: AsyncSession,
    brewed_tea: str | None,
    limit: int = QUESTIONS_PER_ROUND,
    employee_id: int | None = None,
) -> list[QuizQuestion]:
    """Questions for one round.

    Order of preference: a question that's due for review (it was answered
    wrong before — returning to it is the whole point), then the brewed
    tea's card, then anything else, spread across cards.
    """
    all_questions = list((await session.execute(select(QuizQuestion))).scalars())
    if not all_questions:
        return []

    chosen: list[QuizQuestion] = []
    if employee_id is not None:
        for question in await due_questions(session, employee_id):
            if len(chosen) >= limit:
                break
            chosen.append(question)

    if brewed_tea and len(chosen) < limit:
        card = match_card(all_questions, brewed_tea)
        matching = [q for q in all_questions if q.card == card and q not in chosen]
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
    await _schedule_review(session, employee.id, question.id, correct)
    await session.commit()
    return correct


async def _schedule_review(
    session: AsyncSession, employee_id: int, question_id: int, correct: bool
) -> None:
    """Ставит вопрос в личное расписание повторений.

    Ошибка — расписание в начало (через 2 дня), верный ответ — следующий
    интервал. Верный ответ на последнем интервале закрывает повторение:
    вопрос считается выученным и больше не возвращается.
    """
    review = await session.scalar(
        select(QuizReview).where(
            QuizReview.employee_id == employee_id,
            QuizReview.question_id == question_id,
        )
    )
    today = datetime.date.today()

    if review is None:
        if correct:
            return  # ответил верно с первого раза — повторять нечего
        session.add(
            QuizReview(
                employee_id=employee_id,
                question_id=question_id,
                stage=0,
                due_date=today + datetime.timedelta(days=REVIEW_INTERVALS_DAYS[0]),
            )
        )
        return

    if not correct:
        review.stage = 0
        review.completed = False
        review.due_date = today + datetime.timedelta(days=REVIEW_INTERVALS_DAYS[0])
        return

    next_stage = review.stage + 1
    if next_stage >= len(REVIEW_INTERVALS_DAYS):
        review.completed = True
        review.stage = next_stage
        return
    review.stage = next_stage
    review.completed = False
    review.due_date = today + datetime.timedelta(days=REVIEW_INTERVALS_DAYS[next_stage])


async def due_questions(session: AsyncSession, employee_id: int) -> list[QuizQuestion]:
    """Вопросы, у которых подошёл срок повторения. Они идут первыми в раунде."""
    rows = await session.execute(
        select(QuizQuestion)
        .join(QuizReview, QuizReview.question_id == QuizQuestion.id)
        .where(
            QuizReview.employee_id == employee_id,
            QuizReview.completed.is_(False),
            QuizReview.due_date <= datetime.date.today(),
        )
        .order_by(QuizReview.due_date)
    )
    return list(rows.scalars())


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
            employee_check = await session.get(Employee, shift.employee_id)
            if skip_for_staff_message(employee_check):
                continue
            if await already_asked_today(session, shift.employee_id):
                continue
            questions = await pick_questions(
                session, shift.brewed_tea, employee_id=shift.employee_id
            )
            if not questions:
                return  # база вопросов пуста — молчим, а не шлём пустое сообщение
            employee = employee_check
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
