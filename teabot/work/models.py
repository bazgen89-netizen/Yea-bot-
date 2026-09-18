"""Записи, которые бот кладёт в хранилище (лист Google Sheets = набор таких записей)."""
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Any


def _now_iso() -> str:
    from .clock import now_msk
    return now_msk().isoformat(timespec="seconds")


@dataclass
class Record:
    """Базовая запись: умеет превращаться в строку таблицы."""

    def to_row(self) -> dict[str, Any]:
        return {k: ("" if v is None else v) for k, v in asdict(self).items()}


@dataclass
class ShiftRecord(Record):
    """Открытие/закрытие смены: кто, где, во сколько, подтверждена ли геометка."""
    date: str
    tg_id: int
    name: str
    point: str
    opened_at: str = ""
    opened_lat: float | None = None
    opened_lon: float | None = None
    geo_ok: str = ""          # "да" / "нет — 340 м" / "не прислана"
    photo_id: str = ""        # file_id фото точки
    closed_at: str = ""
    hours: str = ""


@dataclass
class TaskRecord(Record):
    """Задача: разовая (поставил руководитель) или из регламента."""
    id: str
    date: str
    tg_id: int
    name: str
    title: str
    source: str               # "регламент:открытие_смены" / "разовая"
    proof: str                # чем закрывается: "фото" / "текст" / "нет"
    due: str = ""
    status: str = "новая"     # новая / взята / сделана / проблема / просрочена
    taken_at: str = ""
    done_at: str = ""
    comment: str = ""
    photo_id: str = ""
    created_at: str = field(default_factory=_now_iso)


@dataclass
class ChecklistRecord(Record):
    """Прохождение чек-листа регламента: по одной строке на пункт."""
    date: str
    tg_id: int
    name: str
    point: str
    regulation: str
    item: str
    done_at: str = ""
    photo_id: str = ""
    comment: str = ""


@dataclass
class TastingRecord(Record):
    """Запись дегустации: что пробовал и что узнал. Основа обучения."""
    date: str
    tg_id: int
    name: str
    tea: str
    notes: str
    created_at: str = field(default_factory=_now_iso)


@dataclass
class QuizRecord(Record):
    """Ответ на вопрос викторины по технологической карте."""
    date: str
    tg_id: int
    name: str
    card: str
    question: str
    answer: str
    correct: str              # "да" / "нет"
    asked_at: str = field(default_factory=_now_iso)


@dataclass
class BrewRecord(Record):
    """Чай, заваренный на точке сегодня: им угощают гостей, по нему же спрашиваем знания."""
    date: str
    tg_id: int
    name: str
    point: str
    tea: str
    brewed_at: str = field(default_factory=_now_iso)
    treats: int = 0           # скольких гостей угостили
    feedback: str = ""        # что сотрудник сказал об этом чае
