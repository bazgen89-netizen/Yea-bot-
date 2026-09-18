import re

from app.services.store_matcher import normalize

QUESTION_WORDS = ["как", "что", "где", "почему", "зачем", "когда", "подскажи", "можно"]


def looks_like_question(text: str) -> bool:
    if text.strip().endswith("?"):
        return True
    normalized = normalize(text)
    return any(re.search(rf"\b{word}\b", normalized) for word in QUESTION_WORDS)
