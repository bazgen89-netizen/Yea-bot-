"""Routes all employee-facing bot replies (confirmations, task lists,
clarifying questions) to the employee's private chat — never the group,
per owner request ("писать не всем в чате, а кто написал что на месте").

Telegram won't let a bot message someone who's never opened a DM with it.
When that happens we do NOT post anything in the group (the owner doesn't
want public bot messages there). Instead we tell the owner privately, once
per employee per day, that this person needs to open a chat with the bot
and press Start — after they do, everything reaches them privately.
"""
import datetime
import logging

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError
from aiogram.types import InlineKeyboardMarkup, Message

from app.config import settings
from app.models import Employee

logger = logging.getLogger(__name__)

OWNER_DM_MISSING_HINT = (
    "⚠️ Не смог написать сотруднику {name} в личные сообщения — он ещё не "
    "открыл диалог с ботом. Попросите его найти бота в Telegram и нажать "
    "Start, после этого всё будет приходить ему в личку."
)

# Dedupe the owner heads-up to once per (employee, day) so a whole shift's
# worth of failed private sends (greeting, mood, every task batch, ...)
# doesn't turn into a flood of identical owner pings. In-memory is fine:
# worst case a process restart re-notifies once.
_owner_notified: set[tuple[int, datetime.date]] = set()


async def send_private(
    bot: Bot,
    telegram_user_id: int,
    name: str,
    text: str,
    fallback_message: Message | None = None,
    reply_markup: InlineKeyboardMarkup | None = None,
) -> None:
    """Send `text` to the user's private chat. On failure (no DM opened),
    quietly tell the owner once — never post in the group.

    `fallback_message` is kept for call-site compatibility but is no longer
    used to reply in the group; the owner is notified privately instead.
    """
    try:
        await bot.send_message(telegram_user_id, text, reply_markup=reply_markup)
    except TelegramAPIError:
        await _notify_owner_dm_missing(bot, telegram_user_id, name)


async def _notify_owner_dm_missing(bot: Bot, telegram_user_id: int, name: str) -> None:
    key = (telegram_user_id, datetime.date.today())
    if key in _owner_notified:
        return
    _owner_notified.add(key)
    try:
        await bot.send_message(settings.owner_telegram_id, OWNER_DM_MISSING_HINT.format(name=name))
    except Exception:
        logger.exception("Failed to notify owner that %s has no DM open", name)


async def notify_employee(
    bot: Bot,
    employee: Employee,
    text: str,
    fallback_message: Message | None = None,
    reply_markup: InlineKeyboardMarkup | None = None,
) -> None:
    await send_private(
        bot, employee.telegram_user_id, employee.name, text, fallback_message, reply_markup
    )
