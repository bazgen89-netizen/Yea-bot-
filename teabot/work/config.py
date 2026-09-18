"""Настройки рабочего контура: точки, люди, расписание, регламенты.

Лежат в JSON-файле (путь в WORK_CONFIG_PATH), чтобы менять состав команды и
расписание без правки кода и передеплоя логики.
"""
import json
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_CONFIG_PATH = "work_config.json"
DEFAULT_GEO_RADIUS_M = 200


@dataclass(frozen=True)
class Point:
    """Торговая точка: где сотрудник должен физически находиться на смене."""
    id: str
    title: str
    lat: float
    lon: float
    radius_m: int = DEFAULT_GEO_RADIUS_M
    open_at: str = "10:00"
    close_at: str = "21:00"


@dataclass(frozen=True)
class Person:
    """Сотрудник. role: 'boss' видит сводки и ставит задачи, 'staff' работает на точке."""
    tg_id: int
    name: str
    role: str = "staff"
    point: str = ""
    workdays: tuple[int, ...] = (0, 1, 2, 3, 4, 5, 6)  # 0 = понедельник

    @property
    def is_boss(self) -> bool:
        return self.role == "boss"


@dataclass
class WorkConfig:
    points: dict[str, Point] = field(default_factory=dict)
    people: dict[int, Person] = field(default_factory=dict)
    morning_reminder: str = "09:45"
    evening_close: str = "20:30"
    boss_digest: str = "21:00"
    quiz_window: tuple[str, str] = ("13:00", "17:00")
    quiz_questions: int = 3

    @property
    def bosses(self) -> list[Person]:
        return [p for p in self.people.values() if p.is_boss]

    @property
    def staff(self) -> list[Person]:
        return [p for p in self.people.values() if not p.is_boss]

    def person(self, tg_id: int) -> Person | None:
        return self.people.get(tg_id)

    def point_of(self, person: Person) -> Point | None:
        return self.points.get(person.point)

    @classmethod
    def load(cls, path: str | None = None) -> "WorkConfig":
        """Читает конфиг с диска. Отсутствие файла — не ошибка: рабочий контур просто выключен."""
        cfg_path = Path(path or os.getenv("WORK_CONFIG_PATH", DEFAULT_CONFIG_PATH))
        if not cfg_path.exists():
            logger.warning("⚠️ %s не найден — рабочий контур выключен, бот работает только как чайный эксперт", cfg_path)
            return cls()
        raw = json.loads(cfg_path.read_text(encoding="utf-8"))
        return cls.from_dict(raw)

    @classmethod
    def from_dict(cls, raw: dict) -> "WorkConfig":
        points = {}
        for item in raw.get("points", []):
            points[item["id"]] = Point(
                id=item["id"], title=item["title"],
                lat=float(item["lat"]), lon=float(item["lon"]),
                radius_m=int(item.get("radius_m", DEFAULT_GEO_RADIUS_M)),
                open_at=item.get("open_at", "10:00"),
                close_at=item.get("close_at", "21:00"),
            )
        people = {}
        for item in raw.get("people", []):
            tg_id = int(item["tg_id"])
            people[tg_id] = Person(
                tg_id=tg_id, name=item["name"],
                role=item.get("role", "staff"),
                point=item.get("point", ""),
                workdays=tuple(item.get("workdays", range(7))),
            )
        schedule = raw.get("schedule", {})
        window = schedule.get("quiz_window", ["13:00", "17:00"])
        return cls(
            points=points, people=people,
            morning_reminder=schedule.get("morning_reminder", "09:45"),
            evening_close=schedule.get("evening_close", "20:30"),
            boss_digest=schedule.get("boss_digest", "21:00"),
            quiz_window=(window[0], window[1]),
            quiz_questions=int(schedule.get("quiz_questions", 3)),
        )

    @property
    def enabled(self) -> bool:
        return bool(self.people)
