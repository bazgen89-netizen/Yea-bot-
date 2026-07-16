from app.services.ai import FALLBACK_NO_KEY, answer_employee_question
from app.config import settings


async def test_missing_api_key_returns_fallback(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "")
    answer = await answer_employee_question("Как заваривать чай?", "### Инструкция\n...")
    assert answer == FALLBACK_NO_KEY


async def test_missing_api_key_fallback_even_with_empty_kb(monkeypatch):
    # An empty knowledge base no longer short-circuits — tea questions are
    # answered from the model's own expertise — but with no API key it still
    # falls back gracefully.
    monkeypatch.setattr(settings, "anthropic_api_key", "")
    answer = await answer_employee_question("Расскажи про Да Хун Пао", "")
    assert answer == FALLBACK_NO_KEY
