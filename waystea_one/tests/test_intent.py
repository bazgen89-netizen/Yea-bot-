from app.config import settings
from app.services.intent import match_store_with_ai, resolve_store
from app.services.store_matcher import StoreOption

STORES = [
    StoreOption(id=1, name="Черёмушки", aliases=["черемушки", "черёмушк"]),
    StoreOption(id=2, name="Гагарина", aliases=["гагарин"]),
    StoreOption(id=3, name="Рынок на Студёной", aliases=["студен", "рынок"]),
]


async def test_ai_store_matching_short_circuits_without_api_key(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "")
    result = await match_store_with_ai("текст", ["Черёмушки", "Гагарина"])
    assert result is None


async def test_resolve_store_uses_deterministic_match_without_calling_ai():
    # Exact alias match should resolve without ever needing the AI fallback.
    store = await resolve_store("Гагарина на месте", STORES)
    assert store is not None and store.name == "Гагарина"


async def test_resolve_store_falls_back_to_none_when_ai_unavailable(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "")
    # No deterministic match, and no API key configured -> None, not a guess.
    store = await resolve_store("я сегодня в неизвестном месте", STORES)
    assert store is None
