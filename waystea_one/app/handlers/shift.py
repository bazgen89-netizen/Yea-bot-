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
- Purchase requests ("закончился ...") and end-of-shift revenue reports
  (fixed three-line format, docs/09_KPI_AND_REVENUE_MODULE.md §3.1) and
  upsell mentions are handled here too, for the same single-handler reason.
- Anything left over that looks like a question is answered from the
  company knowledge base via the AI Processing Layer (app/services/ai.py),
  as the final fallback in the chain.
- Per owner decision, results/confirmations (shift confirmed + checklist,
  task done, revenue/purchase recorded, question answers) go to the
  employee's private chat, not the group — see app/services/messaging.py.
  Clarifying questions (name, which store) stay as group replies on
  purpose: a brand-new employee has no private chat with the bot yet, so a
  DM to them would just fail.
"""
from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import Message

from app.db import get_session
from app.handlers.tasks import PROOF_PROMPTS, send_daily_checklist
from app.models import Employee, ProofType
from app.services.ai import answer_employee_question
from app.services.identity import (
    create_employee,
    get_employee,
    get_todays_shift,
    list_store_options,
    record_shift_start,
)
from app.services.knowledge import get_knowledge_base_text
from app.services.messaging import notify_employee
from app.services.purchasing import (
    create_purchase_request,
    extract_product,
    is_purchase_request_message,
)
from app.services.question_detector import looks_like_question
from app.services.revenue import (
    looks_like_revenue_message,
    parse_revenue_message,
    record_shift_revenue,
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
from app.services.upsell import detect_upsell_type, record_upsell_event

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

    await notify_employee(
        message.bot, employee, f"Доброе утро 😊\nСмена отмечена: {store_name}.", message
    )
    await send_daily_checklist(message.bot, employee, tasks, message)


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
            await notify_employee(message.bot, employee, "Спасибо! Задача закрыта ✅", message)
            return True

        if not is_completion_phrase(text):
            return False

        open_tasks = await list_open_tasks(session, employee.id)
        if not open_tasks:
            return False

        if len(open_tasks) > 1:
            titles = ", ".join(task.title for task in open_tasks)
            await notify_employee(
                message.bot,
                employee,
                f"У вас несколько открытых задач: {titles}. "
                "Отметьте нужную кнопкой в списке задач 🙂",
                message,
            )
            return True

        task = open_tasks[0]
        proof_needed = await start_completion(session, task)

    if proof_needed:
        await notify_employee(message.bot, employee, PROOF_PROMPTS[proof_needed], message)
    else:
        await notify_employee(message.bot, employee, "Готово, отмечено ✅", message)
    return True


async def _try_handle_revenue_reply(message: Message, employee: Employee) -> bool:
    """docs/09_KPI_AND_REVENUE_MODULE.md §3.1: fixed three-line revenue report."""
    text = message.text or ""
    if not looks_like_revenue_message(text):
        return False

    async with get_session() as session:
        shift = await get_todays_shift(session, employee.id)
        if shift is None:
            await notify_employee(
                message.bot,
                employee,
                "Сначала отметьте начало смены (напишите, что вы на месте).",
                message,
            )
            return True

        report = parse_revenue_message(text)
        if report is None:
            await notify_employee(
                message.bot,
                employee,
                "Не разобрал сумму. Пришлите, пожалуйста, в таком виде:\n"
                "Общая выручка: <сумма>\nНаличка: <сумма>\nБезнал: <сумма>",
                message,
            )
            return True

        await record_shift_revenue(session, employee.id, shift.store_id, report)

    await notify_employee(message.bot, employee, "Спасибо, выручка записана 👍", message)
    return True


async def _try_handle_purchase_reply(message: Message, employee: Employee) -> bool:
    text = message.text or ""

    upsell_type = detect_upsell_type(text)
    async with get_session() as session:
        shift = await get_todays_shift(session, employee.id)
        if upsell_type is not None and shift is not None:
            await record_upsell_event(session, employee.id, shift.store_id, upsell_type, text)
            # Not acknowledged separately — an upsell mention usually rides
            # along with other conversation, no need for an extra reply.

        if not is_purchase_request_message(text):
            return False

        if shift is None:
            await notify_employee(
                message.bot,
                employee,
                "Сначала отметьте начало смены (напишите, что вы на месте).",
                message,
            )
            return True

        product = extract_product(text)
        if not product:
            await notify_employee(
                message.bot, employee, "Что именно закончилось? Уточните название товара.", message
            )
            return True

        await create_purchase_request(session, employee.id, shift.store_id, product)

    await notify_employee(message.bot, employee, "Добавил в список закупки 👍", message)
    return True


async def _try_handle_question_reply(message: Message, employee: Employee) -> bool:
    """Last resort in the chain: if it looks like a question, answer it from
    the company knowledge base (docs/03_AI_BRAIN.md §7, §13 — never invent).
    """
    text = message.text or ""
    if not looks_like_question(text):
        return False

    async with get_session() as session:
        knowledge_base = await get_knowledge_base_text(session)

    answer = await answer_employee_question(text, knowledge_base)
    await notify_employee(message.bot, employee, answer, message)
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

        is_shift_start = is_shift_start_message(message.text or "")
        store = None
        if is_shift_start:
            stores = await list_store_options(session)
            store = match_store(message.text or "", stores)

    # Session closed above before any slower/network-bound step (task reply,
    # purchase/revenue lookups, and especially the AI Processing Layer call
    # for questions) so we're not holding a DB connection open during those.
    if not is_shift_start:
        if await _try_handle_task_reply(message, employee):
            return
        if await _try_handle_revenue_reply(message, employee):
            return
        if await _try_handle_purchase_reply(message, employee):
            return
        await _try_handle_question_reply(message, employee)
        return

    if store is None:
        await state.set_state(ShiftClarification.awaiting_store)
        await message.reply("В каком магазине вы сегодня работаете?")
        return

    async with get_session() as session:
        await record_shift_start(session, employee.id, store.id)
    await _confirm_shift(message, employee, store.id, store.name)
