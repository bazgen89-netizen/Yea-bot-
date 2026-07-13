"""Routes employee-facing bot replies to their private chat instead of the
group, per owner request: task/shift/revenue/purchase/question responses
should be personal, not visible to the whole team.

Clarifying questions (onboarding name, store clarification) stay as group
replies on purpose — a brand-new employee has never opened a private chat
with the bot yet, and Telegram forbids a bot from messaging a user who
hasn't started a conversation with it first. Attempting those privately
would just fail for exactly the people who need them most.

For everything else, if the private message fails (employee has never
opened a DM with the bot, or blocked it), fall back to a group reply asking
them to do that once — so nothing silently disappears.
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


async def notify_employee(
    bot: Bot,
    employee: Employee,
    text: str,
    fallback_message: Message,
    reply_markup: InlineKeyboardMarkup | None = None,
) -> None:
    try:
        await bot.send_message(employee.telegram_user_id, text, reply_markup=reply_markup)
    except TelegramAPIError:
        await fallback_message.reply(NEEDS_PRIVATE_CHAT_HINT.format(name=employee.name))
