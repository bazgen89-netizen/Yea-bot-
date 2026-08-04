"""Обработчики Telegram-обновлений и их регистрация."""
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, filters
)

from telegram.ext import ContextTypes

from typing import Optional

from ..services import GroqClient, SerperClient
from ..stores import StoresService

# Ключи сервисов в bot_data (внедрение зависимостей без глобальных переменных)
SEARCH_KEY = "search_client"
AI_KEY = "ai_client"
STORES_KEY = "stores_service"
ADMIN_KEY = "admin_chat_id"


def get_search(ctx: ContextTypes.DEFAULT_TYPE) -> SerperClient:
    return ctx.bot_data[SEARCH_KEY]


def get_ai(ctx: ContextTypes.DEFAULT_TYPE) -> GroqClient:
    return ctx.bot_data[AI_KEY]


def get_stores(ctx: ContextTypes.DEFAULT_TYPE) -> Optional[StoresService]:
    """None, если раздел «Магазины» не собран (нет реестра или ключей)."""
    return ctx.bot_data.get(STORES_KEY)


def get_admin_chat_id(ctx: ContextTypes.DEFAULT_TYPE) -> int:
    return ctx.bot_data.get(ADMIN_KEY, 0)


def register_handlers(ptb: Application) -> None:
    from .commands import start_cmd, debug_cmd
    from .messages import on_msg
    from .callbacks import on_cb
    from .stores import photo_cmd, reply_cmd, reviews_cmd, setinfo_cmd, stores_cmd

    ptb.add_handler(CommandHandler("start", start_cmd))
    ptb.add_handler(CommandHandler("debug", debug_cmd))
    ptb.add_handler(CommandHandler("stores", stores_cmd))
    ptb.add_handler(CommandHandler("reviews", reviews_cmd))
    ptb.add_handler(CommandHandler("reply", reply_cmd))
    ptb.add_handler(CommandHandler("photo", photo_cmd))
    ptb.add_handler(CommandHandler("setinfo", setinfo_cmd))
    ptb.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_msg))
    ptb.add_handler(CallbackQueryHandler(on_cb))
