from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage

from app.config import settings
from app.handlers.owner import router as owner_router
from app.handlers.shift import router as shift_router
from app.handlers.tasks import router as tasks_router

bot = Bot(token=settings.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dispatcher = Dispatcher(storage=MemoryStorage())
dispatcher.include_router(tasks_router)
# Command handlers (owner_router) must be included before shift_router's
# generic F.text catch-all, or the catch-all would win first and "/report"
# would never reach on_report_command.
dispatcher.include_router(owner_router)
dispatcher.include_router(shift_router)
