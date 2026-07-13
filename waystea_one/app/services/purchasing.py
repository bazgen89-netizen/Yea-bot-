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

TRIGGER_PHRASES = [
    "закончился",
    "закончилась",
    "закончились",
    "закончилось",
    "нет ",
    "нужны",
    "нужен",
    "нужна",
]


def is_purchase_request_message(text: str) -> bool:
    normalized = normalize(text)
    return any(phrase in normalized for phrase in TRIGGER_PHRASES)


def extract_product(text: str) -> str:
    remainder = text
    for phrase in TRIGGER_PHRASES:
        remainder = re.sub(re.escape(phrase), "", remainder, flags=re.IGNORECASE)
    return remainder.strip(" ,.!?")


async def create_purchase_request(
    session: AsyncSession, employee_id: int, store_id: int, product: str
) -> PurchaseRequest:
    request = PurchaseRequest(employee_id=employee_id, store_id=store_id, product=product)
    session.add(request)
    await session.commit()
    await session.refresh(request)
    return request
