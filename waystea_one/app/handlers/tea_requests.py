"""Owner request: a dedicated "какой чай привезти" chat/topic where every
message IS a tea-restock request — no trigger-phrase detection needed
(unlike app/services/purchasing.py), since the whole point of writing here
is "bring this tea". The store is inferred from whichever store the sender
is on shift at today (ShiftLog), not from the message text.

Configured via TEA_REQUEST_CHAT_ID (required) and TEA_REQUEST_THREAD_ID
(only if it's a forum topic inside an existing group rather than its own
chat) — see app/config.py. Feature is a no-op until TEA_REQUEST_CHAT_ID is
set. Registered in app/bot.py before shift.py's generic F.text catch-all,
since a chat/thread match here should never fall through to shift-start/
task-reply/etc. detection meant for the main work chat.
"""
from aiogram import Router
from aiogram.types import Message

from app.config import settings
from app.db import get_session
from app.services.identity import get_employee, get_todays_shift
from app.services.messaging import notify_employee
from app.services.purchasing import create_purchase_request

router = Router(name="tea_requests")


def _is_tea_request_message(message: Message) -> bool:
    if settings.tea_request_chat_id is None:
        return False
    if message.chat.id != settings.tea_request_chat_id:
        return False
    if settings.tea_request_thread_id is None:
        return True
    return message.message_thread_id == settings.tea_request_thread_id


@router.message(_is_tea_request_message)
async def on_tea_request(message: Message) -> None:
    product = (message.text or "").strip()
    if not product:
        return

    async with get_session() as session:
        employee = await get_employee(session, message.from_user.id)
        if employee is None:
            # Can't attribute a store to someone we don't know yet — let
            # them go through the normal onboarding/shift flow first.
            return

        shift = await get_todays_shift(session, employee.id)
        if shift is None:
            await notify_employee(
                message.bot,
                employee,
                "Сначала отметьте начало смены (напишите в рабочий чат, что вы на месте) — "
                "иначе не пойму, для какого магазина эта заявка.",
                message,
            )
            return

        await create_purchase_request(session, employee.id, shift.store_id, product)

    await notify_employee(
        message.bot, employee, f"Записал в закупку чая: {product} 👍", message
    )
