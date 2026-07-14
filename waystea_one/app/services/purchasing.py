"""Feature 5 (docs/08_MVP_REQUIREMENTS.md §9, docs/02_OPERATION_SYSTEM.md §11):
Purchasing System.

Product extraction is a simple keyword-strip heuristic, not real NLU — good
enough for MVP reliability, same trade-off as shift_detector.py. Once the
AI Processing Layer (docs/04_TECH_SPEC.md §3.1) is wired to a real LLM, this
is the natural place to replace the heuristic with proper entity extraction.
"""
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PurchaseRequest
from app.services.store_matcher import normalize

TRIGGER_PHRASES = [
    "закончился",
    "закончилась",
    "закончились",
    "закончилось",
    "нет ",
    "нужны",
    "нужен",
    "нужна",
    # Running-low phrasing ("молоко осталось 1 упаковка, надо привезти"),
    # not just fully-out-of-stock — the owner wants these caught too.
    "остал",  # осталось/осталась/остались/остался
    "заканчива",  # заканчивается/заканчиваются
    "докупить",
    "привезти",
    "мало ",
]


def is_purchase_request_message(text: str) -> bool:
    normalized = normalize(text)
    return any(phrase in normalized for phrase in TRIGGER_PHRASES)


def extract_product(text: str) -> str:
    """Trigger phrase position decides which side holds the product name:
    "Закончился ГАБА" -> trigger leads, product follows it.
    "Молоко осталось, надо привезти" -> trigger comes after the product.
    """
    lower = text.lower()
    earliest_index = None
    earliest_phrase = None
    for phrase in TRIGGER_PHRASES:
        index = lower.find(phrase)
        if index != -1 and (earliest_index is None or index < earliest_index):
            earliest_index = index
            earliest_phrase = phrase

    if earliest_index is None:
        return text.strip(" ,.!?")

    if earliest_index <= 3:
        return text[earliest_index + len(earliest_phrase) :].strip(" ,.!?")
    return text[:earliest_index].strip(" ,.!?")


async def create_purchase_request(
    session: AsyncSession, employee_id: int, store_id: int, product: str
) -> PurchaseRequest:
    request = PurchaseRequest(employee_id=employee_id, store_id=store_id, product=product)
    session.add(request)
    await session.commit()
    await session.refresh(request)
    return request
