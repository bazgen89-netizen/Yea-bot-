from dataclasses import dataclass

from app.config import settings
from app.handlers.tea_requests import _is_tea_request_message


@dataclass
class FakeChat:
    id: int


@dataclass
class FakeMessage:
    chat: FakeChat
    text: str | None = None
    message_thread_id: int | None = None


def test_disabled_when_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "tea_request_chat_id", None)
    assert not _is_tea_request_message(FakeMessage(chat=FakeChat(id=123), text="3005 тг"))


def test_matches_message_with_a_4_digit_article_code(monkeypatch):
    monkeypatch.setattr(settings, "tea_request_chat_id", 123)
    monkeypatch.setattr(settings, "tea_request_thread_id", None)
    assert _is_tea_request_message(FakeMessage(chat=FakeChat(id=123), text="3005 тг"))


def test_matches_message_with_an_8_digit_article_code(monkeypatch):
    monkeypatch.setattr(settings, "tea_request_chat_id", 123)
    monkeypatch.setattr(settings, "tea_request_thread_id", None)
    assert _is_tea_request_message(FakeMessage(chat=FakeChat(id=123), text="12345678 юэ гуан бай"))


def test_ignores_message_without_a_valid_article_code(monkeypatch):
    monkeypatch.setattr(settings, "tea_request_chat_id", 123)
    monkeypatch.setattr(settings, "tea_request_thread_id", None)
    # Casual chatter in the topic, no order list -> not a request.
    assert not _is_tea_request_message(FakeMessage(chat=FakeChat(id=123), text="привет всем"))
    # 3- and 5-digit runs don't count, only exactly 4 or 8.
    assert not _is_tea_request_message(FakeMessage(chat=FakeChat(id=123), text="300 тг"))
    assert not _is_tea_request_message(FakeMessage(chat=FakeChat(id=123), text="30051 тг"))


def test_wrong_chat_or_thread_ignored_even_with_article_code(monkeypatch):
    monkeypatch.setattr(settings, "tea_request_chat_id", 123)
    monkeypatch.setattr(settings, "tea_request_thread_id", 42)
    assert not _is_tea_request_message(FakeMessage(chat=FakeChat(id=999), text="3005 тг"))
    assert not _is_tea_request_message(
        FakeMessage(chat=FakeChat(id=123), text="3005 тг", message_thread_id=7)
    )
    assert _is_tea_request_message(
        FakeMessage(chat=FakeChat(id=123), text="3005 тг", message_thread_id=42)
    )
