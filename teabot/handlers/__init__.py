"""Обработчики Telegram-обновлений и их регистрация."""
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, filters
)

from telegram.ext import ContextTypes

from ..services import GroqClient, SerperClient

# Ключи сервисов в bot_data (внедрение зависимостей без глобальных переменных)
SEARCH_KEY = "search_client"
AI_KEY = "ai_client"


def get_search(ctx: ContextTypes.DEFAULT_TYPE) -> SerperClient:
    return ctx.bot_data[SEARCH_KEY]


def get_ai(ctx: ContextTypes.DEFAULT_TYPE) -> GroqClient:
    return ctx.bot_data[AI_KEY]


def register_handlers(ptb: Application) -> None:
    from .commands import start_cmd, debug_cmd, brain_cmd, second_cmd
    from .messages import on_msg
    from .callbacks import on_cb
    from .social import (
        autopilot_cmd, inbox_cmd, on_social_cb, post_cmd, social_cmd,
    )

    ptb.add_handler(CommandHandler("start", start_cmd))
    ptb.add_handler(CommandHandler("debug", debug_cmd))
    ptb.add_handler(CommandHandler("brain", brain_cmd))
    ptb.add_handler(CommandHandler("second", second_cmd))

    # Единый центр соцсетей
    ptb.add_handler(CommandHandler("social", social_cmd))
    ptb.add_handler(CommandHandler("inbox", inbox_cmd))
    ptb.add_handler(CommandHandler("post", post_cmd))
    ptb.add_handler(CommandHandler("autopilot", autopilot_cmd))

    ptb.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_msg))
    # Кнопки соцсетей — до общего обработчика: он ловит любые callback_data
    ptb.add_handler(CallbackQueryHandler(on_social_cb, pattern=r"^soc:"))
    ptb.add_handler(CallbackQueryHandler(on_cb))
