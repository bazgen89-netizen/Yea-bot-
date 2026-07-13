from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage

from app.config import settings
from app.handlers.shift import router as shift_router
from app.handlers.tasks import router as tasks_router

bot = Bot(token=settings.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dispatcher = Dispatcher(storage=MemoryStorage())
dispatcher.include_router(tasks_router)
dispatcher.include_router(shift_router)
