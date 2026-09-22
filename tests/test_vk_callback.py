"""Callback API ВКонтакте: комментарии, сообщения, подтверждение адреса."""
import asyncio
import json
import types

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from teabot.config import Settings, SocialSettings
from teabot.handlers.social import ADMIN_KEY, HUB_KEY
from teabot.social import SeenStore, SocialHub
from teabot.social.connectors import VKConnector
from teabot.social.models import KIND_COMMENT, KIND_MESSAGE
from teabot.social.webhooks import parse_vk_payload
from teabot.webapp import handle_vk_webhook

CONFIRMATION = "a1b2c3"
SECRET = "vk-secret"


def comment_event(comment_id=7, text="Почём набор?"):
    return {"type": "wall_reply_new", "group_id": 42, "secret": SECRET,
            "object": {"id": comment_id, "from_id": 5, "post_id": 3, "owner_id": -42,
                       "text": text, "date": 1756500000},
            "profiles": [{"id": 5, "first_name": "Иван", "last_name": "Петров"}]}


def message_event():
    return {"type": "message_new", "group_id": 42, "secret": SECRET,
            "object": {"message": {"id": 9, "from_id": 5, "peer_id": 5,
                                   "text": "Есть шу пуэр?", "date": 1756500000}}}


# ----------------------------------------------------------------- разбор

def test_wall_comment_is_parsed():
    item = parse_vk_payload(comment_event())[0]
    assert item.network == "vk" and item.kind == KIND_COMMENT
    assert item.author == "Иван Петров"
    assert item.url == "https://vk.com/wall-42_3"
    assert item.raw["post_id"] == 3  # нужен, чтобы ответить в ту же ветку


def test_group_message_is_parsed():
    item = parse_vk_payload(message_event())[0]
    assert item.kind == KIND_MESSAGE
    assert item.thread_id == "5"


def test_own_replies_are_skipped():
    own_comment = comment_event()
    own_comment["object"]["from_id"] = -42
    assert parse_vk_payload(own_comment) == []

    own_message = message_event()
    own_message["object"]["message"]["from_id"] = -42
    assert parse_vk_payload(own_message) == []


def test_photo_and_video_comments_are_picked_up():
    event = comment_event()
    event["type"] = "photo_comment_new"
    event["object"] = {"id": 8, "from_id": 5, "photo_id": 77, "owner_id": -42,
                       "text": "Красиво", "date": 1756500000}
    assert parse_vk_payload(event)[0].kind == KIND_COMMENT


def test_unknown_events_are_ignored():
    assert parse_vk_payload({"type": "group_leave", "object": {}}) == []
    assert parse_vk_payload({}) == []


def test_author_falls_back_to_id_without_profiles():
    event = comment_event()
    event.pop("profiles")
    assert parse_vk_payload(event)[0].author == "id5"


# -------------------------------------------------------------- endpoint

class FakeBot:
    def __init__(self):
        self.messages = []

    async def send_message(self, chat_id, text, **kwargs):
        self.messages.append({"chat_id": chat_id, "text": text, **kwargs})


def build_app():
    hub = SocialHub([], SeenStore())
    bot = FakeBot()
    app = web.Application()
    app['settings'] = Settings(
        telegram_bot_token="t", groq_api_key="", serper_key="",
        webhook_url="https://x", port=8080,
        social=SocialSettings.from_env({
            "SOCIAL_ADMIN_CHAT_ID": "42",
            "VK_CONFIRMATION": CONFIRMATION, "VK_CALLBACK_SECRET": SECRET,
        }),
    )
    app['ptb_app'] = types.SimpleNamespace(bot=bot, bot_data={HUB_KEY: hub, ADMIN_KEY: 42})
    app['background'] = set()
    app.router.add_post('/social/vk', handle_vk_webhook)
    return app, bot


def send_all(app, payloads):
    async def go():
        out = []
        async with TestClient(TestServer(app)) as client:
            for payload in payloads:
                resp = await client.post("/social/vk", data=json.dumps(payload).encode(),
                                         headers={"Content-Type": "application/json"})
                out.append((resp.status, await resp.text()))
                for task in list(app['background']):
                    await task
        return out
    return asyncio.run(go())


def test_address_confirmation_returns_the_string():
    app, _ = build_app()
    status, text = send_all(app, [{"type": "confirmation", "group_id": 42, "secret": SECRET}])[0]
    assert (status, text) == (200, CONFIRMATION)


def test_comment_reaches_admin_chat():
    app, bot = build_app()
    status, text = send_all(app, [comment_event()])[0]

    assert (status, text) == (200, "ok")  # иначе ВКонтакте шлёт событие снова
    assert "Почём набор?" in bot.messages[0]["text"]


def test_wrong_secret_is_rejected():
    app, bot = build_app()
    event = comment_event()
    event["secret"] = "чужой"
    assert send_all(app, [event])[0][0] == 403
    assert bot.messages == []


def test_repeated_event_shows_card_once():
    app, bot = build_app()
    send_all(app, [comment_event(), comment_event()])
    assert len(bot.messages) == 1


# ------------------------------------------------ ответ в нужное место

class FakeResponse:
    def __init__(self, payload):
        self.payload, self.status = payload, 200
        self.headers = {"Content-Type": "application/json"}

    async def json(self, content_type=None):
        return self.payload

    async def text(self):
        return ""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeSession:
    def __init__(self):
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        return FakeResponse({"response": {"comment_id": 1}})


def test_comment_is_answered_with_a_comment():
    session = FakeSession()
    vk = VKConnector(session, token="t", group_id="42")
    item = parse_vk_payload(comment_event())[0]

    assert asyncio.run(vk.reply(item, "Напишем в личку")).ok
    call = session.calls[0]
    assert call["url"].endswith("wall.createComment")
    assert call["data"]["reply_to_comment"] == "7"
    assert call["data"]["post_id"] == 3
    assert call["data"]["owner_id"] == -42


def test_dialog_is_answered_with_a_message():
    session = FakeSession()
    vk = VKConnector(session, token="t", group_id="42")
    item = parse_vk_payload(message_event())[0]

    assert asyncio.run(vk.reply(item, "Есть, пишем")).ok
    call = session.calls[0]
    assert call["url"].endswith("messages.send")
    assert call["data"]["peer_id"] == "5"
