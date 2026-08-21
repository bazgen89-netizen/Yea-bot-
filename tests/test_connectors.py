"""Тесты разбора ответов площадок — на подставной HTTP-сессии, без сети."""
import asyncio
import json

import pytest

from teabot.social import ConnectorError
from teabot.social.connectors import (
    AvitoConnector, GoogleBusinessConnector, InstagramConnector,
    TelegramChannelConnector, VKConnector,
)
from teabot.social.models import KIND_REVIEW, SocialItem


def run(coro):
    return asyncio.run(coro)


class FakeResponse:
    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status
        self.headers = {"Content-Type": "application/json"}

    async def json(self, content_type=None):
        if isinstance(self.payload, str):
            raise ValueError("не JSON")
        return self.payload

    async def text(self):
        return self.payload if isinstance(self.payload, str) else json.dumps(self.payload)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeSession:
    """Отдаёт заготовленные ответы по очереди и запоминает запросы."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append({"method": method, "url": url, **kwargs})
        payload = self.responses.pop(0) if self.responses else {}
        status = 200
        if isinstance(payload, tuple):
            payload, status = payload
        return FakeResponse(payload, status)


# ------------------------------------------------------------------ ВКонтакте

VK_CONVERSATIONS = {"response": {
    "items": [
        {"conversation": {"peer": {"id": 111}},
         "last_message": {"id": 5, "text": "Есть шу пуэр?", "from_id": 111, "date": 1700000000}},
        {"conversation": {"peer": {"id": 222}},
         "last_message": {"id": 6, "text": "Спасибо за заказ", "from_id": -1, "date": 1700000100, "out": 1}},
    ],
    "profiles": [{"id": 111, "first_name": "Иван", "last_name": "Петров"}],
}}


def test_vk_fetch_parses_dialogs():
    vk = VKConnector(FakeSession(VK_CONVERSATIONS), token="t", group_id="1")
    items = run(vk.fetch())

    assert len(items) == 1  # исходящее сообщение пропущено
    assert items[0].author == "Иван Петров"
    assert items[0].text == "Есть шу пуэр?"
    assert items[0].thread_id == "111"
    assert items[0].uid == "vk:message:5"


def test_vk_reply_sends_to_peer():
    session = FakeSession({"response": 1})
    vk = VKConnector(session, token="t", group_id="1")
    item = SocialItem(network="vk", kind="message", item_id="5",
                      author="Иван", text="?", thread_id="111")

    assert run(vk.reply(item, "Добрый день!")).ok
    sent = session.calls[0]["data"]
    assert sent["peer_id"] == "111" and sent["message"] == "Добрый день!"


def test_vk_error_becomes_connector_error():
    vk = VKConnector(
        FakeSession({"error": {"error_code": 5, "error_msg": "User authorization failed"}}),
        token="t", group_id="1",
    )
    with pytest.raises(ConnectorError) as e:
        run(vk.fetch())
    assert "VK 5" in str(e.value)


def test_vk_publish_returns_post_link():
    vk = VKConnector(FakeSession({"response": {"post_id": 77}}), token="t", group_id="9")
    result = run(vk.publish("Новый чай"))
    assert result.ok and result.url == "https://vk.com/wall-9_77"


# ------------------------------------------------------------------- Telegram

def test_telegram_channel_publish_builds_link():
    session = FakeSession({"ok": True, "result": {
        "message_id": 12, "chat": {"username": "waystea", "title": "Waystea"}}})
    tg = TelegramChannelConnector(session, token="123:ABC", channel_id="@waystea")

    result = run(tg.publish("Пост"))
    assert result.ok and result.url == "https://t.me/waystea/12"


def test_telegram_channel_reports_api_error():
    session = FakeSession({"ok": False, "description": "chat not found"})
    tg = TelegramChannelConnector(session, token="123:ABC", channel_id="@нет")
    with pytest.raises(ConnectorError) as e:
        run(tg.publish("Пост"))
    assert "chat not found" in str(e.value)


# ---------------------------------------------------------------------- Авито

AVITO_CHATS = {"chats": [
    {"id": "chat1", "users": [{"id": 1, "name": "Магазин"}, {"id": 2, "name": "Ольга"}],
     "last_message": {"id": "m1", "author_id": 2, "created": 1700000000,
                      "content": {"text": "Ещё актуально?"}},
     "context": {"value": {"title": "Пуэр 357 г"}}},
    {"id": "chat2", "users": [{"id": 1, "name": "Магазин"}],
     "last_message": {"id": "m2", "author_id": 1, "created": 1700000100,
                      "content": {"text": "Да, в наличии"}}},
]}


def test_avito_fetch_skips_own_messages():
    session = FakeSession({"access_token": "tok", "expires_in": 3600}, AVITO_CHATS)
    avito = AvitoConnector(session, client_id="c", client_secret="s", user_id="1")

    items = run(avito.fetch())
    assert [i.author for i in items] == ["Ольга"]
    assert items[0].thread_id == "chat1"


def test_avito_token_is_reused():
    session = FakeSession({"access_token": "tok", "expires_in": 3600},
                          AVITO_CHATS, AVITO_CHATS)
    avito = AvitoConnector(session, client_id="c", client_secret="s", user_id="1")
    run(avito.fetch())
    run(avito.fetch())

    token_calls = [c for c in session.calls if c["url"].endswith("/token/")]
    assert len(token_calls) == 1  # второй раз токен взят из кэша


# --------------------------------------------------------------- Google Карты

GOOGLE_REVIEWS = {"reviews": [
    {"reviewId": "r1", "starRating": "FIVE", "comment": "Лучший чай",
     "createTime": "2025-08-01T10:00:00Z", "name": "accounts/1/locations/2/reviews/r1",
     "reviewer": {"displayName": "Мария"}},
    {"reviewId": "r2", "starRating": "TWO", "comment": "Долгая доставка",
     "createTime": "2025-08-02T10:00:00Z", "name": "accounts/1/locations/2/reviews/r2",
     "reviewer": {"displayName": "Пётр"}, "reviewReply": {"comment": "уже ответили"}},
]}


def google(session):
    return GoogleBusinessConnector(
        session, client_id="c", client_secret="s",
        refresh_token="r", location="accounts/1/locations/2",
    )


def test_google_fetch_skips_answered_reviews():
    session = FakeSession({"access_token": "tok", "expires_in": 3600}, GOOGLE_REVIEWS)
    items = run(google(session).fetch())

    assert len(items) == 1
    assert items[0].kind == KIND_REVIEW
    assert items[0].rating == 5
    assert items[0].author == "Мария"
    assert items[0].thread_id == "accounts/1/locations/2/reviews/r1"


def test_google_reply_uses_review_name():
    session = FakeSession({"access_token": "tok", "expires_in": 3600}, {})
    item = SocialItem(network="google_maps", kind=KIND_REVIEW, item_id="r1",
                      author="Мария", text="Лучший чай",
                      thread_id="accounts/1/locations/2/reviews/r1")

    assert run(google(session).reply(item, "Спасибо!")).ok
    reply_call = session.calls[-1]
    assert reply_call["method"] == "PUT"
    assert reply_call["url"].endswith("/reviews/r1/reply")
    assert reply_call["json"] == {"comment": "Спасибо!"}


def test_google_without_token_raises():
    session = FakeSession({"error": "invalid_grant"})
    with pytest.raises(ConnectorError) as e:
        run(google(session).fetch())
    assert "access_token" in str(e.value)


# ------------------------------------------------------------------ Instagram

IG_MEDIA = {"data": [
    {"id": "p1", "permalink": "https://instagram.com/p/1",
     "comments": {"data": [
         {"id": "c1", "text": "Почём?", "username": "tea_lover",
          "timestamp": "2025-08-01T10:00:00+0000"},
     ]}},
    {"id": "p2", "permalink": "https://instagram.com/p/2"},
]}


def test_instagram_flattens_comments():
    ig = InstagramConnector(FakeSession(IG_MEDIA), user_id="42", token="t")
    items = run(ig.fetch())

    assert len(items) == 1
    assert items[0].author == "tea_lover"
    assert items[0].url == "https://instagram.com/p/1"
    assert items[0].thread_id == "c1"


def test_instagram_publish_is_not_supported():
    ig = InstagramConnector(FakeSession(), user_id="42", token="t")
    result = run(ig.publish("текст"))
    assert not result.ok and "медиа" in result.error
