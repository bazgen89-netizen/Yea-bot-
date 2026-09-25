"""Поиск живых вопросов про чай в интернете (Serper).

Библиотека сценариев конечна, а вопросы у прилавка — нет. Интернет даёт
поток реальных формулировок: как люди на самом деле спрашивают про пуэр,
цену, хранение. Но это чужие вопросы и чужой контекст, поэтому отсюда
выходят только КАНДИДАТЫ — в библиотеку их пускает владелец.

Fail-open, как и остальные внешние слои (см. скилл, правило 4): нет ключа
или поиск упал — просто ничего не предлагаем.
"""
import logging

import aiohttp

from app.config import settings

logger = logging.getLogger(__name__)

SEARCH_URL = "https://google.serper.dev/search"
TIMEOUT_SECONDS = 10

# Запросы подобраны так, чтобы попадать в живую речь покупателей, а не в
# статьи магазинов: форумы, отзывы, вопросы-ответы.
QUERIES = (
    "форум вопросы про пуэр новичок что спросить",
    "отзывы покупателей китайский чай вопросы продавцу",
    "чем отличается улун от красного чая вопрос",
    "как хранить чай вопрос ответ форум",
    "почему китайский чай такой дорогой обсуждение",
    "какой чай подарить не разбираюсь форум",
)


async def find_question_snippets(limit: int = 12) -> list[str]:
    """Возвращает куски текста из выдачи — сырьё, из которого ИИ потом
    вытащит формулировки вопросов."""
    if not settings.serper_key:
        logger.info("SERPER_KEY не задан — поиск вопросов в интернете выключен")
        return []

    import random

    snippets: list[str] = []
    timeout = aiohttp.ClientTimeout(total=TIMEOUT_SECONDS)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            for query in random.sample(QUERIES, k=min(3, len(QUERIES))):
                async with session.post(
                    SEARCH_URL,
                    headers={"X-API-KEY": settings.serper_key,
                             "Content-Type": "application/json"},
                    json={"q": query, "gl": "ru", "hl": "ru", "num": 10},
                ) as response:
                    if response.status != 200:
                        logger.warning("Serper ответил %s на «%s»", response.status, query)
                        continue
                    data = await response.json()
                for item in data.get("organic", []):
                    snippet = (item.get("snippet") or "").strip()
                    if snippet:
                        snippets.append(snippet)
                for item in data.get("peopleAlsoAsk", []):
                    question = (item.get("question") or "").strip()
                    if question:
                        snippets.append(question)
    except Exception:
        logger.exception("Поиск вопросов в интернете не удался")
        return []

    return snippets[:limit]
