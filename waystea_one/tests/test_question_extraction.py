"""Отбор вопросов покупателей из поисковой выдачи (app/services/ai.py).

Сеть в тестах не трогаем: проверяется фильтр, который отсекает мусор из
ответа модели — именно он решает, что попадёт владельцу на одобрение.
"""
import pytest

from app.services.ai import extract_guest_questions
from app.services.websearch import find_question_snippets


@pytest.mark.asyncio
async def test_no_api_key_means_no_questions(monkeypatch):
    """Fail-open: без ключа функция молчит, а не роняет джоб."""
    from app.config import settings

    monkeypatch.setattr(settings, "anthropic_api_key", "")
    assert await extract_guest_questions(["какой-то текст"], 3) == []


@pytest.mark.asyncio
async def test_empty_snippets_short_circuit(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "anthropic_api_key", "ключ")
    assert await extract_guest_questions([], 3) == []


@pytest.mark.asyncio
async def test_search_without_key_is_disabled(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "serper_key", "")
    assert await find_question_snippets() == []


@pytest.mark.asyncio
async def test_model_chatter_is_filtered_out(monkeypatch):
    """Модель любит добавить вступление и нумерацию — в библиотеку должны
    пройти только настоящие вопросы."""
    from app.config import settings
    import app.services.ai as ai

    monkeypatch.setattr(settings, "anthropic_api_key", "ключ")

    class FakeBlock:
        type = "text"
        text = (
            "Вот подходящие вопросы:\n"
            "1. А чем улун отличается от зелёного чая?\n"
            "- Сколько можно хранить пуэр дома?\n"
            "Ок\n"
            "Это утверждение, а не вопрос.\n"
            "Как заваривать, если нет чайника?\n"
        )

    class FakeResponse:
        content = [FakeBlock()]

    class FakeMessages:
        async def create(self, **kwargs):
            return FakeResponse()

    class FakeClient:
        def __init__(self, **kwargs):
            self.messages = FakeMessages()

    class FakeAnthropic:
        AsyncAnthropic = FakeClient

    monkeypatch.setitem(__import__("sys").modules, "anthropic", FakeAnthropic)

    questions = await extract_guest_questions(["сниппет"], 5)

    assert questions == [
        "А чем улун отличается от зелёного чая?",
        "Сколько можно хранить пуэр дома?",
        "Как заваривать, если нет чайника?",
    ]


@pytest.mark.asyncio
async def test_limit_is_respected(monkeypatch):
    from app.config import settings
    import sys

    monkeypatch.setattr(settings, "anthropic_api_key", "ключ")

    class FakeBlock:
        type = "text"
        text = "\n".join(f"Это достаточно длинный вопрос номер {i}?" for i in range(10))

    class FakeResponse:
        content = [FakeBlock()]

    class FakeClient:
        def __init__(self, **kwargs):
            self.messages = type("M", (), {"create": staticmethod(
                lambda **kw: _async_value(FakeResponse()))})()

    def _async_value(value):
        async def _coro():
            return value
        return _coro()

    monkeypatch.setitem(sys.modules, "anthropic", type("A", (), {"AsyncAnthropic": FakeClient}))

    assert len(await extract_guest_questions(["сниппет"], 2)) == 2
