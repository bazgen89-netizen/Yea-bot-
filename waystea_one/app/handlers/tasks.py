from aiogram import F, Router
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from app.db import get_session
from app.models import ProofType, Task
from app.services.identity import get_employee
from app.services.tasks import complete_task, get_task, get_waiting_proof_task, start_completion

router = Router(name="tasks")

PROOF_PROMPTS = {
    ProofType.PHOTO.value: "Отлично 👍 Пришли, пожалуйста, фото результата.",
    ProofType.COMMENT.value: "Отлично 👍 Добавь, пожалуйста, комментарий.",
}


def checklist_keyboard(tasks: list[Task]) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text=f"✅ {task.title}", callback_data=f"task_done:{task.id}")]
        for task in tasks
    ]
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def send_daily_checklist(message: Message, tasks: list[Task]) -> None:
    if not tasks:
        return
    lines = "\n".join(f"☐ {task.title}" for task in tasks)
    await message.answer(
        f"Задачи на сегодня:\n{lines}",
        reply_markup=checklist_keyboard(tasks),
    )


@router.callback_query(F.data.startswith("task_done:"))
async def on_task_done(callback: CallbackQuery) -> None:
    task_id = int(callback.data.split(":", 1)[1])
    async with get_session() as session:
        task = await get_task(session, task_id)
        if task is None:
            await callback.answer("Задача не найдена.")
            return

        proof_needed = await start_completion(session, task)

    if proof_needed:
        await callback.message.answer(PROOF_PROMPTS[proof_needed])
        await callback.answer()
    else:
        await callback.answer("Готово, отмечено ✅")


@router.message(F.photo)
async def on_photo_proof(message: Message) -> None:
    async with get_session() as session:
        employee = await get_employee(session, message.from_user.id)
        if employee is None:
            return
        task = await get_waiting_proof_task(session, employee.id)
        if task is None or task.proof_type != ProofType.PHOTO.value:
            return
        await complete_task(session, task)
    await message.reply("Спасибо! Задача закрыта ✅")
