"""docs/09_KPI_AND_REVENUE_MODULE.md §3.2-3.3 — upsell logging and nudges.

Detection is keyword-based, like purchasing.py — a placeholder for real NLU
until the AI Processing Layer is wired to an LLM (docs/04_TECH_SPEC.md §3.1).
"""
import datetime
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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


UPSELL_NUDGE_TEXT = "Не забудь предложить дегустацию, пока собираешь заказ 😊"
NUDGE_AFTER_MINUTES = 120


async def send_upsell_nudges(bot, session_factory) -> None:
    """Feature: Level-1 proactive nudge, one per employee per shift, sent
    ~2 hours after shift start if they haven't logged any upsell yet.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(minutes=NUDGE_AFTER_MINUTES)
    today = datetime.date.today()

    async with session_factory() as session:
        result = await session.execute(
            select(ShiftLog, Employee)
            .join(Employee, ShiftLog.employee_id == Employee.id)
            .where(ShiftLog.date == today, ShiftLog.upsell_nudge_sent_at.is_(None))
        )
        for shift_log, employee in result.all():
            confirmed_at = shift_log.confirmed_at
            if confirmed_at.tzinfo is None:
                confirmed_at = confirmed_at.replace(tzinfo=datetime.timezone.utc)
            if confirmed_at > cutoff:
                continue

            already_logged = await session.execute(
                select(UpsellEvent.id).where(
                    UpsellEvent.employee_id == employee.id,
                    UpsellEvent.created_at >= confirmed_at,
                )
            )
            if already_logged.scalar_one_or_none() is not None:
                shift_log.upsell_nudge_sent_at = now
                await session.commit()
                continue

            try:
                await bot.send_message(employee.telegram_user_id, UPSELL_NUDGE_TEXT)
            except Exception:
                logger.exception("Failed to send upsell nudge to %s", employee.telegram_user_id)
            shift_log.upsell_nudge_sent_at = now
            await session.commit()
