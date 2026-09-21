import pytest

from teabot.config import Settings


def test_from_env_reads_variables(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "tok123")
    monkeypatch.setenv("GROQ_API_KEY", "groq123")
    monkeypatch.setenv("SERPER_KEY", "serp123")
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://example.com/")
    monkeypatch.setenv("PORT", "9999")

    s = Settings.from_env()
    assert s.telegram_bot_token == "tok123"
    assert s.ai_api_key == "groq123"
    assert s.serper_key == "serp123"
    assert s.webhook_url == "https://example.com/"
    assert s.port == 9999


def test_from_env_defaults(monkeypatch):
    for var in ("TELEGRAM_BOT_TOKEN", "GROQ_API_KEY", "AI_API_KEY", "SERPER_KEY",
                "RENDER_EXTERNAL_URL", "PORT", "AI_MODEL", "GROQ_MODEL", "AI_BASE_URL"):
        monkeypatch.delenv(var, raising=False)

    s = Settings.from_env()
    assert s.telegram_bot_token == ""
    assert s.port == 8080
    assert s.webhook_url.startswith("https://")
    assert s.ai_base_url == "https://api.groq.com/openai/v1"
    assert s.ai_model == "llama-3.3-70b-versatile"


def test_ai_vars_override_groq_vars(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "groq123")
    monkeypatch.setenv("GROQ_MODEL", "old-model")
    monkeypatch.setenv("AI_API_KEY", "gateway123")
    monkeypatch.setenv("AI_MODEL", "new-model")
    monkeypatch.setenv("AI_BASE_URL", "http://localhost:3001/v1/")

    s = Settings.from_env()
    assert s.ai_api_key == "gateway123"
    assert s.ai_model == "new-model"
    # Завершающий слэш срезается, иначе получится .../v1//chat/completions
    assert s.ai_base_url == "http://localhost:3001/v1"


def test_groq_vars_still_work(monkeypatch):
    for var in ("AI_API_KEY", "AI_MODEL", "AI_BASE_URL"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("GROQ_API_KEY", "groq123")
    monkeypatch.setenv("GROQ_MODEL", "old-model")

    s = Settings.from_env()
    assert s.ai_api_key == "groq123"
    assert s.ai_model == "old-model"


def test_validate_requires_token(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    s = Settings.from_env()
    with pytest.raises(RuntimeError):
        s.validate()


def test_validate_passes_with_token(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "tok123")
    Settings.from_env().validate()


def test_client_url_built_from_base_url():
    from teabot.services import AIClient

    client = AIClient("key", "model", session=None, base_url="http://localhost:3001/v1/")
    assert client.url == "http://localhost:3001/v1/chat/completions"


def test_client_defaults_to_groq():
    from teabot.services import AIClient

    assert AIClient("key", "model", session=None).url == (
        "https://api.groq.com/openai/v1/chat/completions"
    )
