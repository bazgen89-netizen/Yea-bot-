"""Feature 5 (docs/08_MVP_REQUIREMENTS.md §9, docs/02_OPERATION_SYSTEM.md §11):
Purchasing System.

Tea restock requests go through the dedicated topic instead
(app/handlers/tea_requests.py) — every message there is a request outright,
no phrase needed. This module now only covers everything else (packaging,
napkins, milk, etc.) in the main work chat, and per owner decision uses a
single unambiguous trigger phrase instead of a keyword-soup heuristic — the
broader keyword list (закончился/осталось/нет/...) matched too much,
including inside unrelated words like "остальные" ("the other ones"),
which fired a false-positive purchase request in production.
"""
import re

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PurchaseRequest
from app.services.store_matcher import normalize

TRIGGER_PHRASES = [
    "нужно привезти",
]

_TRIGGER_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(phrase) for phrase in TRIGGER_PHRASES) + r")\b",
    re.IGNORECASE,
)


def is_purchase_request_message(text: str) -> bool:
    normalized = normalize(text)
    return _TRIGGER_PATTERN.search(normalized) is not None


def extract_product(text: str) -> str:
    """Trigger phrase position decides which side holds the product name:
    "Закончился ГАБА" -> trigger leads, product follows it.
    "Молоко осталось, надо привезти" -> trigger comes after the product.
    """
    match = _TRIGGER_PATTERN.search(text)
    if match is None:
        return text.strip(" ,.!?")

    if match.start() <= 3:
        return text[match.end() :].strip(" ,.!?")
    return text[: match.start()].strip(" ,.!?")


async def create_purchase_request(
    session: AsyncSession, employee_id: int, store_id: int, product: str
) -> PurchaseRequest:
    request = PurchaseRequest(employee_id=employee_id, store_id=store_id, product=product)
    session.add(request)
    await session.commit()
    await session.refresh(request)
    return request
