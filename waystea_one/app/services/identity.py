import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Employee, ShiftLog, Store
from app.services.store_matcher import StoreOption


async def get_employee(session: AsyncSession, telegram_user_id: int) -> Employee | None:
    result = await session.execute(
        select(Employee).where(Employee.telegram_user_id == telegram_user_id)
    )
    return result.scalar_one_or_none()


async def create_employee(
    session: AsyncSession, telegram_user_id: int, name: str
) -> Employee:
    employee = Employee(telegram_user_id=telegram_user_id, name=name.strip())
    session.add(employee)
    await session.commit()
    await session.refresh(employee)
    return employee


async def list_store_options(session: AsyncSession) -> list[StoreOption]:
    result = await session.execute(select(Store))
    return [
        StoreOption(id=store.id, name=store.name, aliases=store.aliases)
        for store in result.scalars()
    ]


async def record_shift_start(
    session: AsyncSession,
    employee_id: int,
    store_id: int,
    date: datetime.date | None = None,
) -> ShiftLog:
    """Upsert today's shift log for the employee (one store per day)."""
    date = date or datetime.date.today()
    result = await session.execute(
        select(ShiftLog).where(
            ShiftLog.employee_id == employee_id, ShiftLog.date == date
        )
    )
    shift_log = result.scalar_one_or_none()
    if shift_log is None:
        shift_log = ShiftLog(employee_id=employee_id, store_id=store_id, date=date)
        session.add(shift_log)
    else:
        shift_log.store_id = store_id
    await session.commit()
    await session.refresh(shift_log)
    return shift_log


async def get_todays_shift(
    session: AsyncSession, employee_id: int, date: datetime.date | None = None
) -> ShiftLog | None:
    date = date or datetime.date.today()
    result = await session.execute(
        select(ShiftLog).where(
            ShiftLog.employee_id == employee_id, ShiftLog.date == date
        )
    )
    return result.scalar_one_or_none()
