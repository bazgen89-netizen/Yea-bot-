"""Команда /post — один текст сразу во все соцсети бренда через Metricool.

Диалог держится в ctx.user_data['social'] (тот же приём, что и режим «цены»
в messages.py), поэтому отдельный ConversationHandler не нужен:

    /post → текст поста → экран с тумблерами сетей → 🚀 Опубликовать
"""
import html
import logging
from typing import Optional

from telegram import Update
from telegram.ext import ContextTypes

from . import get_social, get_social_cfg
from ..keyboards import social_kb
from ..services.social import format_report
from .. import social as catalog

logger = logging.getLogger(__name__)

STATE_KEY = "social"
PREVIEW_LEN = 300


def _state(ctx: ContextTypes.DEFAULT_TYPE) -> Optional[dict]:
    return ctx.user_data.get(STATE_KEY)


def is_waiting_for_text(ctx: ContextTypes.DEFAULT_TYPE) -> bool:
    """Ждёт ли диалог кросспостинга обычное текстовое сообщение."""
    state = _state(ctx)
    return bool(state and state.get("step") in ("text", "media"))


def _new_state(networks) -> dict:
    return {"step": "text", "text": "", "media": [], "networks": set(networks)}


def _preview(state: dict, available) -> str:
    text = state["text"]
    shown = html.escape(text[:PREVIEW_LEN]) + ("…" if len(text) > PREVIEW_LEN else "")
    lines = [
        "📡 <b>Кросспостинг</b>",
        "",
        f"<b>Текст ({len(text)} симв.):</b>",
        shown or "<i>пусто</i>",
    ]

    media = state["media"]
    lines.append(f"\n<b>Медиа:</b> {html.escape(media[0]) if media else '<i>нет</i>'}")

    chosen = [c for c in available if c in state["networks"]]
    names = ", ".join(catalog.title(c) for c in chosen) if chosen else "<i>не выбраны</i>"
    lines.append(f"\n<b>Сети:</b> {names}")

    problems = catalog.validate(text, media, chosen)
    if problems:
        lines.append("\n⚠️ <b>Нужно поправить:</b>")
        lines += [f"• {html.escape(p)}" for p in problems]

    return "\n".join(lines)


def _screen(state: dict, available):
    return (
        _preview(state, available),
        social_kb(available, state["networks"], bool(state["media"])),
    )


async def _redraw(msg, state: dict, available) -> None:
    """Перерисовывает экран кросспостинга; если правка не прошла — шлёт новый."""
    text, kb = _screen(state, available)
    try:
        await msg.edit_text(text, reply_markup=kb, parse_mode="HTML")
    except Exception as e:
        logger.warning(f"Не удалось обновить экран кросспостинга: {e}")
        await msg.reply_text(text, reply_markup=kb, parse_mode="HTML")


async def post_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    cfg = get_social_cfg(ctx)
    client = get_social(ctx)

    if not cfg.allows(update.effective_user.id):
        await update.message.reply_text(
            "🔒 Публикация в соцсети доступна только администраторам бренда.\n"
            "Добавьте свой Telegram ID в переменную <code>SOCIAL_ADMINS</code>.",
            parse_mode="HTML",
        )
        return

    if not client.enabled:
        await update.message.reply_text(
            "⚠️ Кросспостинг не настроен.\n\n"
            "Задайте переменные окружения:\n"
            "<code>METRICOOL_USER_TOKEN</code>, <code>METRICOOL_USER_ID</code>, "
            "<code>METRICOOL_BLOG_ID</code>.",
            parse_mode="HTML",
        )
        return

    ctx.user_data[STATE_KEY] = _new_state(cfg.networks)
    await update.message.reply_text(
        "📝 Пришлите текст поста одним сообщением.\n"
        "Дальше выберете, в какие сети он уйдёт.",
    )


async def on_text(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Текст поста или ссылка на медиа — в зависимости от текущего шага."""
    state = _state(ctx)
    if not state:
        return

    cfg = get_social_cfg(ctx)
    value = update.message.text.strip()

    if state["step"] == "media":
        if not value.lower().startswith(("http://", "https://")):
            await update.message.reply_text(
                "⚠️ Нужна прямая ссылка на файл (http:// или https://). Попробуйте ещё раз."
            )
            return
        state["media"] = [value]
    else:
        state["text"] = value

    state["step"] = "ready"
    text, kb = _screen(state, cfg.networks)
    await update.message.reply_text(text, reply_markup=kb, parse_mode="HTML")


async def on_cb(update: Update, ctx: ContextTypes.DEFAULT_TYPE) -> None:
    """Кнопки экрана кросспостинга (callback_data с префиксом soc_)."""
    q = update.callback_query
    data, msg = q.data, q.message
    cfg = get_social_cfg(ctx)
    state = _state(ctx)

    if not state:
        await msg.reply_text("Сессия публикации истекла. Начните заново: /post")
        return

    if data == "soc_cancel":
        ctx.user_data.pop(STATE_KEY, None)
        await msg.edit_text("❌ Публикация отменена.")
        return

    if data == "soc_media":
        state["step"] = "media"
        await msg.reply_text("🖼 Пришлите ссылку на фото или видео (публичный URL).")
        return

    if data == "soc_all":
        state["networks"] = set(cfg.networks)
    elif data == "soc_none":
        state["networks"] = set()
    elif data.startswith("soc_net_"):
        code = data[len("soc_net_"):]
        if code in cfg.networks:
            state["networks"].symmetric_difference_update({code})
    elif data in ("soc_send", "soc_draft"):
        await _publish(q, ctx, state, cfg, draft=(data == "soc_draft"))
        return

    await _redraw(msg, state, cfg.networks)


async def _publish(q, ctx, state: dict, cfg, draft: bool) -> None:
    chosen = [c for c in cfg.networks if c in state["networks"]]
    problems = catalog.validate(state["text"], state["media"], chosen)
    if problems:
        await q.message.reply_text(
            "⚠️ Пост пока нельзя отправить:\n" + "\n".join(f"• {p}" for p in problems)
        )
        return

    status = await q.message.reply_text("📡 Отправляю в соцсети...")
    results = await get_social(ctx).publish(
        state["text"], chosen, state["media"], draft=draft
    )
    ctx.user_data.pop(STATE_KEY, None)

    try:
        await status.edit_text(format_report(results), parse_mode="HTML")
    except Exception as e:
        logger.warning(f"Не удалось показать отчёт: {e}")
        await q.message.reply_text(format_report(results), parse_mode="HTML")
