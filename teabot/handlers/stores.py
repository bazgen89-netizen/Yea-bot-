"""Команды раздела «Магазины»: карточки на картах, отзывы, ответы на отзывы."""
import logging

from telegram import Update
from telegram.ext import ContextTypes

from . import get_admin_chat_id, get_stores
from ..stores import ActionNotSupported, PLATFORM_TITLES, ReplyNotSupported
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

PHOTO_USAGE = (
    "Использование:\n"
    "<code>/photo &lt;магазин&gt; &lt;площадка&gt; &lt;ссылка&gt; [категория]</code>\n\n"
    "Категории Google: <code>ADDITIONAL</code> (по умолчанию), <code>INTERIOR</code>, "
    "<code>EXTERIOR</code>, <code>PRODUCT</code>, <code>FOOD_AND_DRINK</code>, "
    "<code>TEAM</code>, <code>COVER</code>, <code>PROFILE</code>.\n"
    "Ссылка должна быть публичной и вести прямо на JPG/PNG."
)

SETINFO_USAGE = (
    "Использование:\n"
    "<code>/setinfo &lt;магазин&gt; &lt;площадка&gt; &lt;поле&gt; &lt;значение&gt;</code>\n\n"
    "Поля: <code>description</code>, <code>website</code>, <code>phone</code>.\n"
    "Например: <code>/setinfo waystea-msk google description Чайная лавка прямых "
    "поставок из Юньнани</code>"
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


async def _owner_action(update: Update, ctx: ContextTypes.DEFAULT_TYPE,
                        min_args: int, usage: str, action, success: str) -> None:
    """Общая обвязка команд владельца: доступ, аргументы, ошибки площадки.

    action(service, args) выполняет само действие; всё остальное — одинаково
    для /reply, /photo и /setinfo.
    """
    admin_id = get_admin_chat_id(ctx)
    if not admin_id or update.effective_chat.id != admin_id:
        await update.message.reply_text("⛔ Команда доступна только владельцу магазина.")
        return

    service = get_stores(ctx)
    if service is None:
        await update.message.reply_text(DISABLED_TEXT, parse_mode="HTML")
        return

    args = ctx.args or []
    if len(args) < min_args:
        await update.message.reply_text(usage, parse_mode="HTML")
        return

    platform = args[1]
    if platform not in PLATFORM_TITLES:
        await update.message.reply_text(
            f"Неизвестная площадка «{platform}». Доступные: "
            + ", ".join(PLATFORM_TITLES)
        )
        return

    try:
        await action(service, args)
    except ActionNotSupported as e:
        await update.message.reply_text(f"⚠️ {e}")
    except ValueError as e:
        await update.message.reply_text(f"⚠️ {e}")
    except Exception as e:
        logger.warning(f"Действие владельца не выполнено: {e}")
        await update.message.reply_text(f"❌ Не удалось выполнить: {str(e)[:150]}")
    else:
        await update.message.reply_text(success)


async def reply_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/reply — ответ владельца на отзыв."""
    await _owner_action(
        update, ctx, min_args=4, usage=REPLY_USAGE,
        action=lambda service, args: service.reply_to_review(
            args[0], args[1], args[2], " ".join(args[3:])
        ),
        success="✅ Ответ опубликован.",
    )


async def photo_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/photo — добавить фото в карточку по ссылке на изображение."""
    await _owner_action(
        update, ctx, min_args=3, usage=PHOTO_USAGE,
        action=lambda service, args: service.upload_photo(
            args[0], args[1], args[2],
            args[3].upper() if len(args) > 3 else "ADDITIONAL",
        ),
        success="✅ Фото отправлено на публикацию (Google проверяет его до суток).",
    )


async def setinfo_cmd(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """/setinfo — правка описания, сайта или телефона в карточке."""
    await _owner_action(
        update, ctx, min_args=4, usage=SETINFO_USAGE,
        action=lambda service, args: service.update_info(
            args[0], args[1], {args[2]: " ".join(args[3:])}
        ),
        success="✅ Карточка обновлена.",
    )
