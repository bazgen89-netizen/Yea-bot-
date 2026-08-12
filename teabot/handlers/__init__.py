"""Обработчики Telegram-обновлений и их регистрация."""
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, filters
)

from telegram.ext import ContextTypes

from ..services import GroqClient, MetricoolClient, SerperClient
from ..social import SocialConfig

# Ключи сервисов в bot_data (внедрение зависимостей без глобальных переменных)
SEARCH_KEY = "search_client"
AI_KEY = "ai_client"
SOCIAL_KEY = "social_client"
SOCIAL_CFG_KEY = "social_config"


def get_search(ctx: ContextTypes.DEFAULT_TYPE) -> SerperClient:
    return ctx.bot_data[SEARCH_KEY]


def get_ai(ctx: ContextTypes.DEFAULT_TYPE) -> GroqClient:
    return ctx.bot_data[AI_KEY]


def get_social(ctx: ContextTypes.DEFAULT_TYPE) -> MetricoolClient:
    return ctx.bot_data[SOCIAL_KEY]


def get_social_cfg(ctx: ContextTypes.DEFAULT_TYPE) -> SocialConfig:
    return ctx.bot_data[SOCIAL_CFG_KEY]


def register_handlers(ptb: Application) -> None:
    from .commands import start_cmd, debug_cmd
    from .messages import on_msg
    from .callbacks import on_cb
    from .social import post_cmd
    from .hub import team_cmd

    ptb.add_handler(CommandHandler("start", start_cmd))
    ptb.add_handler(CommandHandler("debug", debug_cmd))
    ptb.add_handler(CommandHandler("post", post_cmd))
    ptb.add_handler(CommandHandler("team", team_cmd))
    ptb.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_msg))
    ptb.add_handler(CallbackQueryHandler(on_cb))
