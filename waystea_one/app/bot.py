from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.fsm.strategy import FSMStrategy

from app.config import settings
from app.handlers.brew import router as brew_router
from app.handlers.owner import router as owner_router
from app.handlers.quiz import router as quiz_router
from app.handlers.scenarios import router as scenarios_router
from app.handlers.shift import router as shift_router
from app.handlers.tasks import router as tasks_router
from app.handlers.tea_requests import router as tea_requests_router

bot = Bot(token=settings.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
# GLOBAL_USER (not the default PER-CHAT-CENTRIC strategy): our multi-turn
# dialogs (onboarding name, store clarification) can now be asked in one
# chat (group) and answered in another (the employee's private chat) once
# they open a DM with the bot — see app/services/messaging.py. Per-chat
# scoping would silently lose that state across chats.
dispatcher = Dispatcher(storage=MemoryStorage(), fsm_strategy=FSMStrategy.GLOBAL_USER)
dispatcher.include_router(tasks_router)
# Callback-only routers (quiz answers, brewed-tea buttons) — no text
# handlers, so they can't shadow anything below them.
dispatcher.include_router(quiz_router)
dispatcher.include_router(brew_router)
# Command handlers (owner_router) must be included before shift_router's
# generic F.text catch-all, or the catch-all would win first and "/report"
# would never reach on_report_command.
dispatcher.include_router(owner_router)
# Приём вопросов из зала и одобрение кандидатов — тоже до catch-all: и
# команда /ask, и ответ на неё должны попасть сюда, а не в разбор текста.
dispatcher.include_router(scenarios_router)
# The tea-request chat/topic (app/handlers/tea_requests.py) must also come
# before shift_router's generic F.text catch-all, same reasoning as
# owner_router above — otherwise a message there could get misread as a
# shift-start/task-reply/etc. instead.
dispatcher.include_router(tea_requests_router)
dispatcher.include_router(shift_router)
