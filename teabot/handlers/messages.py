"""Обработка текстовых сообщений: свободные вопросы и режим поиска цены."""
import logging
import time

from telegram import Update
from telegram.ext import ContextTypes

from . import get_ai, get_search
from . import hub as hub_flow
from . import social as social_flow
from .commands import menu
from ..constants import WAYSTEA_PROMO, is_buy_question

logger = logging.getLogger(__name__)


async def safe_edit(msg, text: str, update: Update = None, parse_mode: str = None):
    try:
        await msg.edit_text(text, parse_mode=parse_mode)
    except Exception as e:
        logger.warning(f"edit_text не удался: {e}")
        if update:
            try:
                await update.message.reply_text(text, parse_mode=parse_mode)
            except Exception as e2:
                logger.error(f"reply_text тоже не удался: {e2}")


async def fast_reply(update: Update, ctx: ContextTypes.DEFAULT_TYPE, text: str):
    msg = await update.message.reply_text("⏳ Ищу в китайских источниках...")
    start = time.time()

    search_data = await get_search(ctx).search_china(text)

    if search_data:
        answer = await get_ai(ctx).ask(
            f"Вопрос о чае: {text}\n\n"
            f"Данные из поиска (переведи китайский текст на русский):\n{search_data}\n\n"
            f"Дай полный развёрнутый ответ на русском языке."
        )
    else:
        answer = await get_ai(ctx).ask(
            f"Вопрос о чае: {text}\n\n"
            f"Используй знания о китайском чае и дай полный ответ на русском."
        )

    elapsed = time.time() - start
    source = "🇨🇳 Китай + 🇷🇺 Россия" if search_data else "AI"
    footer = f"\n\n⚡ {elapsed:.1f}сек | {source}"

    # Добавляем рекомендацию Waystea если вопрос о покупке
    promo = WAYSTEA_PROMO if is_buy_question(text) else ""

    await safe_edit(
        msg,
        f"{answer}{footer}{promo}",
        update,
        parse_mode='HTML'
    )


async def on_msg(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.text:
        return
    text = update.message.text.strip()

    # Диалог /post ждёт текст поста или ссылку на медиа — вопросом о чае это не является
    if social_flow.is_waiting_for_text(ctx):
        return await social_flow.on_text(update, ctx)

    if text.lower() in ["привет", "/start", "меню", "старт"]:
        ctx.user_data.clear()
        return await menu(update, ctx)

    # Режим штаба: сообщение — это поручение команде, а не вопрос о чае
    if hub_flow.is_active(ctx):
        return await hub_flow.on_text(update, ctx)

    if ctx.user_data.get("mode") == "price":
        ctx.user_data.pop("mode", None)
        msg = await update.message.reply_text("💰 Ищу цены...")
        search_data = await get_search(ctx).search_china(
            f"купить {text} цена"
        )
        answer = await get_ai(ctx).ask(
            f"Найди информацию о цене на чай '{text}'. "
            f"Данные из поиска:\n{search_data}\n\n"
            f"Дай конкретный ответ с примерными ценами в рублях и юанях."
        )
        await safe_edit(
            msg,
            f"{answer}\n\n{WAYSTEA_PROMO}",
            update,
            parse_mode='HTML'
        )
        return

    await fast_reply(update, ctx, text)
