"""Routes all employee-facing bot replies (confirmations and clarifying
questions alike) to the employee's private chat instead of the group, per
owner request.

If the private message fails — the person has never opened a DM with the
bot, or has blocked it — falls back to a group reply asking them to do
that once, so nothing silently disappears. This is what lets onboarding
(name, store clarification) go private too: a brand-new employee doesn't
have a private chat yet, so the very first attempt falls back to the
group automatically, same as anyone else who hasn't started one.
"""
from aiogram import Bot
from aiogram.exceptions import TelegramAPIError
from aiogram.types import InlineKeyboardMarkup, Message

from app.models import Employee

NEEDS_PRIVATE_CHAT_HINT = (
    "{name}, не могу написать вам в личные сообщения. Откройте, пожалуйста, "
    "диалог с ботом напрямую (найдите его в Telegram и нажмите Start), "
    "и после этого личные сообщения заработают."
)


async def send_private(
    bot: Bot,
    telegram_user_id: int,
    name: str,
    text: str,
    fallback_message: Message,
    reply_markup: InlineKeyboardMarkup | None = None,
) -> None:
    try:
        await bot.send_message(telegram_user_id, text, reply_markup=reply_markup)
    except TelegramAPIError:
        await fallback_message.reply(NEEDS_PRIVATE_CHAT_HINT.format(name=name))


async def notify_employee(
    bot: Bot,
    employee: Employee,
    text: str,
    fallback_message: Message,
    reply_markup: InlineKeyboardMarkup | None = None,
) -> None:
    await send_private(bot, employee.telegram_user_id, employee.name, text, fallback_message, reply_markup)
