"""Тесты диалога /post на упрощённых заглушках Telegram-объектов."""
import asyncio
from types import SimpleNamespace

from teabot.handlers import SOCIAL_KEY, SOCIAL_CFG_KEY, social as flow
from teabot.services.social import PostResult
from teabot.social import SocialConfig


class FakeMessage:
    def __init__(self, text=""):
        self.text = text
        self.replies = []
        self.edits = []

    async def reply_text(self, text, **kwargs):
        msg = FakeMessage(text)
        self.replies.append(SimpleNamespace(text=text, kwargs=kwargs, msg=msg))
        return msg

    async def edit_text(self, text, **kwargs):
        self.edits.append(SimpleNamespace(text=text, kwargs=kwargs))
        return self

    @property
    def last_reply(self) -> str:
        return self.replies[-1].text


class FakeClient:
    """Заглушка MetricoolClient: запоминает вызов publish."""

    def __init__(self, enabled=True):
        self.enabled = enabled
        self.published = None

    async def publish(self, text, networks, media=None, draft=False, **kwargs):
        self.published = {"text": text, "networks": list(networks),
                          "media": list(media or []), "draft": draft}
        return [PostResult(n, True, "в очереди") for n in networks]


def make_ctx(client=None, admins=frozenset({42}), networks=("instagram", "facebook")):
    return SimpleNamespace(
        user_data={},
        bot_data={
            SOCIAL_KEY: client or FakeClient(),
            SOCIAL_CFG_KEY: SocialConfig(networks=networks, admins=admins),
        },
    )


def make_update(text="", user_id=42, message=None):
    msg = message or FakeMessage(text)
    return SimpleNamespace(
        message=msg,
        effective_user=SimpleNamespace(id=user_id),
        callback_query=None,
    )


def press(ctx, data, message):
    """Нажатие inline-кнопки с заданным callback_data."""
    q = SimpleNamespace(data=data, message=message)
    upd = SimpleNamespace(callback_query=q, message=message,
                          effective_user=SimpleNamespace(id=42))
    return asyncio.run(flow.on_cb(upd, ctx))


def run(coro):
    return asyncio.run(coro)


def start_flow(ctx):
    upd = make_update("/post")
    run(flow.post_cmd(upd, ctx))
    return upd


# --- доступ ---

def test_post_denied_for_non_admin():
    ctx = make_ctx()
    upd = make_update(user_id=999)
    run(flow.post_cmd(upd, ctx))
    assert "администраторам" in upd.message.last_reply
    assert flow.STATE_KEY not in ctx.user_data


def test_post_denied_when_client_not_configured():
    ctx = make_ctx(client=FakeClient(enabled=False))
    upd = make_update()
    run(flow.post_cmd(upd, ctx))
    assert "не настроен" in upd.message.last_reply
    assert flow.STATE_KEY not in ctx.user_data


def test_post_starts_flow_for_admin():
    ctx = make_ctx()
    start_flow(ctx)
    assert ctx.user_data[flow.STATE_KEY]["step"] == "text"
    assert flow.is_waiting_for_text(ctx)


# --- сбор поста ---

def test_text_step_fills_post_and_preselects_all_networks():
    ctx = make_ctx()
    start_flow(ctx)
    upd = make_update("Новый шен пуэр 2026")
    run(flow.on_text(upd, ctx))

    state = ctx.user_data[flow.STATE_KEY]
    assert state["text"] == "Новый шен пуэр 2026"
    assert state["networks"] == {"instagram", "facebook"}
    assert state["step"] == "ready"
    assert not flow.is_waiting_for_text(ctx)
    assert "Кросспостинг" in upd.message.last_reply


def test_preview_warns_when_instagram_lacks_media():
    ctx = make_ctx()
    start_flow(ctx)
    upd = make_update("Текст без картинки")
    run(flow.on_text(upd, ctx))
    assert "нужна ссылка на фото" in upd.message.last_reply


def test_preview_escapes_html_in_user_text():
    ctx = make_ctx()
    start_flow(ctx)
    upd = make_update("<b>чай</b> & сироп")
    run(flow.on_text(upd, ctx))
    assert "&lt;b&gt;чай&lt;/b&gt; &amp; сироп" in upd.message.last_reply


def test_media_step_rejects_non_url():
    ctx = make_ctx()
    start_flow(ctx)
    run(flow.on_text(make_update("Текст"), ctx))

    screen = FakeMessage()
    press(ctx, "soc_media", screen)
    assert ctx.user_data[flow.STATE_KEY]["step"] == "media"

    upd = make_update("просто слова")
    run(flow.on_text(upd, ctx))
    assert "прямая ссылка" in upd.message.last_reply
    assert ctx.user_data[flow.STATE_KEY]["media"] == []
    assert ctx.user_data[flow.STATE_KEY]["step"] == "media"


def test_media_step_accepts_url():
    ctx = make_ctx()
    start_flow(ctx)
    run(flow.on_text(make_update("Текст"), ctx))
    press(ctx, "soc_media", FakeMessage())
    run(flow.on_text(make_update("https://cdn.example/img.jpg"), ctx))

    assert ctx.user_data[flow.STATE_KEY]["media"] == ["https://cdn.example/img.jpg"]
    assert ctx.user_data[flow.STATE_KEY]["step"] == "ready"


# --- кнопки выбора сетей ---

def test_toggle_and_bulk_selection():
    ctx = make_ctx()
    start_flow(ctx)
    run(flow.on_text(make_update("Текст"), ctx))
    screen = FakeMessage()

    press(ctx, "soc_none", screen)
    assert ctx.user_data[flow.STATE_KEY]["networks"] == set()

    press(ctx, "soc_net_facebook", screen)
    assert ctx.user_data[flow.STATE_KEY]["networks"] == {"facebook"}

    press(ctx, "soc_net_facebook", screen)
    assert ctx.user_data[flow.STATE_KEY]["networks"] == set()

    press(ctx, "soc_all", screen)
    assert ctx.user_data[flow.STATE_KEY]["networks"] == {"instagram", "facebook"}


def test_toggle_ignores_network_outside_brand():
    ctx = make_ctx()
    start_flow(ctx)
    run(flow.on_text(make_update("Текст"), ctx))
    press(ctx, "soc_net_tiktok", FakeMessage())
    assert "tiktok" not in ctx.user_data[flow.STATE_KEY]["networks"]


def test_cancel_clears_state():
    ctx = make_ctx()
    start_flow(ctx)
    run(flow.on_text(make_update("Текст"), ctx))
    screen = FakeMessage()
    press(ctx, "soc_cancel", screen)

    assert flow.STATE_KEY not in ctx.user_data
    assert "отменена" in screen.edits[-1].text


def test_callback_without_state_asks_to_restart():
    ctx = make_ctx()
    screen = FakeMessage()
    press(ctx, "soc_send", screen)
    assert "/post" in screen.last_reply


# --- публикация ---

def test_send_publishes_only_selected_networks():
    client = FakeClient()
    ctx = make_ctx(client=client)
    start_flow(ctx)
    run(flow.on_text(make_update("Свежий улун"), ctx))
    screen = FakeMessage()
    press(ctx, "soc_none", screen)
    press(ctx, "soc_net_facebook", screen)
    press(ctx, "soc_send", screen)

    assert client.published["networks"] == ["facebook"]
    assert client.published["text"] == "Свежий улун"
    assert client.published["draft"] is False
    assert flow.STATE_KEY not in ctx.user_data


def test_send_blocked_while_validation_fails():
    client = FakeClient()
    ctx = make_ctx(client=client)
    start_flow(ctx)
    run(flow.on_text(make_update("Текст без медиа"), ctx))
    screen = FakeMessage()
    press(ctx, "soc_send", screen)

    assert client.published is None
    assert "нельзя отправить" in screen.last_reply
    assert flow.STATE_KEY in ctx.user_data  # состояние сохранено, можно поправить


def test_draft_button_marks_post_as_draft():
    client = FakeClient()
    ctx = make_ctx(client=client)
    start_flow(ctx)
    run(flow.on_text(make_update("Текст"), ctx))
    screen = FakeMessage()
    press(ctx, "soc_none", screen)
    press(ctx, "soc_net_facebook", screen)
    press(ctx, "soc_draft", screen)

    assert client.published["draft"] is True
