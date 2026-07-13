from app.services.ai import FALLBACK_EMPTY_KB, FALLBACK_NO_KEY, answer_employee_question
from app.config import settings


async def test_empty_knowledge_base_short_circuits_before_any_api_call():
    answer = await answer_employee_question("Как заваривать чай?", "")
    assert answer == FALLBACK_EMPTY_KB


async def test_missing_api_key_returns_fallback(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "")
    answer = await answer_employee_question("Как заваривать чай?", "### Инструкция\n...")
    assert answer == FALLBACK_NO_KEY
