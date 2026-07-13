"""Feature 1 (docs/08_MVP_REQUIREMENTS.md §5): Shift Control.

Flow:
- Unknown Telegram user -> ask their name once, remember them as an employee.
- Known employee sends a shift-start style message ("... на месте") -> try to
  resolve which store from the message text; if ambiguous/missing, ask which
  store, per docs/09_KPI_AND_REVENUE_MODULE.md decision on dynamic daily
  store assignment (there is no fixed schedule).
- Confirming a shift also creates and sends today's task checklist (see
  app/handlers/tasks.py). "Готово"-style replies and comment proof for open
  tasks are handled here too, since aiogram dispatches a given text message
  to a single handler — see `_try_handle_task_reply`.
- Purchasing/Reporting/Sales modules are not built yet (see
  docs/08_MVP_REQUIREMENTS.md §14 for order).
"""
from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import Message

from app.db import get_session
from app.handlers.tasks import PROOF_PROMPTS, send_daily_checklist
from app.models import Employee, ProofType
from app.services.identity import (
    create_employee,
    get_employee,
    list_store_options,
    record_shift_start,
)
from app.services.shift_detector import is_shift_start_message
from app.services.store_matcher import match_store
from app.services.tasks import (
    complete_task,
    create_daily_tasks_for_shift,
    get_waiting_proof_task,
    is_completion_phrase,
    list_open_tasks,
    start_completion,
)

router = Router(name="shift")


class Onboarding(StatesGroup):
    awaiting_name = State()


class ShiftClarification(StatesGroup):
    awaiting_store = State()


async def _confirm_shift(
    message: Message, employee: Employee, store_id: int, store_name: str
) -> None:
    async with get_session() as session:
        tasks = await create_daily_tasks_for_shift(session, employee.id, store_id)

    await message.reply(f"Доброе утро 😊\nСмена отмечена: {store_name}.")
    await send_daily_checklist(message, tasks)


async def _try_handle_task_reply(message: Message, employee: Employee) -> bool:
    """Handles a non-shift text message as either proof for a task waiting
    on a comment, or a "готово"-style completion phrase. Returns True if the
    message was consumed as a task reply.
    """
    text = message.text or ""
    async with get_session() as session:
        waiting_task = await get_waiting_proof_task(session, employee.id)
        if waiting_task is not None and waiting_task.proof_type == ProofType.COMMENT.value:
            await complete_task(session, waiting_task)
            await message.reply("Спасибо! Задача закрыта ✅")
            return True

        if not is_completion_phrase(text):
            return False

        open_tasks = await list_open_tasks(session, employee.id)
        if not open_tasks:
            return False

        if len(open_tasks) > 1:
            titles = ", ".join(task.title for task in open_tasks)
            await message.reply(
                f"У вас несколько открытых задач: {titles}. "
                "Отметьте нужную кнопкой в списке задач 🙂"
            )
            return True

        task = open_tasks[0]
        proof_needed = await start_completion(session, task)

    if proof_needed:
        await message.reply(PROOF_PROMPTS[proof_needed])
    else:
        await message.reply("Готово, отмечено ✅")
    return True


@router.message(Onboarding.awaiting_name)
async def receive_name(message: Message, state: FSMContext) -> None:
    name = (message.text or "").strip()
    if not name:
        await message.reply("Не расслышал имя, напишите, пожалуйста, ещё раз 🙂")
        return

    data = await state.get_data()
    pending_text = data.get("pending_text", "")
    await state.clear()

    async with get_session() as session:
        employee = await create_employee(session, message.from_user.id, name)
        await message.reply(f"Приятно познакомиться, {employee.name}! Записал вас.")

        if pending_text and is_shift_start_message(pending_text):
            stores = await list_store_options(session)
            store = match_store(pending_text, stores)
            if store is not None:
                await record_shift_start(session, employee.id, store.id)
                await _confirm_shift(message, employee, store.id, store.name)
            else:
                await state.set_state(ShiftClarification.awaiting_store)
                await message.reply("В каком магазине вы сегодня работаете?")


@router.message(ShiftClarification.awaiting_store)
async def receive_store_clarification(message: Message, state: FSMContext) -> None:
    text = message.text or ""
    async with get_session() as session:
        employee = await get_employee(session, message.from_user.id)
        stores = await list_store_options(session)
        store = match_store(text, stores)

        if store is None:
            store_names = ", ".join(s.name for s in stores)
            await message.reply(
                f"Не понял, о каком магазине речь. Уточните, пожалуйста: {store_names}?"
            )
            return

        await state.clear()
        await record_shift_start(session, employee.id, store.id)
        await _confirm_shift(message, employee, store.id, store.name)


@router.message(F.text)
async def handle_text(message: Message, state: FSMContext) -> None:
    async with get_session() as session:
        employee = await get_employee(session, message.from_user.id)

        if employee is None:
            await state.update_data(pending_text=message.text)
            await state.set_state(Onboarding.awaiting_name)
            await message.reply(
                "Здравствуйте! Я вас ещё не знаю 🙂 Как вас зовут?"
            )
            return

        if not is_shift_start_message(message.text or ""):
            await _try_handle_task_reply(message, employee)
            return

        stores = await list_store_options(session)
        store = match_store(message.text or "", stores)

        if store is None:
            await state.set_state(ShiftClarification.awaiting_store)
            await message.reply("В каком магазине вы сегодня работаете?")
            return

        await record_shift_start(session, employee.id, store.id)
        await _confirm_shift(message, employee, store.id, store.name)
