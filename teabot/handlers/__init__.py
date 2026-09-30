"""Обработчики Telegram-обновлений и их регистрация."""
from telegram.ext import (
    Application, CommandHandler, MessageHandler,
    CallbackQueryHandler, filters
)

from telegram.ext import ContextTypes

from ..services import GroqClient, SerperClient, VpnManager

# Ключи сервисов в bot_data (внедрение зависимостей без глобальных переменных)
SEARCH_KEY = "search_client"
AI_KEY = "ai_client"
VPN_KEY = "vpn_manager"


def get_search(ctx: ContextTypes.DEFAULT_TYPE) -> SerperClient:
    return ctx.bot_data[SEARCH_KEY]


def get_ai(ctx: ContextTypes.DEFAULT_TYPE) -> GroqClient:
    return ctx.bot_data[AI_KEY]


def get_vpn(ctx: ContextTypes.DEFAULT_TYPE) -> VpnManager | None:
    """None, если VPN-модуль не сконфигурирован."""
    return ctx.bot_data.get(VPN_KEY)


def register_handlers(ptb: Application) -> None:
    from .commands import start_cmd, debug_cmd
    from .vpn import vpn_cmd, vpn_new_cmd, vpn_list_cmd, vpn_revoke_cmd
    from .messages import on_msg
    from .callbacks import on_cb

    ptb.add_handler(CommandHandler("start", start_cmd))
    ptb.add_handler(CommandHandler("debug", debug_cmd))
    ptb.add_handler(CommandHandler("vpn", vpn_cmd))
    ptb.add_handler(CommandHandler("vpn_new", vpn_new_cmd))
    ptb.add_handler(CommandHandler("vpn_list", vpn_list_cmd))
    ptb.add_handler(CommandHandler("vpn_revoke", vpn_revoke_cmd))
    ptb.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_msg))
    ptb.add_handler(CallbackQueryHandler(on_cb))
