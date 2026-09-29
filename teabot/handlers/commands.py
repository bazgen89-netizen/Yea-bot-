"""Команды /start и /debug, главное меню."""
from telegram import Update
from telegram.ext import ContextTypes

from . import get_ai, get_search, get_social, get_social_cfg
from ..keyboards import main_menu_kb
from ..social import title as network_title


async def menu(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🍵 <b>Tea Expert Bot</b>\nВыберите раздел или задайте вопрос:",
        reply_markup=main_menu_kb(),
        parse_mode='HTML'
    )


async def start_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    ctx.user_data.clear()
    await menu(update, ctx)


async def debug_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    ai = get_ai(ctx)
    search = get_search(ctx)

    lines = ["🔧 <b>Диагностика:</b>\n"]
    lines.append(f"🔑 GROQ_API_KEY: {'✅ задан' if ai.api_key else '❌ не задан'}")
    lines.append(f"🔑 SERPER_KEY: {'✅ задан' if search.api_key else '⚠️ не задан'}")
    lines.append(f"🤖 Модель: {ai.model}\n")

    lines.append("🤖 <b>Groq AI:</b>")
    lines.append(f"  {await ai.health_check()}")

    lines.append("\n🔍 <b>Поиск Serper:</b>")
    lines.append(f"  {await search.health_check()}")

    social, cfg = get_social(ctx), get_social_cfg(ctx)
    lines.append("\n📡 <b>Кросспостинг (Metricool):</b>")
    lines.append(f"  {await social.health_check()}")
    lines.append(f"  Сети: {', '.join(network_title(c) for c in cfg.networks) or '—'}")
    lines.append(f"  Админов: {len(cfg.admins)}")

    await update.message.reply_text("\n".join(lines), parse_mode='HTML')
