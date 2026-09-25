"""Buttons under the brewed-tea reminder: treated a guest / re-brewed.

Counting treats is the point: the owner's observation is that a guest who
tastes what's on the counter often adds that tea to their purchase, so the
number of treats per shift is the leading indicator worth watching.
"""
from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery

from app.db import get_session
from app.services.brew import ASK_BREWED_TEA, count_treat
from app.services.identity import get_employee
from app.services.messaging import send_private

router = Router(name="brew")


@router.callback_query(F.data == "treat")
async def on_treat(callback: CallbackQuery) -> None:
    async with get_session() as session:
        employee = await get_employee(session, callback.from_user.id)
        if employee is None:
            await callback.answer()
            return
        total = await count_treat(session, employee.id)

    if not total:
        await callback.answer("Смена на сегодня не отмечена")
        return
    await callback.answer(f"Записал. Сегодня угостил: {total}")


@router.callback_query(F.data == "rebrew")
async def on_rebrew(callback: CallbackQuery, state: FSMContext) -> None:
    from app.handlers.shift import BrewCheck

    await callback.answer()
    await send_private(callback.bot, callback.from_user.id, callback.from_user.full_name, ASK_BREWED_TEA)
    await state.set_state(BrewCheck.awaiting_tea)
