from aiogram import Router
from aiogram.filters import Command

from app.config import settings
from app.db import get_session
from app.services.reports import build_daily_report

router = Router(name="owner")


@router.message(Command("report"))
async def on_report_command(message) -> None:
    if message.from_user.id != settings.owner_telegram_id:
        return
    async with get_session() as session:
        report = await build_daily_report(session)
    await message.answer(report)
