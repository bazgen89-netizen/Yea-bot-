from aiogram import F, Router
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from app.db import get_session
from app.models import Employee, ProofType, Store, Task
from app.services.identity import get_employee
from app.services.messaging import notify_employee
from app.services.reports import notify_owner_batch_progress
from app.services.shift_wrapup import send_shift_wrapup
from app.services.tasks import (
    advance_to_next_batch,
    complete_task,
    get_task,
    get_waiting_proof_task,
    start_completion,
)
from app.services.vision import verify_photo

router = Router(name="tasks")

PROOF_PROMPTS = {
    ProofType.PHOTO.value: "Отлично 👍 Пришли, пожалуйста, фото результата.",
    ProofType.COMMENT.value: "Отлично 👍 Добавь, пожалуйста, комментарий.",
}


def checklist_keyboard(tasks: list[Task]) -> InlineKeyboardMarkup:
    # Plain action label, not a checkmark — a checkmark here would look like
    # the task is already done before anyone's touched it.
    rows = [
        [InlineKeyboardButton(text=f"Отметить: {task.title}", callback_data=f"task_done:{task.id}")]
        for task in tasks
    ]
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def send_daily_checklist(
    bot, employee: Employee, tasks: list[Task], fallback_message: Message
) -> None:
    if not tasks:
        return
    lines = "\n".join(
        f"☐ {task.title}" + (f"\n    {task.description}" if task.description else "")
        for task in tasks
    )
    await notify_employee(
        bot,
        employee,
        f"Задачи на сегодня:\n{lines}",
        fallback_message,
        reply_markup=checklist_keyboard(tasks),
    )


async def _reveal_next_batch_if_ready(bot, employee: Employee, fallback_message: Message) -> None:
    async with get_session() as session:
        completed_batch, next_tasks = await advance_to_next_batch(session, employee.id)
        store = (
            await session.get(Store, completed_batch[0].store_id) if completed_batch else None
        )
    await notify_owner_batch_progress(bot, employee, store, completed_batch)
    if next_tasks:
        await send_daily_checklist(bot, employee, next_tasks, fallback_message)
    elif completed_batch:
        await send_shift_wrapup(bot, employee.telegram_user_id, completed_batch[0].store_id)


@router.callback_query(F.data.startswith("task_done:"))
async def on_task_done(callback: CallbackQuery) -> None:
    # Reply in the same chat as the checklist itself (private, since
    # send_daily_checklist sends it to the employee's DM) — no extra
    # routing needed here.
    task_id = int(callback.data.split(":", 1)[1])
    async with get_session() as session:
        task = await get_task(session, task_id)
        if task is None:
            await callback.answer("Задача не найдена.")
            return

        proof_needed = await start_completion(session, task)
        employee = await session.get(Employee, task.employee_id)

    if proof_needed:
        await callback.message.answer(PROOF_PROMPTS[proof_needed])
        await callback.answer()
        return

    await callback.answer("Готово, отмечено ✅")
    await _reveal_next_batch_if_ready(callback.bot, employee, callback.message)


@router.message(F.photo)
async def on_photo_proof(message: Message) -> None:
    async with get_session() as session:
        employee = await get_employee(session, message.from_user.id)
        if employee is None:
            return
        task = await get_waiting_proof_task(session, employee.id)
        if task is None or task.proof_type != ProofType.PHOTO.value:
            return
        task_id, criteria = task.id, task.verification_criteria

    # Verification (network call to the AI Processing Layer) happens with
    # no DB session open, same reasoning as app/handlers/shift.py.
    if criteria:
        photo = message.photo[-1]
        file = await message.bot.get_file(photo.file_id)
        file_bytes = await message.bot.download_file(file.file_path)
        result = await verify_photo(file_bytes.read(), criteria)
        if not result.passed:
            await notify_employee(
                message.bot,
                employee,
                f"Похоже, на фото не то, что нужно 🙂 {result.comment}\n"
                "Пришли, пожалуйста, ещё раз.",
                message,
            )
            return

    async with get_session() as session:
        task = await get_task(session, task_id)
        await complete_task(session, task, proof_comment=message.caption)
    await notify_employee(message.bot, employee, "Спасибо! Задача закрыта ✅", message)
    await _reveal_next_batch_if_ready(message.bot, employee, message)
