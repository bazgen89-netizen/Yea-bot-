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
    assert s.groq_api_key == "groq123"
    assert s.serper_key == "serp123"
    assert s.webhook_url == "https://example.com/"
    assert s.port == 9999


def test_from_env_defaults(monkeypatch):
    for var in ("TELEGRAM_BOT_TOKEN", "GROQ_API_KEY", "SERPER_KEY",
                "RENDER_EXTERNAL_URL", "PORT"):
        monkeypatch.delenv(var, raising=False)

    s = Settings.from_env()
    assert s.telegram_bot_token == ""
    assert s.port == 8080
    assert s.webhook_url.startswith("https://")


def test_validate_requires_token(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    s = Settings.from_env()
    with pytest.raises(RuntimeError):
        s.validate()


def test_validate_passes_with_token(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "tok123")
    Settings.from_env().validate()
