"""Команды /start, /debug, /brain, /second и главное меню."""
from telegram import Update
from telegram.ext import ContextTypes

from . import get_ai, get_search
from ..keyboards import main_menu_kb


async def menu(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🍵 <b>Tea Expert Bot</b>\nВыберите раздел или задайте вопрос:",
        reply_markup=main_menu_kb(),
        parse_mode='HTML'
    )


async def start_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    ctx.user_data.clear()
    await menu(update, ctx)


async def _brains_lines(ai) -> list:
    """Строки со статусом каждого мозга; основной помечен звёздочкой."""
    lines = []
    for name, model, status in await ai.statuses():
        mark = "⭐" if name.lower() == ai.primary else "  "
        lines.append(f"{mark} <b>{name}</b> ({model})")
        lines.append(f"     {status}")
    return lines


async def debug_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    ai = get_ai(ctx)
    search = get_search(ctx)

    lines = ["🔧 <b>Диагностика:</b>\n", "🧠 <b>Мозги:</b>"]
    lines += await _brains_lines(ai)

    lines.append("\n🔍 <b>Поиск Serper:</b>")
    lines.append(f"  🔑 {'ключ задан' if search.api_key else 'ключ не задан'}")
    lines.append(f"  {await search.health_check()}")

    await update.message.reply_text("\n".join(lines), parse_mode='HTML')


async def brain_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/brain — статус мозгов, /brain gemini — сменить основной."""
    ai = get_ai(ctx)

    if ctx.args:
        name = ctx.args[0]
        if not ai.switch(name):
            await update.message.reply_text(
                f"❌ Мозг «{name}» не подключён. Доступны: {', '.join(ai.names())}"
            )
            return
        brain = ai.primary_brain
        note = "" if getattr(brain, "available", False) else "\n⚠️ У него не задан ключ — отвечать будет запасной."
        await update.message.reply_text(
            f"🧠 Основной мозг: <b>{getattr(brain, 'name', ai.primary)}</b> "
            f"({getattr(brain, 'model', '')}){note}",
            parse_mode='HTML',
        )
        return

    lines = ["🧠 <b>Мозги бота</b>\n"]
    lines += await _brains_lines(ai)
    lines.append(
        "\nОсновной отвечает первым, второй подстраховывает при сбое."
        "\nСменить: <code>/brain gemini</code> · Второе мнение: <code>/second вопрос</code>"
    )
    await update.message.reply_text("\n".join(lines), parse_mode='HTML')


async def second_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/second <вопрос> — тот же вопрос запасному мозгу, для сравнения."""
    ai = get_ai(ctx)
    question = " ".join(ctx.args).strip() if ctx.args else ""
    if not question:
        await update.message.reply_text(
            "🧠 Напишите вопрос после команды: <code>/second чем шу отличается от шэн</code>",
            parse_mode='HTML',
        )
        return

    backup = ai.secondary_brain
    if backup is None:
        await update.message.reply_text(
            "⚠️ Запасной мозг не подключён — задайте GEMINI_API_KEY."
        )
        return

    name = getattr(backup, "name", "запасной")
    msg = await update.message.reply_text(f"🧠 Спрашиваю {name}...")
    answer = await backup.ask(question)
    await msg.edit_text(f"🧠 <b>{name}:</b>\n\n{answer}", parse_mode='HTML')
