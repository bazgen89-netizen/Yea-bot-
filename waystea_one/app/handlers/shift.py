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
- Store name resolution tries exact alias matching first, then falls back
  to the AI Processing Layer (app/services/intent.py::resolve_store) for
  phrasing the fixed alias list doesn't cover, before asking the employee
  to clarify — see that module's docstring for why this stays a fallback,
  not the primary path.
- Per owner decision, every employee-facing reply — including clarifying
  questions (name, which store) — goes to the employee's private chat, not
  the group; see app/services/messaging.py. If that fails (no private chat
  opened yet), it falls back to a group nudge instead. Multi-turn dialogs
  (name -> store) are scoped per-user, not per-chat (FSMStrategy.GLOBAL_USER
  in app/bot.py), so the question can be asked in one chat and answered in
  another without losing track.
"""
import logging

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import Message

from app.config import settings
from app.db import get_session
from app.handlers.tasks import PROOF_PROMPTS, send_daily_checklist
from app.models import Employee, ProofType, Store
from app.services.ai import (
    FALLBACK_EMPTY_KB,
    FALLBACK_ERROR,
    FALLBACK_NO_KEY,
    answer_employee_question,
    chat_reply,
)
from app.services.identity import (
    create_employee,
    get_employee,
    get_todays_shift,
    list_store_options,
    record_shift_start,
)
from app.services.intent import resolve_store
from app.services.knowledge import get_knowledge_base_text
from app.services.messaging import notify_employee, send_private
from app.services.music import MusicNudge, record_music_note
from app.services.purchasing import (
    create_purchase_request,
    extract_product,
    is_purchase_request_message,
)
from app.services.question_detector import looks_like_question
from app.services.reports import notify_owner_batch_progress
from app.services.revenue import (
    looks_like_revenue_message,
    parse_revenue_message,
    record_shift_revenue,
)
from app.services.shift_detector import is_shift_start_message
from app.services.tasks import (
    advance_to_next_batch,
    complete_task,
    create_daily_tasks_for_shift,
    get_waiting_proof_task,
    has_tasks_for_today,
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


class MoodCheck(StatesGroup):
    """Per owner decision: greet + ask how they're doing, have one short
    exchange, and only *then* hand over the first batch of tasks — not all
    of them at once. See app/handlers/tasks.py for batch delivery.
    """

    awaiting_response = State()


async def _confirm_shift(
    message: Message, state: FSMContext, employee: Employee, store_id: int, store_name: str
) -> None:
    await notify_employee(
        message.bot,
        employee,
        f"Доброе утро, {employee.name}! 😊\nСмена отмечена: {store_name}.\n"
        "Хорошего дня! Как настроение сегодня?",
        message,
    )
    await state.update_data(mood_check_store_id=store_id)
    await state.set_state(MoodCheck.awaiting_response)


@router.message(MoodCheck.awaiting_response)
async def receive_mood_response(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    store_id = data.get("mood_check_store_id")
    await state.clear()

    async with get_session() as session:
        employee = await get_employee(session, message.from_user.id)

    reply = await chat_reply(message.text or "")
    await notify_employee(message.bot, employee, reply, message)

    async with get_session() as session:
        tasks = await create_daily_tasks_for_shift(session, employee.id, store_id)
    await send_daily_checklist(message.bot, employee, tasks, message)


@router.message(MusicNudge.awaiting_response)
async def receive_music_response(message: Message, state: FSMContext) -> None:
    """Reply to the proactive music check-in (app/services/music.py) sent
    a couple of times per shift — logged and rolled into the daily owner
    report, not just acknowledged and discarded.
    """
    data = await state.get_data()
    store_id = data.get("music_store_id")
    await state.clear()

    async with get_session() as session:
        employee = await get_employee(session, message.from_user.id)
        await record_music_note(session, employee.id, store_id, message.text or "")

    await notify_employee(message.bot, employee, "Спасибо! 🎵", message)


async def _reveal_next_batch_if_ready(message: Message, employee: Employee) -> None:
    """After any task completion, check whether the currently-visible batch
    is now fully done — if so, send the next batch (3-5 tasks per owner
    decision), instead of ever showing all tasks at once. Also tells the
    owner right away which batch just closed, per owner decision — not
    only in the end-of-day report.
    """
    async with get_session() as session:
        completed_batch, next_tasks = await advance_to_next_batch(session, employee.id)
        store = (
            await session.get(Store, completed_batch[0].store_id) if completed_batch else None
        )
    await notify_owner_batch_progress(message.bot, employee, store, completed_batch)
    if next_tasks:
        await send_daily_checklist(message.bot, employee, next_tasks, message)


async def _try_handle_task_reply(message: Message, employee: Employee) -> bool:
    """Handles a non-shift text message as either proof for a task waiting
    on a comment, or a "готово"-style completion phrase. Returns True if the
    message was consumed as a task reply.
    """
    text = message.text or ""
    async with get_session() as session:
        waiting_task = await get_waiting_proof_task(session, employee.id)
        if waiting_task is not None and waiting_task.proof_type == ProofType.COMMENT.value:
            await complete_task(session, waiting_task, proof_comment=text)
            await notify_employee(message.bot, employee, "Спасибо! Задача закрыта ✅", message)
            await _reveal_next_batch_if_ready(message, employee)
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
        await _reveal_next_batch_if_ready(message, employee)
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

    await notify_employee(
        message.bot, employee, f"Добавил в список закупки: {product} 👍", message
    )
    return True


async def _try_handle_question_reply(message: Message, employee: Employee) -> bool:
    """Last resort in the chain: if it looks like a question, answer it via
    the AI Processing Layer (docs/03_AI_BRAIN.md §7, §13 — never invent
    facts about the shop; general conversation/questions about the bot
    itself are answered freely, see app/services/ai.py::SYSTEM_PROMPT).
    Only runs for private-chat messages — see handle_text, Decision 31.
    """
    text = message.text or ""
    if not looks_like_question(text):
        return False

    async with get_session() as session:
        knowledge_base = await get_knowledge_base_text(session)

    is_owner = message.from_user.id == settings.owner_telegram_id
    answer = await answer_employee_question(text, knowledge_base, include_debug=is_owner)
    await notify_employee(message.bot, employee, answer, message)

    # The answer itself tells the employee "I'll check with the owner and
    # get back to you" for a factual question the knowledge base doesn't
    # cover — that has to actually happen, not just be a line of text.
    if (
        answer.startswith(FALLBACK_NO_KEY)
        or answer.startswith(FALLBACK_EMPTY_KB)
        or answer.startswith(FALLBACK_ERROR)
    ):
        await _notify_owner_of_unanswered_question(message.bot, employee, text)
    return True


async def _notify_owner_of_unanswered_question(bot, employee: Employee, question: str) -> None:
    text = (
        "❓ Сотрудник задал вопрос, на который я не смог ответить из базы знаний.\n"
        f"Сотрудник: {employee.name}\n"
        f"Вопрос: {question}\n\n"
        "Можно ответить ему напрямую, а заодно добавить эту тему в базу "
        "знаний командой /addknowledge, чтобы в следующий раз я ответил сам."
    )
    try:
        await bot.send_message(settings.owner_telegram_id, text)
    except Exception:
        logging.getLogger(__name__).exception("Failed to notify owner about unanswered question")


@router.message(Onboarding.awaiting_name)
async def receive_name(message: Message, state: FSMContext) -> None:
    name = (message.text or "").strip()
    if not name:
        await send_private(
            message.bot,
            message.from_user.id,
            message.from_user.full_name,
            "Не расслышал имя, напишите, пожалуйста, ещё раз 🙂",
            message,
        )
        return

    data = await state.get_data()
    pending_text = data.get("pending_text", "")
    await state.clear()

    async with get_session() as session:
        employee = await create_employee(session, message.from_user.id, name)
        stores = await list_store_options(session) if pending_text else []

    await notify_employee(
        message.bot, employee, f"Приятно познакомиться, {employee.name}! Записал вас.", message
    )

    if pending_text and is_shift_start_message(pending_text):
        store = await resolve_store(pending_text, stores)
        if store is not None:
            async with get_session() as session:
                await record_shift_start(session, employee.id, store.id)
            await _confirm_shift(message, state, employee, store.id, store.name)
        else:
            await state.set_state(ShiftClarification.awaiting_store)
            await notify_employee(
                message.bot, employee, "В каком магазине вы сегодня работаете?", message
            )


@router.message(ShiftClarification.awaiting_store)
async def receive_store_clarification(message: Message, state: FSMContext) -> None:
    text = message.text or ""
    async with get_session() as session:
        employee = await get_employee(session, message.from_user.id)
        stores = await list_store_options(session)

    store = await resolve_store(text, stores)

    if store is None:
        store_names = ", ".join(s.name for s in stores)
        await notify_employee(
            message.bot,
            employee,
            f"Не понял, о каком магазине речь. Уточните, пожалуйста: {store_names}?",
            message,
        )
        return

    await state.clear()
    async with get_session() as session:
        await record_shift_start(session, employee.id, store.id)
    await _confirm_shift(message, state, employee, store.id, store.name)


@router.message(F.text)
async def handle_text(message: Message, state: FSMContext) -> None:
    async with get_session() as session:
        employee = await get_employee(session, message.from_user.id)

        if employee is None:
            await state.update_data(pending_text=message.text)
            await state.set_state(Onboarding.awaiting_name)
            await send_private(
                message.bot,
                message.from_user.id,
                message.from_user.full_name,
                "Здравствуйте! Я вас ещё не знаю 🙂 Как вас зовут?",
                message,
            )
            return

        is_shift_start = is_shift_start_message(message.text or "")
        existing_shift = await get_todays_shift(session, employee.id) if is_shift_start else None
        stores = (
            await list_store_options(session) if is_shift_start and existing_shift is None else []
        )

    # Session closed above before any slower/network-bound step (task reply,
    # purchase/revenue lookups, resolve_store's AI fallback, and the AI
    # Processing Layer call for questions) so we're not holding a DB
    # connection open during those.
    if not is_shift_start:
        if await _try_handle_task_reply(message, employee):
            return
        if await _try_handle_revenue_reply(message, employee):
            return
        if await _try_handle_purchase_reply(message, employee):
            return
        # Group-chat text is people talking to *each other* (the owner
        # asking employees something, employees chatting) — a trailing "?"
        # there doesn't mean it's addressed to the bot. Only escalate
        # question-shaped text from a private chat with the bot, where
        # there's no one else it could be directed at.
        if message.chat.type == "private":
            await _try_handle_question_reply(message, employee)
        return

    if existing_shift is not None:
        async with get_session() as session:
            stores = await list_store_options(session)
            tasks_started = await has_tasks_for_today(session, employee.id)
            open_tasks = await list_open_tasks(session, employee.id) if tasks_started else []
        store_name = next((s.name for s in stores if s.id == existing_shift.store_id), "")

        if not tasks_started:
            # The shift was recorded, but the mood-check exchange between
            # confirming it and creating tasks never finished (its FSM
            # state doesn't survive a process restart) — resume instead of
            # leaving the employee stuck with a shift but no tasks.
            await _confirm_shift(message, state, employee, existing_shift.store_id, store_name)
            return

        if open_tasks:
            # Tasks exist and are still open — resend them. Covers both a
            # normal re-announcement mid-shift and the case where the
            # checklist was created but never actually delivered (a failed
            # send earlier doesn't retry itself), so "где задачи?" always
            # gets an answer instead of a static "already confirmed" line.
            await notify_employee(
                message.bot,
                employee,
                f"Смена уже отмечена сегодня: {store_name}. Вот ваши текущие задачи:",
                message,
            )
            await send_daily_checklist(message.bot, employee, open_tasks, message)
            return

        # Already confirmed today and every currently-visible task is done.
        await notify_employee(
            message.bot,
            employee,
            f"Смена уже отмечена сегодня: {store_name}. Все текущие задачи выполнены 👍",
            message,
        )
        return

    store = await resolve_store(message.text or "", stores)

    if store is None:
        await state.set_state(ShiftClarification.awaiting_store)
        await notify_employee(
            message.bot, employee, "В каком магазине вы сегодня работаете?", message
        )
        return

    async with get_session() as session:
        await record_shift_start(session, employee.id, store.id)
    await _confirm_shift(message, state, employee, store.id, store.name)
