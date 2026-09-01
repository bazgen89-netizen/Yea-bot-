import asyncio

from teabot.config import SocialSettings
from teabot.social import (
    CAP_INBOX, CAP_PUBLISH, CAP_REPLY, Connector, ConnectorError,
    PublishResult, SeenStore, SocialHub, SocialItem, build_connectors,
)
from teabot.social.models import KIND_MESSAGE, KIND_REVIEW


def run(coro):
    return asyncio.run(coro)


class FakeConnector(Connector):
    """Коннектор без сети: отдаёт заранее заданные элементы."""

    capabilities = frozenset({CAP_INBOX, CAP_REPLY, CAP_PUBLISH})

    def __init__(self, network, items=(), fail=None, enabled=True):
        super().__init__(session=None, token="t" if enabled else "")
        self.network = network
        self.title = network.upper()
        self._items = list(items)
        self._fail = fail
        self.sent = []
        self.posted = []

    async def fetch(self, limit=10):
        if self._fail:
            raise ConnectorError(self._fail)
        return self._items[:limit]

    async def reply(self, item, text):
        self.sent.append((item.uid, text))
        return PublishResult(self.network, True)

    async def publish(self, text, link=""):
        if self._fail:
            raise ConnectorError(self._fail)
        self.posted.append(text)
        return PublishResult(self.network, True, url=f"https://{self.network}/1")


def item(network="vk", item_id="1", created_at=100.0, kind=KIND_MESSAGE, rating=None):
    return SocialItem(
        network=network, kind=kind, item_id=item_id, author="Клиент",
        text="Есть пуэр в наличии?", created_at=created_at, thread_id="42",
        rating=rating,
    )


def make_hub(connectors, tmp_path=None, **kwargs):
    state = str(tmp_path / "seen.json") if tmp_path else None
    return SocialHub(connectors, SeenStore(state), **kwargs)


# ------------------------------------------------------------------ модели

def test_uid_is_unique_per_network_and_item():
    assert item("vk", "1").uid != item("avito", "1").uid
    assert item("vk", "1").uid == item("vk", "1").uid


def test_format_escapes_html_and_shows_rating():
    card = SocialItem(
        network="google_maps", kind=KIND_REVIEW, item_id="r1",
        author="<b>Гость</b>", text="Отличный чай & сервис", rating=5,
    ).format("Google Карты")
    assert "&lt;b&gt;Гость&lt;/b&gt;" in card
    assert "&amp;" in card
    assert "⭐⭐⭐⭐⭐" in card


def test_publish_result_format():
    assert PublishResult("vk", True, url="u").format("ВК") == "✅ ВК — u"
    assert "❌" in PublishResult("vk", False, error="нет токена").format("ВК")


# ------------------------------------------------------------- дедупликация

def test_seen_store_marks_items_once():
    seen = SeenStore()
    items = [item(item_id="1"), item(item_id="2")]
    assert len(seen.filter_new(items)) == 2
    assert seen.filter_new(items) == []


def test_seen_store_persists_between_запусками(tmp_path):
    path = str(tmp_path / "seen.json")
    first = SeenStore(path)
    first.filter_new([item(item_id="1")])
    first.save()

    second = SeenStore(path)
    assert second.filter_new([item(item_id="1")]) == []


def test_seen_store_respects_max_size():
    seen = SeenStore(max_size=2)
    seen.mark_all(["a", "b", "c"])
    assert len(seen) == 2
    assert seen.is_new("a")


# ---------------------------------------------------------------- чтение

def test_fetch_new_collects_from_all_networks(tmp_path):
    hub = make_hub([
        FakeConnector("vk", [item("vk", "1", created_at=100)]),
        FakeConnector("avito", [item("avito", "2", created_at=200)]),
    ], tmp_path)

    items = run(hub.fetch_new())
    assert [i.network for i in items] == ["avito", "vk"]  # новое первым


def test_fetch_new_skips_already_seen(tmp_path):
    hub = make_hub([FakeConnector("vk", [item("vk", "1")])], tmp_path)
    assert len(run(hub.fetch_new())) == 1
    assert run(hub.fetch_new()) == []


def test_broken_network_does_not_block_others(tmp_path):
    hub = make_hub([
        FakeConnector("vk", fail="токен протух"),
        FakeConnector("avito", [item("avito", "2")]),
    ], tmp_path)

    items = run(hub.fetch_new())
    assert [i.network for i in items] == ["avito"]
    assert "токен протух" in hub.last_errors["vk"]


def test_disabled_networks_are_not_polled(tmp_path):
    hub = make_hub([FakeConnector("vk", [item("vk", "1")], enabled=False)], tmp_path)
    assert run(hub.fetch_new()) == []
    assert hub.enabled == []


# ----------------------------------------------------------------- ответы

def test_reply_goes_to_the_right_network(tmp_path):
    vk, avito = FakeConnector("vk"), FakeConnector("avito")
    hub = make_hub([vk, avito], tmp_path)

    result = run(hub.reply(item("avito", "2"), "Здравствуйте!"))
    assert result.ok
    assert avito.sent == [("avito:message:2", "Здравствуйте!")]
    assert vk.sent == []


def test_reply_to_unknown_network_fails_gracefully(tmp_path):
    hub = make_hub([FakeConnector("vk")], tmp_path)
    result = run(hub.reply(item("instagram", "9"), "текст"))
    assert not result.ok and "не подключена" in result.error


def test_autopilot_escalates_negative_reviews(tmp_path):
    hub = make_hub([FakeConnector("google_maps")], tmp_path)
    bad = item("google_maps", "r1", kind=KIND_REVIEW, rating=2)
    good = item("google_maps", "r2", kind=KIND_REVIEW, rating=5)
    assert hub.needs_human(bad)
    assert not hub.needs_human(good)


def test_remember_and_resolve_item(tmp_path):
    hub = make_hub([FakeConnector("vk")], tmp_path)
    token = hub.remember(item("vk", "1"))
    assert hub.resolve(token).item_id == "1"
    assert hub.resolve("нет такого") is None


# ------------------------------------------------------------- публикация

def test_publish_goes_to_every_network(tmp_path):
    vk, tg = FakeConnector("vk"), FakeConnector("tg_channel")
    hub = make_hub([vk, tg], tmp_path)

    results = run(hub.publish("Новый шэн пуэр в наличии"))
    assert [r.ok for r in results] == [True, True]
    assert vk.posted and tg.posted


def test_publish_reports_failed_network(tmp_path):
    hub = make_hub([
        FakeConnector("vk"),
        FakeConnector("ok", fail="подпись неверна"),
    ], tmp_path)

    results = {r.network: r for r in run(hub.publish("текст"))}
    assert results["vk"].ok
    assert not results["ok"].ok and "подпись" in results["ok"].error


def test_publish_can_target_selected_networks(tmp_path):
    vk, tg = FakeConnector("vk"), FakeConnector("tg_channel")
    hub = make_hub([vk, tg], tmp_path)

    run(hub.publish("только в телеграм", networks=["tg_channel"]))
    assert tg.posted and not vk.posted


# -------------------------------------------------------------- настройки

def test_build_connectors_enables_only_configured():
    connectors = build_connectors(
        {"VK_GROUP_TOKEN": "tok", "VK_GROUP_ID": "123"}, session=None
    )
    enabled = {c.network for c in connectors if c.enabled}
    assert enabled == {"vk"}


def test_build_connectors_reads_maps_credentials():
    env = {
        "YANDEX_BUSINESS_TOKEN": "y", "YANDEX_COMPANY_ID": "1",
        "GOOGLE_CLIENT_ID": "c", "GOOGLE_CLIENT_SECRET": "s",
        "GOOGLE_REFRESH_TOKEN": "r", "GOOGLE_LOCATION": "accounts/1/locations/2",
    }
    enabled = {c.network for c in build_connectors(env, session=None) if c.enabled}
    assert enabled == {"yandex_maps", "google_maps"}


def test_social_settings_from_env():
    s = SocialSettings.from_env({
        "SOCIAL_ADMIN_CHAT_ID": "555",
        "SOCIAL_POLL_INTERVAL": "60",
        "SOCIAL_AUTOPILOT": "on",
    })
    assert s.admin_chat_id == 555
    assert s.poll_interval == 60
    assert s.autopilot is True
    assert s.polling_enabled


def test_social_settings_defaults_are_safe():
    s = SocialSettings.from_env({})
    assert s.admin_chat_id is None
    assert not s.polling_enabled
    assert not s.autopilot


def test_social_settings_ignores_broken_values():
    s = SocialSettings.from_env({"SOCIAL_ADMIN_CHAT_ID": "не число",
                                 "SOCIAL_POLL_INTERVAL": "abc"})
    assert s.admin_chat_id is None
    assert s.poll_interval >= 30


def test_capabilities_declared_for_every_connector():
    for c in build_connectors({}, session=None):
        assert c.capabilities & {CAP_INBOX, CAP_REPLY, CAP_PUBLISH}
        assert c.required_env


# ------------------------------------------------- доставка в админский чат

class FakeBot:
    def __init__(self):
        self.messages = []

    async def send_message(self, chat_id, text, **kwargs):
        self.messages.append({"chat_id": chat_id, "text": text, **kwargs})


class FakeAI:
    def __init__(self, answer="Здравствуйте! Пуэр в наличии, отправим сегодня."):
        self.answer = answer
        self.prompts = []

    async def ask(self, prompt, system=""):
        self.prompts.append((prompt, system))
        return self.answer


def test_deliver_shows_card_with_buttons_without_autopilot(tmp_path):
    from teabot.handlers.social import deliver_items

    hub = make_hub([FakeConnector("vk")], tmp_path)
    bot = FakeBot()
    run(deliver_items(bot, 42, hub, [item("vk", "1")]))

    assert len(bot.messages) == 1
    assert bot.messages[0]["reply_markup"] is not None
    assert "Есть пуэр в наличии?" in bot.messages[0]["text"]


def test_autopilot_answers_and_reports(tmp_path):
    from teabot.handlers.social import deliver_items

    vk = FakeConnector("vk")
    hub = make_hub([vk], tmp_path, ai=FakeAI(), autopilot=True)
    bot = FakeBot()
    run(deliver_items(bot, 42, hub, [item("vk", "1")]))

    assert vk.sent and "Пуэр в наличии" in vk.sent[0][1]
    assert "Автопилот ответил" in bot.messages[0]["text"]
    assert "reply_markup" not in bot.messages[0]


def test_autopilot_asks_human_for_bad_review(tmp_path):
    from teabot.handlers.social import deliver_items

    gm = FakeConnector("google_maps")
    hub = make_hub([gm], tmp_path, ai=FakeAI(), autopilot=True)
    bot = FakeBot()
    run(deliver_items(bot, 42, hub,
                      [item("google_maps", "r1", kind=KIND_REVIEW, rating=1)]))

    assert gm.sent == []
    assert "Нужен ваш ответ" in bot.messages[0]["text"]


def test_deliver_summarises_overflow(tmp_path):
    from teabot.config import SOCIAL_MAX_CARDS
    from teabot.handlers.social import deliver_items

    hub = make_hub([FakeConnector("vk")], tmp_path)
    bot = FakeBot()
    items = [item("vk", str(i)) for i in range(SOCIAL_MAX_CARDS + 3)]
    run(deliver_items(bot, 42, hub, items))

    assert len(bot.messages) == SOCIAL_MAX_CARDS + 1
    assert "и ещё 3" in bot.messages[-1]["text"]
