"""docs/09_KPI_AND_REVENUE_MODULE.md §3.2-3.3 — upsell logging and nudges.

Detection is keyword-based, like purchasing.py — a placeholder for real NLU
until the AI Processing Layer is wired to an LLM (docs/04_TECH_SPEC.md §3.1).
"""
import datetime
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Employee, ShiftLog, UpsellEvent, UpsellType
from app.services.store_matcher import normalize

logger = logging.getLogger(__name__)

_KEYWORDS: list[tuple[str, UpsellType]] = [
    ("дегустац", UpsellType.TASTING_TO_PURCHASE),
    ("вкусност", UpsellType.PAIRING),
    ("доп чай", UpsellType.EXTRA_TEA),
    ("допродал", UpsellType.EXTRA_TEA),
    ("допродаж", UpsellType.EXTRA_TEA),
    ("апсейл", UpsellType.EXTRA_TEA),
]


def detect_upsell_type(text: str) -> UpsellType | None:
    normalized = normalize(text)
    for keyword, upsell_type in _KEYWORDS:
        if keyword in normalized:
            return upsell_type
    return None


async def record_upsell_event(
    session: AsyncSession,
    employee_id: int,
    store_id: int,
    upsell_type: UpsellType,
    note: str,
) -> UpsellEvent:
    event = UpsellEvent(
        employee_id=employee_id,
        store_id=store_id,
        upsell_type=upsell_type.value,
        note=note[:500],
    )
    session.add(event)
    await session.commit()
    await session.refresh(event)
    return event


# Owner request: several private reminders per shift about upselling, with
# concrete ideas rotated through so it's not the same line every time —
# suggesting tea to go with a purchase, cross-selling ("people who take this
# tea often also take..."), and offering a 10g ready-packed tea sample.
UPSELL_NUDGE_TEXTS = [
    "Напоминаю про допродажи 😊 Если гость берёт чай — предложи что-то к "
    "нему: ещё один сорт, сладость или посуду.",
    "Идея для допродажи: подскажи покупателю — «с этим чаем часто берут вот "
    "такой» и предложи попробовать сочетание.",
    "Не забывай про пробники! Предложи гостю готовый упакованный пробник "
    "10 г — отличный способ познакомить с новым сортом.",
]
FIRST_NUDGE_AFTER_MINUTES = 90
NUDGE_GAP_MINUTES = 150
MAX_NUDGES_PER_SHIFT = 3


async def send_upsell_nudges(bot, session_factory) -> None:
    """Feature: proactive private upsell reminders, up to MAX_NUDGES_PER_SHIFT
    times per shift, rotating through UPSELL_NUDGE_TEXTS so each one carries a
    different concrete idea. First goes out ~90 min after shift start, the
    rest spaced NUDGE_GAP_MINUTES apart.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    today = datetime.date.today()

    async with session_factory() as session:
        result = await session.execute(
            select(ShiftLog, Employee)
            .join(Employee, ShiftLog.employee_id == Employee.id)
            .where(ShiftLog.date == today, ShiftLog.upsell_nudges_sent < MAX_NUDGES_PER_SHIFT)
        )
        for shift_log, employee in result.all():
            # The director (owner) gets only completion reports, not
            # employee-facing nudges — skip them here.
            if employee.telegram_user_id == settings.owner_telegram_id:
                continue
            if shift_log.upsell_nudges_sent == 0:
                anchor = shift_log.confirmed_at
                gap_minutes = FIRST_NUDGE_AFTER_MINUTES
            else:
                anchor = shift_log.upsell_nudge_sent_at
                gap_minutes = NUDGE_GAP_MINUTES

            if anchor is None:
                continue
            if anchor.tzinfo is None:
                anchor = anchor.replace(tzinfo=datetime.timezone.utc)
            if now < anchor + datetime.timedelta(minutes=gap_minutes):
                continue

            text = UPSELL_NUDGE_TEXTS[shift_log.upsell_nudges_sent % len(UPSELL_NUDGE_TEXTS)]
            try:
                await bot.send_message(employee.telegram_user_id, text)
            except Exception:
                logger.exception("Failed to send upsell nudge to %s", employee.telegram_user_id)
                continue

            shift_log.upsell_nudges_sent += 1
            shift_log.upsell_nudge_sent_at = now
            await session.commit()
