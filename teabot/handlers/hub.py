"""Команда /team — единый чат, из которого работает вся команда ИИ.

Одно сообщение разбирается на задачи, задачи расходятся исполнителям,
в тот же чат приходит общий отчёт.

    /team <текст>  — разовый прогон
    /team          — включить/выключить режим штаба для этого чата
"""
import logging

from telegram import Update
from telegram.ext import ContextTypes

from . import get_ai, get_search, get_social, get_social_cfg
from ..hub import Deps, Router, format_plan, format_results, run_plan

logger = logging.getLogger(__name__)

MODE_KEY = "hub_mode"
TG_LIMIT = 3800


def is_active(ctx: ContextTypes.DEFAULT_TYPE) -> bool:
    return bool(ctx.user_data.get(MODE_KEY))


def _deps(ctx: ContextTypes.DEFAULT_TYPE) -> Deps:
    return Deps(
        ai=get_ai(ctx),
        search=get_search(ctx),
        social=get_social(ctx),
        networks=get_social_cfg(ctx).networks,
    )


async def _send_long(msg, text: str) -> None:
    """Отчёт может не влезть в одно сообщение Telegram — режем по абзацам."""
    chunk = ""
    for block in text.split("\n\n"):
        if len(chunk) + len(block) + 2 > TG_LIMIT and chunk:
            await msg.reply_text(chunk, parse_mode="HTML")
            chunk = ""
        chunk = f"{chunk}\n\n{block}" if chunk else block
    if chunk:
        await msg.reply_text(chunk, parse_mode="HTML")


async def handle(update: Update, ctx: ContextTypes.DEFAULT_TYPE, text: str) -> None:
    """Полный цикл: разбор сообщения → исполнение → отчёт."""
    deps = _deps(ctx)
    status = await update.message.reply_text("🧠 Разбираю сообщение на задачи...")

    plan = await Router(get_ai(ctx)).plan(text, deps)
    if not plan.tasks:
        note = plan.note or "Не нашёл здесь задач для команды."
        await status.edit_text(f"🤔 {note}")
        return

    try:
        await status.edit_text(format_plan(plan), parse_mode="HTML")
    except Exception as e:
        logger.warning(f"Не удалось показать план: {e}")

    results = await run_plan(deps, plan)
    await _send_long(update.message, format_results(results))


async def team_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not get_social_cfg(ctx).allows(update.effective_user.id):
        await update.message.reply_text(
            "🔒 Команда ИИ доступна только администраторам бренда "
            "(переменная <code>SOCIAL_ADMINS</code>).",
            parse_mode="HTML",
        )
        return

    text = " ".join(ctx.args).strip() if getattr(ctx, "args", None) else ""
    if text:
        await handle(update, ctx, text)
        return

    enabled = not is_active(ctx)
    ctx.user_data[MODE_KEY] = enabled
    if enabled:
        await update.message.reply_text(
            "🧠 <b>Режим штаба включён.</b>\n"
            "Пишите задачи обычными сообщениями — разберу и раздам исполнителям.\n"
            "Выключить: /team",
            parse_mode="HTML",
        )
    else:
        await update.message.reply_text("🧠 Режим штаба выключен. Отвечаю как обычно.")


async def on_text(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Сообщение, пришедшее во включённом режиме штаба."""
    await handle(update, ctx, update.message.text.strip())
