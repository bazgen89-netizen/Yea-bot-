"""Pure text-matching helpers for resolving a store name from free-form
Russian text. No DB or network access here so this stays easy to unit-test.
"""
from __future__ import annotations

from dataclasses import dataclass

_YO_TO_YE = str.maketrans({"ё": "е", "Ё": "Е"})


def normalize(text: str) -> str:
    return text.translate(_YO_TO_YE).lower().strip()


@dataclass(frozen=True)
class StoreOption:
    id: int
    name: str
    aliases: list[str]


def match_store(text: str, stores: list[StoreOption]) -> StoreOption | None:
    """Return the single store whose name/alias appears in `text`.

    Returns None if no store matches, or if more than one store matches
    (ambiguous) — callers should treat both cases as "ask a clarifying
    question", per docs/09_KPI_AND_REVENUE_MODULE.md and
    docs/03_AI_BRAIN.md §13 (do not guess when unsure).
    """
    normalized_text = normalize(text)
    matches = []
    for store in stores:
        candidates = [store.name, *store.aliases]
        if any(normalize(candidate) in normalized_text for candidate in candidates):
            matches.append(store)

    if len(matches) == 1:
        return matches[0]
    return None
