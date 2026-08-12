"""AI Processing Layer fallback for when deterministic keyword matching
(store_matcher.py, shift_detector.py, etc.) doesn't recognize a message.

This is deliberately a *fallback*, not the primary path: exact keyword
matching stays first because it's instant, free, and correct for the
common phrasing. This only runs when that fails, to catch typos, unusual
wording, or phrasing the fixed alias/keyword lists don't cover — instead
of immediately asking the employee to repeat themselves.

Same fail-open contract as ai.py/vision.py: no API key, or the call
erroring, returns None and the caller falls back to its existing
clarifying-question behavior — never invents an answer.
"""
import json
import logging

from app.config import settings
from app.services.store_matcher import StoreOption, match_store

logger = logging.getLogger(__name__)


async def match_store_with_ai(text: str, store_names: list[str]) -> str | None:
    """Asks the AI Processing Layer which of the known stores (if any) this
    message refers to. Returns the store name (must exactly match one from
    `store_names`) or None if it can't tell / AI isn't available.
    """
    if not settings.anthropic_api_key:
        return None

    options = ", ".join(store_names)
    try:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        response = await client.messages.create(
            model="claude-sonnet-5",
            max_tokens=50,
            system=(
                "Сотрудник чайного магазина написал сообщение. Определи, о каком "
                f"из этих магазинов идёт речь: {options}. "
                'Ответь строго JSON: {"store": "<точное название из списка>"} '
                'или {"store": null}, если не можешь определить однозначно. '
                "Не выдумывай магазин, которого нет в списке."
            ),
            messages=[{"role": "user", "content": text}],
        )
        raw = response.content[0].text.strip()
        data = json.loads(raw)
        store = data.get("store")
        return store if store in store_names else None
    except Exception:
        logger.exception("AI store matching failed")
        return None


async def resolve_store(text: str, stores: list[StoreOption]) -> StoreOption | None:
    """Deterministic alias matching first (instant, free, no network); if
    that fails, ask the AI Processing Layer before giving up and asking the
    employee to clarify. This is what fixes "Не понял, о каком магазине
    речь" for phrasing the fixed alias list doesn't cover — the deterministic
    matcher stays first so the common case never waits on a network call.
    """
    store = match_store(text, stores)
    if store is not None:
        return store

    store_name = await match_store_with_ai(text, [s.name for s in stores])
    if store_name is None:
        return None
    return next((s for s in stores if s.name == store_name), None)
