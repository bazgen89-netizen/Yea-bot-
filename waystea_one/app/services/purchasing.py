"""Feature 5 (docs/08_MVP_REQUIREMENTS.md §9, docs/02_OPERATION_SYSTEM.md §11):
Purchasing System.

Product extraction is a simple keyword-strip heuristic, not real NLU — good
enough for MVP reliability, same trade-off as shift_detector.py. Once the
AI Processing Layer (docs/04_TECH_SPEC.md §3.1) is wired to a real LLM, this
is the natural place to replace the heuristic with proper entity extraction.
"""
import re

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PurchaseRequest
from app.services.store_matcher import normalize

# Whole-word forms only, matched with \b — a stem like "остал" would also
# match inside unrelated words such as "остальные" ("the other ones"),
# which fired a false-positive purchase request in production.
TRIGGER_PHRASES = [
    "закончился",
    "закончилась",
    "закончились",
    "закончилось",
    "нет",
    "нужны",
    "нужен",
    "нужна",
    # Running-low phrasing ("молоко осталось 1 упаковка, надо привезти"),
    # not just fully-out-of-stock.
    "осталось",
    "осталась",
    "остались",
    "остался",
    "заканчивается",
    "заканчиваются",
    "докупить",
    "привезти",
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
