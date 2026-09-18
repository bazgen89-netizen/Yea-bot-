"""Регламенты — повторяющиеся чек-листы смены.

Стартовый набор зашит здесь; его можно переопределить файлом regulations.json
(путь в REGULATIONS_PATH), не трогая код.
"""
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

# Чем закрывается пункт. Фото и текст нельзя нажать «не глядя» — в этом смысл.
PROOF_TAP = "нет"      # просто галочка
PROOF_PHOTO = "фото"   # нужна фотография
PROOF_TEXT = "текст"   # нужен письменный ответ


@dataclass(frozen=True)
class Item:
    id: str
    text: str
    proof: str = PROOF_TAP


@dataclass(frozen=True)
class Regulation:
    id: str
    title: str
    when: str           # "open" — при открытии, "close" — при закрытии, "day" — в течение дня
    items: tuple[Item, ...]


DEFAULT_REGULATIONS: tuple[Regulation, ...] = (
    Regulation(
        id="otkrytie", title="🌅 Открытие смены", when="open",
        items=(
            Item("svet", "Свет, вывеска, касса включены"),
            Item("vitrina", "Витрина выставлена — фото витрины", PROOF_PHOTO),
            Item("cennik", "Ценники на месте и совпадают с товаром"),
            Item("ostatki", "Сверил остатки ходовых позиций"),
        ),
    ),
    Regulation(
        id="banki", title="🫙 Проверка чая в банках", when="day",
        items=(
            Item("obhod", "Прошёл по всем банкам, проверил уровень"),
            Item("pustye", "Какие банки пустые или на исходе? Перечисли", PROOF_TEXT),
            Item("dosypal", "Досыпал из запаса / поставил в заказ — фото полки", PROOF_PHOTO),
            Item("srok", "Проверил даты и запах — нет затхлого, нет сырости"),
        ),
    ),
    Regulation(
        id="chistota", title="🧽 Чистота", when="day",
        items=(
            Item("stol", "Рабочий стол и посуда для проливов чистые"),
            Item("pol", "Пол и подходы к витрине"),
            Item("chaynik", "Чайник, термос, сито промыты"),
            Item("itog", "Итог — фото точки", PROOF_PHOTO),
        ),
    ),
    Regulation(
        id="degustaciya", title="🍵 Дегустация дня", when="day",
        items=(
            Item("chay", "Какой чай сегодня пробовал?", PROOF_TEXT),
            Item("chto_uznal", "Что про него узнал/понял? Вкус, как заваривал, что скажешь гостю", PROOF_TEXT),
        ),
    ),
    Regulation(
        id="zakrytie", title="🌙 Закрытие смены", when="close",
        items=(
            Item("vyruchka", "Выручка сведена, касса закрыта"),
            Item("uborka", "Убрано, чай закрыт, витрина в порядке — фото", PROOF_PHOTO),
            Item("zakaz", "Записал, что нужно довезти к следующей смене", PROOF_TEXT),
            Item("svet_off", "Свет, техника, замок"),
        ),
    ),
)


def load_regulations(path: str | None = None) -> tuple[Regulation, ...]:
    reg_path = Path(path or os.getenv("REGULATIONS_PATH", "regulations.json"))
    if not reg_path.exists():
        return DEFAULT_REGULATIONS
    try:
        raw = json.loads(reg_path.read_text(encoding="utf-8"))
        return tuple(
            Regulation(
                id=r["id"], title=r["title"], when=r.get("when", "day"),
                items=tuple(Item(i["id"], i["text"], i.get("proof", PROOF_TAP)) for i in r["items"]),
            )
            for r in raw["regulations"]
        )
    except Exception as e:
        logger.error("❌ Не читается %s (%s) — беру встроенные регламенты", reg_path, e)
        return DEFAULT_REGULATIONS


def by_id(regulations: tuple[Regulation, ...], reg_id: str) -> Regulation | None:
    return next((r for r in regulations if r.id == reg_id), None)


def for_moment(regulations: tuple[Regulation, ...], when: str) -> tuple[Regulation, ...]:
    return tuple(r for r in regulations if r.when == when)
