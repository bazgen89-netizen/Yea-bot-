"""Приём вопросов гостя из зала и одобрение кандидатов владельцем.

Роутер регистрируется до shift_router: и команда, и диалог записи вопроса
должны срабатывать раньше общего F.text catch-all (см. скилл, правило 1).
"""
import logging

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from app.config import settings
from app.db import get_session
from app.services.identity import get_employee
from app.services.scenario_intake import approve, notify_owner, reject, submit_from_floor
from app.services.messaging import reply_private, send_private

logger = logging.getLogger(__name__)

router = Router(name="scenarios")

ASK_PROMPT = (
    "🎙 Что спросил гость? Напиши вопрос так, как он прозвучал — своими "
    "словами, можно коряво.\n\n"
    "Такие вопросы ценнее придуманных: это ровно те места, где мы буксуем. "
    "Владелец посмотрит и добавит его в тренировку для всех."
)


class FloorQuestion(StatesGroup):
    awaiting_question = State()


def approval_keyboard(candidate_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="✅ В тренировку", callback_data=f"scen:add:{candidate_id}"),
                InlineKeyboardButton(text="🗑 Не надо", callback_data=f"scen:skip:{candidate_id}"),
            ]
        ]
    )


@router.message(Command("ask"))
async def on_ask_command(message: Message, state: FSMContext) -> None:
    """Продавец записывает вопрос, на котором растерялся."""
    async with get_session() as session:
        employee = await get_employee(session, message.from_user.id)
    if employee is None:
        return  # не сотрудник — пусть дальше разбирается обычная цепочка
    await reply_private(message, ASK_PROMPT)
    await state.set_state(FloorQuestion.awaiting_question)


@router.message(FloorQuestion.awaiting_question)
async def receive_floor_question(message: Message, state: FSMContext) -> None:
    await state.clear()
    question = (message.text or "").strip()
    if len(question) < 5:
        await reply_private(message, "Слишком коротко — напиши вопрос целиком, командой /ask.")
        return

    async with get_session() as session:
        employee = await get_employee(session, message.from_user.id)
        if employee is None:
            return
        candidate = await submit_from_floor(session, employee, question)
        author = employee.name

    await reply_private(message, 
        "Записал и передал владельцу 👍 Спасибо — из таких вопросов и "
        "собирается наша тренировка."
    )
    await notify_owner(message.bot, candidate, author_name=author)


@router.callback_query(F.data.startswith("scen:"))
async def on_scenario_decision(callback: CallbackQuery) -> None:
    if callback.from_user.id != settings.owner_telegram_id:
        await callback.answer("Это решает владелец")
        return

    _, action, candidate_id = callback.data.split(":")
    async with get_session() as session:
        if action == "add":
            scenario = await approve(session, int(candidate_id))
            answered = "✅ Добавлено в тренировку" if scenario else "Уже обработано"
        else:
            answered = "🗑 Отклонено" if await reject(session, int(candidate_id)) else "Уже обработано"

    await callback.answer(answered)
    # Кнопки убираем, текст оставляем: владельцу видно, что он решил.
    try:
        await callback.message.edit_text(f"{callback.message.html_text}\n\n<b>{answered}</b>")
    except Exception:
        logger.exception("Не удалось обновить сообщение кандидата %s", candidate_id)
