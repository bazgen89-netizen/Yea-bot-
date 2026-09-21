from aiogram import Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

from app.config import settings
from app.db import get_session
from app.services.identity import create_employee, get_employee
from app.services.knowledge import create_knowledge_entry
from app.services.reports import build_daily_report

router = Router(name="owner")


class AddKnowledge(StatesGroup):
    awaiting_title = State()
    awaiting_content = State()


def _is_owner(message) -> bool:
    return message.from_user.id == settings.owner_telegram_id


@router.message(Command("start"))
async def on_start_command(message) -> None:
    """No operational purpose beyond a friendly greeting — the important
    part already happened once the employee sent /start at all: Telegram
    now allows the bot to message them privately (see
    app/services/messaging.py). Registered before shift.py's catch-all
    F.text handler so it doesn't get swallowed there.
    """
    await message.answer(
        "Привет! Я WAYSTEA ONE 😊\n"
        "Пишите в общий рабочий чат как обычно — про начало смены, "
        "выполнение задач, закупки, выручку. А сюда, в личные сообщения, "
        "я буду присылать подтверждения и список задач."
    )


@router.message(Command("name"))
async def on_name_command(message) -> None:
    """Let anyone set/correct their stored name — e.g. if onboarding
    captured the wrong text as a name. Usage: `/name Ваше имя`. Registered
    before shift.py's catch-all so it isn't swallowed there.
    """
    parts = (message.text or "").split(maxsplit=1)
    new_name = parts[1].strip()[:100] if len(parts) > 1 else ""
    if not new_name:
        await message.answer("Напишите так: /name Ваше имя")
        return

    async with get_session() as session:
        employee = await get_employee(session, message.from_user.id)
        if employee is None:
            await create_employee(session, message.from_user.id, new_name)
        else:
            employee.name = new_name
            await session.commit()

    await message.answer(f"Записал ваше имя: {new_name} 👍")


RULES_TEXT = (
    "ℹ️ <b>Что фиксирует бот</b>\n\n"
    "• Время отметки смены и её закрытия.\n"
    "• Геометку — <b>один раз</b>, в момент открытия смены, по нажатию кнопки. "
    "В течение дня местоположение не отслеживается.\n"
    "• Выполнение задач и комментарии к ним, фото результата.\n"
    "• Выручку за смену и ответы на вопросы по чаю.\n\n"
    "Это видит владелец. Между сменами бот не фиксирует ничего.\n"
    "Вопросы — владельцу."
)


@router.message(Command("rules"))
async def on_rules_command(message) -> None:
    """Employees must be able to see what is being recorded, at any moment.

    Russian labour law (ст. 86 ТК РФ) requires employees to be informed of
    such monitoring; a bot command doesn't replace the signed notice, but it
    does mean nobody has to take anyone's word for what the bot stores.
    """
    await message.answer(RULES_TEXT)


@router.message(Command("where"))
async def on_where_command(message) -> None:
    """Calibrate a store's coordinates: the ones seeded from the maps card
    point at the card's centre, not the doorway, so the real ones are taken
    on site. Answers with the sender's coordinates and the distance to every
    store; does not open a shift.
    """
    from app.models import Store
    from app.services.geo import check as geo_check

    location = message.location
    if location is None:
        await message.answer(
            "Пришли геометку (скрепка → Геопозиция), и я отвечу точными "
            "координатами и расстоянием до каждой точки. Смену это не откроет."
        )
        return

    lines = [
        f"📍 Твои координаты: <code>{location.latitude:.6f}, {location.longitude:.6f}</code>",
        "<i>(широта, долгота — в этом порядке они и вписываются в scripts/seed_stores.py)</i>",
        "",
    ]
    async with get_session() as session:
        from sqlalchemy import select

        for store in (await session.execute(select(Store))).scalars():
            verdict = geo_check(
                location.latitude, location.longitude, store.lat, store.lon, store.radius_m
            )
            if verdict is None:
                lines.append(f"• {store.name}: координаты не заданы")
                continue
            inside, distance = verdict
            state = "внутри зоны" if inside else f"ВНЕ зоны (радиус {store.radius_m} м)"
            lines.append(f"• {store.name}: {distance} м — {state}")
    await message.answer("\n".join(lines))


@router.message(Command("brew"))
async def on_brew_command(message, state: FSMContext) -> None:
    """Change the brewed tea mid-shift."""
    from app.handlers.shift import BrewCheck
    from app.services.brew import ASK_BREWED_TEA

    await message.answer(ASK_BREWED_TEA)
    await state.set_state(BrewCheck.awaiting_tea)


@router.message(Command("feedback"))
async def on_feedback_command(message, state: FSMContext) -> None:
    """Record an impression of today's tea on demand, not only when asked."""
    from app.handlers.shift import BrewCheck, BrewFeedback
    from app.services.brew import ASK_BREWED_TEA, ASK_FEEDBACK, today_shift

    async with get_session() as session:
        employee = await get_employee(session, message.from_user.id)
        shift = await today_shift(session, employee.id) if employee else None

    if shift is None:
        await message.answer("Смена на сегодня не отмечена.")
        return
    if not shift.brewed_tea:
        await message.answer(ASK_BREWED_TEA)
        await state.set_state(BrewCheck.awaiting_tea)
        return
    await message.answer(ASK_FEEDBACK.format(tea=shift.brewed_tea))
    await state.set_state(BrewFeedback.awaiting_note)


@router.message(Command("me"))
async def on_me_command(message) -> None:
    """Личный прогресс: ранг, серия, неделя. Доступна всем сотрудникам."""
    from app.services.progress import format_stats, weekly_stats

    async with get_session() as session:
        employee = await get_employee(session, message.from_user.id)
        if employee is None:
            await message.answer("Сначала отметь смену — тогда будет что показывать 😊")
            return
        stats = await weekly_stats(session, employee.id)
    await message.answer(format_stats(employee.name, stats))


@router.message(Command("report"))
async def on_report_command(message) -> None:
    if not _is_owner(message):
        return
    async with get_session() as session:
        report = await build_daily_report(session)
    await message.answer(report)


@router.message(Command("addknowledge"))
async def on_addknowledge_command(message, state: FSMContext) -> None:
    """Lets the owner grow the company knowledge base (used to answer
    employee questions, docs/03_AI_BRAIN.md §7) directly from Telegram,
    instead of needing a code change for every new entry.
    """
    if not _is_owner(message):
        return
    await state.set_state(AddKnowledge.awaiting_title)
    await message.answer(
        "Добавляем запись в базу знаний.\n"
        "Как назвать тему (например: «Заваривание Улуна» или «Возврат товара»)?"
    )


@router.message(AddKnowledge.awaiting_title)
async def receive_knowledge_title(message, state: FSMContext) -> None:
    title = (message.text or "").strip()
    if not title:
        await message.answer("Название не может быть пустым, напишите ещё раз.")
        return
    await state.update_data(knowledge_title=title)
    await state.set_state(AddKnowledge.awaiting_content)
    await message.answer("Теперь напишите содержание — всё, что сотрудники должны об этом знать.")


@router.message(AddKnowledge.awaiting_content)
async def receive_knowledge_content(message, state: FSMContext) -> None:
    content = (message.text or "").strip()
    if not content:
        await message.answer("Содержание не может быть пустым, напишите ещё раз.")
        return

    data = await state.get_data()
    title = data.get("knowledge_title", "Без названия")
    await state.clear()

    async with get_session() as session:
        await create_knowledge_entry(session, title, content)

    await message.answer(
        f"Добавил в базу знаний: «{title}» 👍\n"
        "Сотрудники теперь смогут получить ответ по этой теме."
    )
