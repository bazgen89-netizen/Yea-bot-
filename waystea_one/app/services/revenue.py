"""docs/09_KPI_AND_REVENUE_MODULE.md §3.1 — end-of-shift revenue entry.

The owner confirmed a fixed three-line format:

    Общая выручка: <сумма>
    Наличка: <сумма>
    Безнал: <сумма>

We parse exactly that rather than free-form text. If a line is missing or
the numbers don't add up, `parse_revenue_message` returns None and the
caller asks for clarification instead of guessing (docs/03_AI_BRAIN.md §13).
"""
import datetime
import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ShiftRevenue

_TOTAL_RE = re.compile(r"общ\w*\s+выручк\w*[:\s]+([\d\s]+)", re.IGNORECASE)
_CASH_RE = re.compile(r"наличк\w*[:\s]+([\d\s]+)", re.IGNORECASE)
_NON_CASH_RE = re.compile(r"безнал\w*[:\s]+([\d\s]+)", re.IGNORECASE)


@dataclass(frozen=True)
class RevenueReport:
    total: int
    cash: int
    non_cash: int


def looks_like_revenue_message(text: str) -> bool:
    return bool(_TOTAL_RE.search(text) or _CASH_RE.search(text) or _NON_CASH_RE.search(text))


def _parse_amount(match: re.Match | None) -> int | None:
    if match is None:
        return None
    digits = re.sub(r"\s", "", match.group(1))
    if not digits.isdigit():
        return None
    return int(digits)


def parse_revenue_message(text: str) -> RevenueReport | None:
    total = _parse_amount(_TOTAL_RE.search(text))
    cash = _parse_amount(_CASH_RE.search(text))
    non_cash = _parse_amount(_NON_CASH_RE.search(text))

    if total is None or cash is None or non_cash is None:
        return None
    if cash + non_cash != total:
        return None
    return RevenueReport(total=total, cash=cash, non_cash=non_cash)


async def record_shift_revenue(
    session: AsyncSession,
    employee_id: int,
    store_id: int,
    report: RevenueReport,
    date: datetime.date | None = None,
) -> ShiftRevenue:
    """Upsert — an employee resending the report (e.g. to fix a typo)
    overwrites today's figures rather than erroring on the unique constraint.
    """
    date = date or datetime.date.today()
    result = await session.execute(
        select(ShiftRevenue).where(
            ShiftRevenue.employee_id == employee_id, ShiftRevenue.date == date
        )
    )
    revenue = result.scalar_one_or_none()
    if revenue is None:
        revenue = ShiftRevenue(employee_id=employee_id, store_id=store_id, date=date)
        session.add(revenue)

    revenue.store_id = store_id
    revenue.total = report.total
    revenue.cash = report.cash
    revenue.non_cash = report.non_cash

    await session.commit()
    await session.refresh(revenue)
    return revenue
