from dataclasses import dataclass

from app.config import settings
from app.handlers.tea_requests import _is_tea_request_message


@dataclass
class FakeChat:
    id: int


@dataclass
class FakeMessage:
    chat: FakeChat
    message_thread_id: int | None = None


def test_disabled_when_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "tea_request_chat_id", None)
    assert not _is_tea_request_message(FakeMessage(chat=FakeChat(id=123)))


def test_matches_dedicated_chat_with_no_thread_configured(monkeypatch):
    monkeypatch.setattr(settings, "tea_request_chat_id", 123)
    monkeypatch.setattr(settings, "tea_request_thread_id", None)
    assert _is_tea_request_message(FakeMessage(chat=FakeChat(id=123)))
    assert not _is_tea_request_message(FakeMessage(chat=FakeChat(id=999)))


def test_matches_specific_topic_thread_only(monkeypatch):
    monkeypatch.setattr(settings, "tea_request_chat_id", 123)
    monkeypatch.setattr(settings, "tea_request_thread_id", 42)
    assert _is_tea_request_message(FakeMessage(chat=FakeChat(id=123), message_thread_id=42))
    assert not _is_tea_request_message(FakeMessage(chat=FakeChat(id=123), message_thread_id=7))
    assert not _is_tea_request_message(FakeMessage(chat=FakeChat(id=123), message_thread_id=None))
