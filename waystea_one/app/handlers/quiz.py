"""Answer buttons for the tea knowledge check (app/services/quiz.py)."""
from aiogram import F, Router
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup

from app.db import get_session
from app.models import QuizQuestion
from app.services.identity import get_employee
from app.services.quiz import record_answer

router = Router(name="quiz")


def quiz_keyboard(question: QuizQuestion) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=option, callback_data=f"quiz:{question.id}:{index}")]
            for index, option in enumerate(question.options)
        ]
    )


@router.callback_query(F.data.startswith("quiz:"))
async def on_quiz_answer(callback: CallbackQuery) -> None:
    _, question_id, chosen = callback.data.split(":")

    async with get_session() as session:
        question = await session.get(QuizQuestion, int(question_id))
        employee = await get_employee(session, callback.from_user.id)
        if question is None or employee is None:
            await callback.answer("Вопрос уже неактуален")
            return
        correct = await record_answer(session, employee, question, int(chosen))

    await callback.answer("Верно!" if correct else "Мимо")
    verdict = (
        "✅ Верно."
        if correct
        else f"❌ Не совсем. Правильно: <b>{question.options[question.answer_index]}</b>"
    )
    explain = f"\n<i>{question.explain}</i>" if question.explain else ""
    await callback.message.edit_text(f"{question.question}\n\n{verdict}{explain}")
