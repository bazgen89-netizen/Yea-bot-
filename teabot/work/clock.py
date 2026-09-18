"""Единое время проекта — Москва. Всё расписание и все отметки только в нём."""
from datetime import datetime, time, timedelta, timezone

MSK = timezone(timedelta(hours=3), name="MSK")


def now_msk() -> datetime:
    return datetime.now(MSK)


def today_msk() -> str:
    return now_msk().strftime("%Y-%m-%d")


def at(hh: int, mm: int = 0) -> time:
    """Время суток в МСК — для job_queue.run_daily."""
    return time(hour=hh, minute=mm, tzinfo=MSK)


def parse_hhmm(value: str) -> time:
    hh, _, mm = value.partition(":")
    return at(int(hh), int(mm or 0))


def hours_between(start_iso: str, end_iso: str) -> str:
    try:
        delta = datetime.fromisoformat(end_iso) - datetime.fromisoformat(start_iso)
    except ValueError:
        return ""
    return f"{delta.total_seconds() / 3600:.2f}"
