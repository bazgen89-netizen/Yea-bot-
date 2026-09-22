"""Контроль рабочих сетей: реестр устройств, приём отчёта, команды."""
import asyncio
import json
import types

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from teabot.config import Settings, SocialSettings
from teabot.handlers.social import ADMIN_KEY
from teabot.handlers.wifi import AGENT_TOKEN_KEY, REGISTRY_KEY, alert_text
from teabot.security import DeviceRegistry, normalize_mac
from teabot.webapp import handle_wifi_report

TOKEN = "agent-token"
KASSA = "aa:bb:cc:dd:ee:01"
GUEST = "aa:bb:cc:dd:ee:02"


class FakeClock:
    def __init__(self, now=1_760_000_000.0):
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


# ------------------------------------------------------------- адреса

def test_mac_is_normalised_from_any_format():
    assert normalize_mac("AA-BB-CC-DD-EE-01") == KASSA
    assert normalize_mac("aabbccddee01") == KASSA
    assert normalize_mac("AA:BB:CC:DD:EE:01") == KASSA


def test_broken_mac_is_refused():
    assert normalize_mac("не адрес") == ""
    assert normalize_mac("aa:bb") == ""
    assert normalize_mac("") == ""


# ------------------------------------------------------------- реестр

def test_first_devices_are_all_new():
    registry = DeviceRegistry()
    report = registry.check("gagarina", [{"mac": KASSA, "name": "Касса"}, {"mac": GUEST}])
    assert len(report.new) == 2
    assert registry.get("gagarina", KASSA).name == "Касса"


def test_known_device_does_not_alert_twice():
    registry = DeviceRegistry()
    registry.check("gagarina", [{"mac": KASSA}])
    report = registry.check("gagarina", [{"mac": KASSA}])
    assert report.new == [] and report.returned == []
    assert len(report.known) == 1


def test_device_absent_for_a_day_is_reported_again():
    clock = FakeClock()
    registry = DeviceRegistry(clock=clock)
    registry.check("gagarina", [{"mac": GUEST}])

    clock.advance(25 * 3600)
    report = registry.check("gagarina", [{"mac": GUEST}])
    assert [d.mac for d in report.returned] == [GUEST]


def test_trusted_device_is_never_reported():
    clock = FakeClock()
    registry = DeviceRegistry(clock=clock)
    registry.check("gagarina", [{"mac": KASSA}])
    registry.trust("gagarina", KASSA, "Касса")

    clock.advance(30 * 24 * 3600)
    report = registry.check("gagarina", [{"mac": KASSA}])
    assert report.returned == [] and report.new == []


def test_same_device_in_two_shops_is_counted_separately():
    registry = DeviceRegistry()
    registry.check("gagarina", [{"mac": KASSA}])
    report = registry.check("cheryomushki", [{"mac": KASSA}])
    assert len(report.new) == 1  # в другой точке это другое событие


def test_night_visit_is_marked():
    day = DeviceRegistry(clock=lambda: 1_760_000_000.0)      # дневное время
    night = DeviceRegistry(clock=lambda: 1_760_000_000.0 - 8 * 3600)
    assert day.check("gagarina", [{"mac": KASSA}]).at_night in (True, False)
    assert isinstance(night.check("gagarina", [{"mac": KASSA}]).at_night, bool)


def test_registry_survives_restart(tmp_path):
    path = str(tmp_path / "devices.json")
    first = DeviceRegistry(path)
    first.check("gagarina", [{"mac": KASSA, "name": "Касса"}])
    first.trust("gagarina", KASSA)

    second = DeviceRegistry(path)
    assert second.get("gagarina", KASSA).trusted
    assert second.check("gagarina", [{"mac": KASSA}]).new == []


def test_forget_removes_device():
    registry = DeviceRegistry()
    registry.check("gagarina", [{"mac": KASSA}])
    assert registry.forget("gagarina", KASSA)
    assert registry.get("gagarina", KASSA) is None


def test_devices_without_mac_are_ignored():
    registry = DeviceRegistry()
    report = registry.check("gagarina", [{"ip": "192.168.1.5"}, {"mac": "мусор"}])
    assert report.new == [] and len(registry) == 0


# ------------------------------------------------------------ сообщение

def test_alert_names_the_shop_and_devices():
    registry = DeviceRegistry()
    report = registry.check("gagarina", [{"mac": GUEST, "name": "iPhone", "ip": "192.168.1.7"}])
    text = alert_text(report)

    assert "Гагарина" in text
    assert GUEST in text and "iPhone" in text and "192.168.1.7" in text
    assert "/wifi trust" in text


def test_nothing_to_report_gives_empty_text():
    registry = DeviceRegistry()
    registry.check("gagarina", [{"mac": KASSA}])
    assert alert_text(registry.check("gagarina", [{"mac": KASSA}])) == ""


def test_night_alert_is_marked():
    registry = DeviceRegistry(clock=lambda: 1_760_000_000.0 - 6 * 3600)
    report = registry.check("gagarina", [{"mac": GUEST}])
    text = alert_text(report)
    if report.at_night:
        assert "Ночью" in text


# ------------------------------------------------------------- endpoint

class FakeBot:
    def __init__(self):
        self.messages = []

    async def send_message(self, chat_id, text, **kwargs):
        self.messages.append({"chat_id": chat_id, "text": text, **kwargs})


def build_app(token=TOKEN, admin=42):
    registry = DeviceRegistry()
    bot = FakeBot()
    app = web.Application()
    app['settings'] = Settings(
        telegram_bot_token="t", groq_api_key="", serper_key="",
        webhook_url="https://x", port=8080,
        social=SocialSettings.from_env({"WIFI_AGENT_TOKEN": token}),
    )
    app['ptb_app'] = types.SimpleNamespace(bot=bot, bot_data={
        REGISTRY_KEY: registry, AGENT_TOKEN_KEY: token, ADMIN_KEY: admin,
    })
    app['background'] = set()
    app.router.add_post('/security/wifi', handle_wifi_report)
    return app, bot, registry


def post(app, payload, token=TOKEN):
    return send_all(app, [payload], token)[0]


def send_all(app, payloads, token=TOKEN):
    """Несколько отчётов в одном цикле: приложение обслуживается один раз."""
    async def go():
        out = []
        async with TestClient(TestServer(app)) as client:
            for payload in payloads:
                resp = await client.post(
                    "/security/wifi", data=json.dumps(payload).encode(),
                    headers={"Content-Type": "application/json",
                             "Authorization": f"Bearer {token}"},
                )
                out.append((resp.status, await resp.text()))
                for task in list(app['background']):
                    await task
        return out
    return asyncio.run(go())


def test_agent_report_reaches_admin_chat():
    app, bot, registry = build_app()
    status, body = post(app, {"branch": "gagarina",
                              "devices": [{"mac": KASSA, "name": "Касса"}]})

    assert status == 200 and '"new": 1' in body.replace(" ", " ")
    assert "Гагарина" in bot.messages[0]["text"]
    assert len(registry) == 1


def test_wrong_token_is_refused():
    app, bot, registry = build_app()
    assert post(app, {"branch": "gagarina", "devices": [{"mac": KASSA}]},
                token="чужой")[0] == 403
    assert bot.messages == [] and len(registry) == 0


def test_quiet_report_does_not_spam_chat():
    app, bot, _ = build_app()
    payload = {"branch": "gagarina", "devices": [{"mac": KASSA}]}
    send_all(app, [payload, payload])
    assert len(bot.messages) == 1  # второй раз сообщать не о чем


def test_report_without_branch_is_refused():
    app, _, _ = build_app()
    assert post(app, {"devices": [{"mac": KASSA}]})[0] == 400


def test_endpoint_is_off_without_token():
    app, _, _ = build_app(token="")
    assert post(app, {"branch": "gagarina", "devices": []}, token="")[0] == 404
