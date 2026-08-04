"""Команды раздела «Магазины»: карточки на картах, отзывы, ответы на отзывы."""
import logging

from telegram import Update
from telegram.ext import ContextTypes

from . import get_admin_chat_id, get_stores
from ..stores import PLATFORM_TITLES, ReplyNotSupported
from ..stores.formatting import format_reviews, format_stores

logger = logging.getLogger(__name__)

DISABLED_TEXT = (
    "📍 Раздел «Магазины» не настроен.\n\n"
    "Нужно добавить точки в <code>stores.json</code> и задать ключи площадок "
    "(<code>YANDEX_MAPS_KEY</code>, <code>TWOGIS_KEY</code>, "
    "<code>GOOGLE_PLACES_KEY</code>). Инструкция — <code>docs/STORES.md</code>."
)

REPLY_USAGE = (
    "Использование:\n"
    "<code>/reply &lt;магазин&gt; &lt;площадка&gt; &lt;id_отзыва&gt; &lt;текст&gt;</code>\n\n"
    "Например: <code>/reply waystea-msk google AbC123 Спасибо за отзыв!</code>"
)


async def stores_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/stores — карточки всех точек на всех подключённых площадках."""
    await _send_stores(update.message, ctx)


async def show_stores(message, ctx: ContextTypes.DEFAULT_TYPE):
    """То же, что /stores, но для нажатия кнопки меню."""
    await _send_stores(message, ctx)


async def _send_stores(message, ctx: ContextTypes.DEFAULT_TYPE):
    service = get_stores(ctx)
    if service is None or not service.enabled:
        await message.reply_text(DISABLED_TEXT, parse_mode="HTML")
        return

    status = await message.reply_text("⏳ Собираю данные с карт...")
    batches = await service.all_cards()
    await message.reply_text(
        format_stores(batches), parse_mode="HTML", disable_web_page_preview=True
    )
    try:
        await status.delete()
    except Exception:
        pass  # сообщение мог удалить пользователь — не повод падать


async def reviews_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/reviews — свежие отзывы со всех площадок, что их отдают."""
    service = get_stores(ctx)
    if service is None or not service.enabled:
        await update.message.reply_text(DISABLED_TEXT, parse_mode="HTML")
        return

    await update.message.reply_text("⏳ Загружаю отзывы...")
    reviews = await service.all_reviews()
    titles = {s.slug: s.title for s in service.registry}
    await update.message.reply_text(
        format_reviews(reviews, titles), parse_mode="HTML", disable_web_page_preview=True
    )


async def reply_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/reply — ответ владельца на отзыв (доступно только админу)."""
    admin_id = get_admin_chat_id(ctx)
    if not admin_id or update.effective_chat.id != admin_id:
        await update.message.reply_text("⛔ Команда доступна только владельцу магазина.")
        return

    service = get_stores(ctx)
    if service is None:
        await update.message.reply_text(DISABLED_TEXT, parse_mode="HTML")
        return

    args = (ctx.args or [])
    if len(args) < 4:
        await update.message.reply_text(REPLY_USAGE, parse_mode="HTML")
        return

    slug, platform, review_id = args[0], args[1], args[2]
    text = " ".join(args[3:])
    if platform not in PLATFORM_TITLES:
        await update.message.reply_text(
            f"Неизвестная площадка «{platform}». Доступные: "
            + ", ".join(PLATFORM_TITLES)
        )
        return

    try:
        await service.reply_to_review(slug, platform, review_id, text)
    except ReplyNotSupported as e:
        await update.message.reply_text(f"⚠️ {e}")
    except Exception as e:
        logger.warning(f"Ответ на отзыв не отправлен: {e}")
        await update.message.reply_text(f"❌ Не удалось отправить ответ: {str(e)[:150]}")
    else:
        await update.message.reply_text("✅ Ответ опубликован.")
