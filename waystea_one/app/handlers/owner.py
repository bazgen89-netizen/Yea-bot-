from aiogram import Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from app.config import settings
from app.db import get_session
from app.services.knowledge import create_knowledge_entry
from app.services.reports import build_daily_report

router = Router(name="owner")


class AddKnowledge(StatesGroup):
    awaiting_title = State()
    awaiting_content = State()


def _is_owner(message) -> bool:
    return message.from_user.id == settings.owner_telegram_id


@router.message(Command("start"))
async def on_start_command(message) -> None:
    """No operational purpose beyond a friendly greeting — the important
    part already happened once the employee sent /start at all: Telegram
    now allows the bot to message them privately (see
    app/services/messaging.py). Registered before shift.py's catch-all
    F.text handler so it doesn't get swallowed there.
    """
    await message.answer(
        "Привет! Я WAYSTEA ONE 😊\n"
        "Пишите в общий рабочий чат как обычно — про начало смены, "
        "выполнение задач, закупки, выручку. А сюда, в личные сообщения, "
        "я буду присылать подтверждения и список задач."
    )


@router.message(Command("report"))
async def on_report_command(message) -> None:
    if not _is_owner(message):
        return
    async with get_session() as session:
        report = await build_daily_report(session)
    await message.answer(report)


@router.message(Command("addknowledge"))
async def on_addknowledge_command(message, state: FSMContext) -> None:
    """Lets the owner grow the company knowledge base (used to answer
    employee questions, docs/03_AI_BRAIN.md §7) directly from Telegram,
    instead of needing a code change for every new entry.
    """
    if not _is_owner(message):
        return
    await state.set_state(AddKnowledge.awaiting_title)
    await message.answer(
        "Добавляем запись в базу знаний.\n"
        "Как назвать тему (например: «Заваривание Улуна» или «Возврат товара»)?"
    )


@router.message(AddKnowledge.awaiting_title)
async def receive_knowledge_title(message, state: FSMContext) -> None:
    title = (message.text or "").strip()
    if not title:
        await message.answer("Название не может быть пустым, напишите ещё раз.")
        return
    await state.update_data(knowledge_title=title)
    await state.set_state(AddKnowledge.awaiting_content)
    await message.answer("Теперь напишите содержание — всё, что сотрудники должны об этом знать.")


@router.message(AddKnowledge.awaiting_content)
async def receive_knowledge_content(message, state: FSMContext) -> None:
    content = (message.text or "").strip()
    if not content:
        await message.answer("Содержание не может быть пустым, напишите ещё раз.")
        return

    data = await state.get_data()
    title = data.get("knowledge_title", "Без названия")
    await state.clear()

    async with get_session() as session:
        await create_knowledge_entry(session, title, content)

    await message.answer(
        f"Добавил в базу знаний: «{title}» 👍\n"
        "Сотрудники теперь смогут получить ответ по этой теме."
    )
