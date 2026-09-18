"""Тесты рабочего контура: геометка, конфиг, хранилище, регламенты, викторина."""
import asyncio
import json

import pytest

from teabot.work import geo
from teabot.work.clock import hours_between, parse_hhmm
from teabot.work.config import WorkConfig
from teabot.work.quiz import Question, find_card, pick
from teabot.work.regulations import DEFAULT_REGULATIONS, by_id, for_moment
from teabot.work.storage import JsonStorage


CONFIG = {
    "points": [{"id": "gag", "title": "Гагаринский", "lat": 55.7065, "lon": 37.576, "radius_m": 150}],
    "people": [
        {"tg_id": 1, "name": "Босс", "role": "boss"},
        {"tg_id": 2, "name": "Аня", "point": "gag", "workdays": [0, 1, 2]},
    ],
    "schedule": {"morning_reminder": "09:30", "quiz_window": ["12:00", "16:00"]},
}


def test_geo_inside_and_outside():
    lat, lon = 55.7065, 37.576
    inside, distance = geo.check(lat, lon, lat, lon, 150)
    assert inside and distance == 0

    # ~0.01° широты это чуть больше километра
    outside, far = geo.check(lat + 0.01, lon, lat, lon, 150)
    assert not outside and 1000 < far < 1200


def test_config_roles_and_points():
    cfg = WorkConfig.from_dict(CONFIG)
    assert cfg.enabled
    assert [p.name for p in cfg.bosses] == ["Босс"]
    anya = cfg.person(2)
    assert cfg.point_of(anya).title == "Гагаринский"
    assert anya.workdays == (0, 1, 2)
    assert cfg.morning_reminder == "09:30"


def test_missing_config_disables_work_mode(tmp_path):
    cfg = WorkConfig.load(str(tmp_path / "нет-такого.json"))
    assert not cfg.enabled and cfg.person(2) is None


def test_example_config_is_valid():
    """Пример из репозитория должен читаться — на него смотрит владелец при настройке."""
    with open("work_config.example.json", encoding="utf-8") as f:
        cfg = WorkConfig.from_dict(json.load(f))
    assert len(cfg.points) == 2 and len(cfg.bosses) == 1


def test_regulations_cover_shift():
    assert {r.id for r in for_moment(DEFAULT_REGULATIONS, "open")} == {"otkrytie"}
    assert {r.id for r in for_moment(DEFAULT_REGULATIONS, "close")} == {"zakrytie"}
    assert by_id(DEFAULT_REGULATIONS, "degustaciya").items[0].proof == "текст"


def test_json_storage_roundtrip(tmp_path):
    store = JsonStorage(str(tmp_path / "data.json"))

    async def scenario():
        await store.append("Задачи", {"id": "a1", "title": "Пересчитать банки", "status": "новая"})
        await store.append("Задачи", {"id": "b2", "title": "Убрать витрину", "status": "новая"})
        assert await store.update_where("Задачи", "id", "a1", {"status": "сделана"})
        assert not await store.update_where("Задачи", "id", "нет", {"status": "сделана"})
        return await store.rows("Задачи")

    rows = asyncio.run(scenario())
    assert [r["status"] for r in rows] == ["сделана", "новая"]


QUESTIONS = (
    Question("Шэн пуэр молодой", "Температура?", ("70", "85", "100"), 1),
    Question("Шэн пуэр молодой", "Горчит?", ("норма", "снизить температуру"), 1),
    Question("Те Гуань Инь", "Сколько проливов?", ("2", "10"), 1),
)


def test_quiz_prefers_brewed_tea_card():
    card = find_card(QUESTIONS, "шэн пуэр")
    assert card == "Шэн пуэр молодой"
    chosen = pick(QUESTIONS, 2, prefer_card=card)
    assert chosen[0].card == card and len(chosen) == 2


def test_quiz_pick_spreads_across_cards():
    chosen = pick(QUESTIONS, 2)
    assert len({q.card for q in chosen}) == 2


def test_find_card_without_match():
    assert find_card(QUESTIONS, "габа") is None
    assert find_card(QUESTIONS, "") is None


def test_hours_between():
    assert hours_between("2026-01-01T10:00:00+03:00", "2026-01-01T19:30:00+03:00") == "9.50"
    assert hours_between("мусор", "2026-01-01T19:30:00+03:00") == ""


def test_parse_hhmm_is_moscow():
    t = parse_hhmm("09:45")
    assert (t.hour, t.minute) == (9, 45)
    assert t.utcoffset().total_seconds() == 3 * 3600


class _FakeContext:
    """Минимальный ctx: сводке нужны только bot_data и хранилище."""

    def __init__(self, bot_data):
        self.bot_data = bot_data


def test_digest_reports_missing_shift_and_tasting(tmp_path):
    from teabot.work.clock import today_msk
    from teabot.work.handlers import WORK_CFG, WORK_STORAGE
    from teabot.work.router import build_digest

    store = JsonStorage(str(tmp_path / "data.json"))
    today = today_msk()

    async def scenario():
        await store.append("Смены", {"date": today, "tg_id": 2, "name": "Аня",
                                     "opened_at": f"{today}T10:05:00+03:00", "geo_ok": "да"})
        await store.append("Задачи", {"id": "t1", "date": today, "tg_id": 2, "status": "сделана"})
        await store.append("Задачи", {"id": "t2", "date": today, "tg_id": 2, "status": "новая"})
        ctx = _FakeContext({WORK_CFG: WorkConfig.from_dict(CONFIG), WORK_STORAGE: store})
        return await build_digest(ctx)

    digest = asyncio.run(scenario())
    assert "Аня" in digest
    assert "10:05 → ещё на смене" in digest
    assert "задачи: 1/2, не закрыто: 1" in digest
    assert "дегустация: не записана" in digest
    assert "Босс" not in digest  # руководителя в сводке о себе нет
