from aiogram import Router
from aiogram.filters import Command

from app.config import settings
from app.db import get_session
from app.services.reports import build_daily_report

router = Router(name="owner")


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
    if message.from_user.id != settings.owner_telegram_id:
        return
    async with get_session() as session:
        report = await build_daily_report(session)
    await message.answer(report)
