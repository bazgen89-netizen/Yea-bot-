"""Тесты второго мозга: клиент Gemini и маршрутизация между моделями."""
import asyncio

from teabot.config import Settings
from teabot.services import AIRouter, GeminiClient, GroqClient, is_error_answer


def run(coro):
    return asyncio.run(coro)


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload, self.status = payload, status

    async def json(self):
        return self.payload

    async def text(self):
        return str(self.payload)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeSession:
    """Подставная сессия: запоминает запросы, отдаёт заготовленные ответы."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def post(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        payload = self.responses.pop(0) if self.responses else {}
        status = 200
        if isinstance(payload, tuple):
            payload, status = payload
        return FakeResponse(payload, status)


def gemini_answer(text):
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


class FakeBrain:
    """Мозг с заранее заданными ответами."""

    def __init__(self, name, answers, available=True):
        self.name = name
        self.model = f"{name}-model"
        self.api_key = "k" if available else ""
        self.available = available
        self.answers = list(answers)
        self.asked = []

    async def ask(self, prompt, system=""):
        self.asked.append(prompt)
        return self.answers.pop(0) if self.answers else "пусто"

    async def health_check(self):
        return "✅ работает" if self.available else "❌ Ключ не задан"


# ------------------------------------------------------------------ Gemini

def test_gemini_ask_returns_text():
    session = FakeSession(gemini_answer("Шу — ферментированный пуэр."))
    g = GeminiClient("key", "gemini-2.5-flash", session)

    assert run(g.ask("Что такое шу?")) == "Шу — ферментированный пуэр."
    assert "gemini-2.5-flash:generateContent" in session.calls[0]["url"]
    assert session.calls[0]["headers"]["x-goog-api-key"] == "key"


def test_gemini_uses_custom_system_prompt():
    session = FakeSession(gemini_answer("Здравствуйте!"))
    g = GeminiClient("key", "gemini-2.5-flash", session)
    run(g.ask("Отзыв клиента", system="Ты менеджер магазина"))

    body = session.calls[0]["json"]
    assert body["system_instruction"]["parts"][0]["text"] == "Ты менеджер магазина"


def test_gemini_disables_thinking_only_for_25_models():
    fast = GeminiClient("key", "gemini-2.5-flash", FakeSession())
    old = GeminiClient("key", "gemini-2.0-flash", FakeSession())

    assert fast._payload("q", "", 10)["generationConfig"]["thinkingConfig"] == {"thinkingBudget": 0}
    assert "thinkingConfig" not in old._payload("q", "", 10)["generationConfig"]


def test_gemini_without_key_reports_error():
    answer = run(GeminiClient("", "gemini-2.5-flash", FakeSession()).ask("вопрос"))
    assert is_error_answer(answer) and "GEMINI_API_KEY" in answer


def test_gemini_handles_rate_limit_and_bad_key():
    assert "много запросов" in run(
        GeminiClient("k", "m", FakeSession(({}, 429))).ask("q")
    )
    assert "Неверный GEMINI_API_KEY" in run(
        GeminiClient("k", "m", FakeSession(({}, 403))).ask("q")
    )


def test_gemini_extract_handles_empty_and_blocked():
    assert GeminiClient._extract({"candidates": []}) == ""
    assert "отклонил" in GeminiClient._extract(
        {"promptFeedback": {"blockReason": "SAFETY"}}
    )
    assert "лимит токенов" in GeminiClient._extract(
        {"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": []}}]}
    )


# ------------------------------------------------------------------ роутер

def make_router(primary_answers, backup_answers, primary="groq",
                primary_available=True, backup_available=True):
    groq = FakeBrain("Groq", primary_answers, primary_available)
    gemini = FakeBrain("Gemini", backup_answers, backup_available)
    return AIRouter({"groq": groq, "gemini": gemini}, primary=primary), groq, gemini


def test_primary_answer_is_used():
    router, groq, gemini = make_router(["ответ Groq"], ["ответ Gemini"])
    assert run(router.ask("вопрос")) == "ответ Groq"
    assert gemini.asked == []


def test_fallback_to_second_brain_on_error():
    router, groq, gemini = make_router(["⚠️ Слишком много запросов."], ["ответ Gemini"])
    assert run(router.ask("вопрос")) == "ответ Gemini"
    assert gemini.asked == ["вопрос"]


def test_fallback_when_primary_has_no_key():
    router, groq, gemini = make_router([], ["ответ Gemini"], primary_available=False)
    assert run(router.ask("вопрос")) == "ответ Gemini"
    assert groq.asked == []  # без ключа основной даже не спрашиваем


def test_primary_error_returned_when_both_fail():
    router, _, _ = make_router(["⚠️ Groq недоступен."], ["⚠️ Gemini недоступен."])
    assert run(router.ask("вопрос")) == "⚠️ Groq недоступен."


def test_no_backup_returns_primary_error():
    router, _, gemini = make_router(["⚠️ Groq недоступен."], [], backup_available=False)
    assert run(router.ask("вопрос")) == "⚠️ Groq недоступен."
    assert router.secondary_brain is None


def test_switch_primary_brain():
    router, _, _ = make_router(["Groq"], ["Gemini"])
    assert router.switch("gemini")
    assert router.primary == "gemini"
    assert run(router.ask("вопрос")) == "Gemini"


def test_switch_rejects_unknown_brain():
    router, _, _ = make_router([], [])
    assert not router.switch("chatgpt")
    assert router.primary == "groq"


def test_ask_specific_brain():
    router, _, gemini = make_router(["Groq"], ["Gemini"])
    assert run(router.ask_brain("gemini", "вопрос")) == "Gemini"
    assert is_error_answer(run(router.ask_brain("нет такого", "вопрос")))


def test_router_exposes_primary_model_and_statuses():
    router, _, _ = make_router([], [])
    assert router.model == "Groq-model"
    assert [name for name, _, _ in run(router.statuses())] == ["Groq", "Gemini"]


def test_router_available_if_any_brain_has_key():
    router, _, _ = make_router([], [], primary_available=False, backup_available=True)
    assert router.available
    router, _, _ = make_router([], [], primary_available=False, backup_available=False)
    assert not router.available


def test_error_detection():
    assert is_error_answer("⚠️ что-то не так")
    assert is_error_answer("")
    assert not is_error_answer("обычный ответ")


# --------------------------------------------------------------- настройки

def test_settings_read_gemini_env(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "gem123")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-2.0-flash")
    monkeypatch.setenv("AI_PRIMARY", "GEMINI")

    s = Settings.from_env()
    assert s.gemini_api_key == "gem123"
    assert s.gemini_model == "gemini-2.0-flash"
    assert s.ai_primary == "gemini"


def test_settings_default_to_groq(monkeypatch):
    for var in ("GEMINI_API_KEY", "GEMINI_MODEL", "AI_PRIMARY"):
        monkeypatch.delenv(var, raising=False)

    s = Settings.from_env()
    assert s.gemini_api_key == ""
    assert s.gemini_model.startswith("gemini")
    assert s.ai_primary == "groq"


def test_groq_and_gemini_share_the_same_contract():
    groq = GroqClient("k", "llama", FakeSession())
    gem = GeminiClient("k", "gemini-2.5-flash", FakeSession())
    for brain in (groq, gem):
        assert brain.available and brain.name and brain.model
        assert hasattr(brain, "ask") and hasattr(brain, "health_check")
