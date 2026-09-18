"""Викторина по технологическим картам.

Карта = один чай: как заваривать, чем отличается, что говорить гостю.
Вопросы лежат в tech_cards.json, бот спрашивает 2-3 штуки в случайный момент смены.
"""
import json
import logging
import os
import random
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Question:
    card: str
    text: str
    options: tuple[str, ...]
    answer: int          # индекс правильного варианта
    explain: str = ""

    @property
    def correct_option(self) -> str:
        return self.options[self.answer]


def load_questions(path: str | None = None) -> tuple[Question, ...]:
    cards_path = Path(path or os.getenv("TECH_CARDS_PATH", "tech_cards.json"))
    if not cards_path.exists():
        logger.warning("⚠️ %s не найден — викторина выключена", cards_path)
        return ()
    try:
        raw = json.loads(cards_path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.error("❌ Не читается %s: %s", cards_path, e)
        return ()

    questions: list[Question] = []
    for card in raw.get("cards", []):
        for q in card.get("questions", []):
            questions.append(Question(
                card=card["title"],
                text=q["text"],
                options=tuple(q["options"]),
                answer=int(q["answer"]),
                explain=q.get("explain", ""),
            ))
    logger.info("🧠 Викторина: %d вопросов по %d картам", len(questions), len(raw.get("cards", [])))
    return tuple(questions)


def find_card(questions: tuple[Question, ...], tea: str) -> str | None:
    """Ищет карту по названию чая, как его написал сотрудник («шен пуэр» → «Шэн пуэр молодой»)."""
    if not tea:
        return None
    needle = tea.strip().lower()
    for q in questions:
        card = q.card.lower()
        if needle in card or card in needle:
            return q.card
    return None


def pick(questions: tuple[Question, ...], count: int, exclude_cards: set[str] | None = None,
         prefer_card: str | None = None) -> list[Question]:
    """Случайные вопросы, по возможности из разных карт.

    prefer_card — карта заваренного сегодня чая: первый вопрос берём из неё,
    чтобы спрашивать про то, что человек прямо сейчас держит в руках.
    """
    pool = [q for q in questions if not exclude_cards or q.card not in exclude_cards]
    if prefer_card:
        preferred = [q for q in pool if q.card == prefer_card]
        if preferred:
            first = random.choice(preferred)
            rest = pick(tuple(q for q in pool if q.card != prefer_card), count - 1) if count > 1 else []
            return [first, *rest]
    if len(pool) < count:
        pool = list(questions)
    random.shuffle(pool)

    chosen: list[Question] = []
    seen_cards: set[str] = set()
    for q in pool:
        if q.card in seen_cards:
            continue
        chosen.append(q)
        seen_cards.add(q.card)
        if len(chosen) == count:
            return chosen
    for q in pool:                      # карт меньше, чем нужно вопросов — добираем
        if q not in chosen:
            chosen.append(q)
        if len(chosen) == count:
            break
    return chosen
