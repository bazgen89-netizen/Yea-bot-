"""Приём событий, которые Meta присылает сама: разбор, подпись, доставка."""
import asyncio
import hashlib
import hmac
import json
import time
import types

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from teabot.config import Settings, SocialSettings
from teabot.handlers.social import ADMIN_KEY, HUB_KEY
from teabot.social import SeenStore, SocialHub
from teabot.social.models import KIND_COMMENT, KIND_MESSAGE
from teabot.social.webhooks import parse_meta_payload, verify_signature
from teabot.webapp import handle_meta_verify, handle_meta_webhook

SECRET = "app-secret"
VERIFY = "verify-token"


# ------------------------------------------------------------- payload'ы

def whatsapp_payload(text="Здравствуйте, есть шу пуэр?", msg_id="wamid.1"):
    return {"object": "whatsapp_business_account", "entry": [{"changes": [{
        "field": "messages",
        "value": {
            "contacts": [{"wa_id": "79991234567", "profile": {"name": "Ольга"}}],
            "messages": [{"from": "79991234567", "id": msg_id,
                          "timestamp": "1756500000", "type": "text",
                          "text": {"body": text}}],
        },
    }]}]}


def instagram_comment_payload():
    return {"object": "instagram", "entry": [{"changes": [{
        "field": "comments",
        "value": {"id": "c1", "text": "Почём?", "from": {"username": "tea_lover"},
                  "media": {"id": "m1"}},
    }]}]}


def facebook_comment_payload(verb="add"):
    return {"object": "page", "entry": [{"changes": [{
        "field": "feed",
        "value": {"item": "comment", "verb": verb, "comment_id": "fc1",
                  "post_id": "p1", "message": "Доставка в Казань есть?",
                  "from": {"name": "Пётр", "id": "u1"},
                  "created_time": 1756500000},
    }]}]}


def messenger_payload(echo=False):
    return {"object": "page", "entry": [{"messaging": [{
        "sender": {"id": "u9"}, "timestamp": 1756500000000,
        "message": {"mid": "m9", "text": "Когда отправите?", **({"is_echo": True} if echo else {})},
    }]}]}


# ---------------------------------------------------------------- разбор

def test_whatsapp_message_is_parsed():
    items = parse_meta_payload(whatsapp_payload())
    assert len(items) == 1
    item = items[0]
    assert item.network == "whatsapp" and item.kind == KIND_MESSAGE
    assert item.author == "Ольга"
    assert item.text == "Здравствуйте, есть шу пуэр?"
    assert item.thread_id == "79991234567"  # сюда уйдёт ответ
    assert item.created_at == 1756500000


def test_whatsapp_delivery_statuses_are_ignored():
    payload = {"object": "whatsapp_business_account", "entry": [{"changes": [{
        "field": "messages",
        "value": {"statuses": [{"id": "wamid.1", "status": "delivered"}]},
    }]}]}
    assert parse_meta_payload(payload) == []


def test_whatsapp_attachment_gets_placeholder_text():
    payload = whatsapp_payload()
    payload["entry"][0]["changes"][0]["value"]["messages"][0] = {
        "from": "79991234567", "id": "wamid.2", "timestamp": "1756500000", "type": "image",
    }
    assert "[image]" in parse_meta_payload(payload)[0].text


def test_instagram_comment_is_parsed():
    item = parse_meta_payload(instagram_comment_payload())[0]
    assert item.network == "instagram" and item.kind == KIND_COMMENT
    assert item.author == "tea_lover" and item.text == "Почём?"


def test_facebook_comment_is_parsed():
    item = parse_meta_payload(facebook_comment_payload())[0]
    assert item.network == "facebook" and item.kind == KIND_COMMENT
    assert item.author == "Пётр"
    assert item.url.endswith("p1")


def test_edited_and_removed_comments_are_skipped():
    assert parse_meta_payload(facebook_comment_payload(verb="remove")) == []


def test_messenger_message_is_parsed_and_echo_skipped():
    assert parse_meta_payload(messenger_payload())[0].text == "Когда отправите?"
    assert parse_meta_payload(messenger_payload(echo=True)) == []


def test_timestamps_in_milliseconds_are_normalised():
    item = parse_meta_payload(messenger_payload())[0]
    assert abs(item.created_at - 1756500000) < 1


def test_unknown_events_are_ignored():
    assert parse_meta_payload({"object": "page", "entry": [{"changes": [
        {"field": "ratings", "value": {"rating": 5}}]}]}) == []
    assert parse_meta_payload({}) == []


# --------------------------------------------------------------- подпись

def sign(body: bytes) -> str:
    return "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()


def test_signature_checks():
    body = b'{"object":"page"}'
    assert verify_signature(body, sign(body), SECRET)
    assert not verify_signature(body, sign(b"other"), SECRET)
    assert not verify_signature(body, "", SECRET)
    assert not verify_signature(body, "md5=abc", SECRET)
    # без секрета проверять нечем — пропускаем
    assert verify_signature(body, "", "")


# ------------------------------------------------------------- endpoint

class FakeBot:
    def __init__(self):
        self.messages = []

    async def send_message(self, chat_id, text, **kwargs):
        self.messages.append({"chat_id": chat_id, "text": text, **kwargs})


def build_app(admin_chat_id=42):
    hub = SocialHub([], SeenStore())
    bot = FakeBot()
    ptb = types.SimpleNamespace(
        bot=bot, bot_data={HUB_KEY: hub, ADMIN_KEY: admin_chat_id},
    )
    app = web.Application()
    app['settings'] = Settings(
        telegram_bot_token="t", groq_api_key="", serper_key="",
        webhook_url="https://x", port=8080,
        social=SocialSettings.from_env({
            "SOCIAL_ADMIN_CHAT_ID": str(admin_chat_id),
            "META_VERIFY_TOKEN": VERIFY, "META_APP_SECRET": SECRET,
        }),
    )
    app['ptb_app'] = ptb
    app['background'] = set()
    app.router.add_get('/social/meta', handle_meta_verify)
    app.router.add_post('/social/meta', handle_meta_webhook)
    return app, bot


def request(app, method, path, **kwargs):
    async def go():
        async with TestClient(TestServer(app)) as client:
            resp = await client.request(method, path, **kwargs)
            result = resp.status, await resp.text()
            for task in list(app['background']):  # дожидаемся доставки в чат
                await task
            return result
    return asyncio.run(go())


def post(app, payload, signature=None):
    return send_all(app, [payload], signature)[0]


def send_all(app, payloads, signature=None):
    """Несколько событий подряд в одном цикле: приложение обслуживается один раз."""
    async def go():
        statuses = []
        async with TestClient(TestServer(app)) as client:
            for payload in payloads:
                body = json.dumps(payload).encode()
                resp = await client.post(
                    "/social/meta", data=body,
                    headers={"X-Hub-Signature-256": signature or sign(body),
                             "Content-Type": "application/json"},
                )
                statuses.append((resp.status, await resp.text()))
                for task in list(app['background']):  # дожидаемся доставки в чат
                    await task
        return statuses
    return asyncio.run(go())


def test_subscription_verification():
    app, _ = build_app()
    status, text = request(app, "GET", "/social/meta", params={
        "hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "12345"})
    assert (status, text) == (200, "12345")


def test_verification_rejects_wrong_token():
    app, _ = build_app()
    status, _ = request(app, "GET", "/social/meta", params={
        "hub.mode": "subscribe", "hub.verify_token": "чужой", "hub.challenge": "1"})
    assert status == 403


def test_event_reaches_admin_chat():
    app, bot = build_app()
    status, _ = post(app, whatsapp_payload())

    assert status == 200
    assert len(bot.messages) == 1
    assert "Здравствуйте, есть шу пуэр?" in bot.messages[0]["text"]
    assert bot.messages[0]["chat_id"] == 42


def test_forged_signature_is_rejected():
    app, bot = build_app()
    status, _ = post(app, whatsapp_payload(), signature="sha256=deadbeef")

    assert status == 403
    assert bot.messages == []


def test_repeated_delivery_shows_card_once():
    app, bot = build_app()
    # Meta повторяет доставку, пока не получит 200 — карточка должна быть одна
    send_all(app, [whatsapp_payload(msg_id="wamid.42")] * 2)
    assert len(bot.messages) == 1


def test_broken_body_still_answers_ok():
    app, bot = build_app()
    broken = "не json".encode()
    status, _ = request(app, "POST", "/social/meta", data=broken,
                        headers={"X-Hub-Signature-256": sign(broken)})
    assert status == 200  # иначе Meta будет слать это тело снова и снова
    assert bot.messages == []


def test_without_admin_chat_nothing_is_sent():
    app, bot = build_app(admin_chat_id=None)
    assert post(app, whatsapp_payload())[0] == 200
    assert bot.messages == []
